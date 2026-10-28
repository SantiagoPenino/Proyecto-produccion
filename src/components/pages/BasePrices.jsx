import React, { useState, useEffect, useMemo } from 'react';
import {
    Tags, Search, Calculator, X, Globe, Folder, FolderOpen, ChevronDown, ChevronUp, Plus, Pencil, Trash2,
    Loader2, SearchX, Layers, Save
} from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';
import TablaTarifa from './TablaTarifa';
import { tablaDeTarifa, CAMPOS_TARIFA, TEXTOS_TARIFA } from './tarifasCobro';
import Selector from '../ui/Selector';
import useConfirmar from '../ui/useConfirmar';

// --- HELPERS PARA UNIDADES Y PRECIOS ---

const getMetricUnit = (categoria) => {
    const cat = (categoria || '').toUpperCase();
    if (cat.includes('BORDAD') || cat.includes('EMB') || cat.includes('BOR')) return 'pts';
    if (cat.includes('ESTAMPAD') || cat.includes('EST')) return 'baj.';
    return 'u.';
};

// [23/10/2026] Las escalas dicen la unidad de medida del área del grupo (Areas.UM, llega
// como AreaUM en /prices/base): "Min 100 m" en Sublimación, "Min 10 m²" en ECO UV. Si el
// área no tiene unidad cargada, queda lo de antes (por la categoría del perfil).
const UNIDADES_AREA = {
    m: { corta: 'm', nombre: 'Metros' },
    m2: { corta: 'm²', nombre: 'Metros cuadrados' },
    punt: { corta: 'pts', nombre: 'Puntadas' },
    baj: { corta: 'baj.', nombre: 'Bajadas' },
    prend: { corta: 'prendas', nombre: 'Prendas' },
    u: { corta: 'u.', nombre: 'Unidades' },
};
const NOMBRES_POR_CORTA = { 'pts': 'Puntadas', 'baj.': 'Bajadas', 'u.': 'Unidades' };

// [23/10/2026] Productos de salón (los del local, CodStock 2.2.1.2): su propio grupo, con el perfil de
// Categoria 'SALON' para ponerles escalas por cantidad (el motor les aplica ese perfil: pricingService,
// CODSTOCK_PRODUCTOS_SALON). Antes iban mezclados en "2 - 2.1" sin escalas.
const CODSTOCK_SALON = ['2.2.1.2'];
const GRUPO_SALON = '2 - 2.1 (Productos de salón)';
const unidadDelGrupo = (items, profile) => {
    const um = (items.find(i => i.AreaUM)?.AreaUM || '').trim().toLowerCase();
    if (UNIDADES_AREA[um]) return UNIDADES_AREA[um];
    const corta = profile ? getMetricUnit(profile.Categoria) : 'u.';
    return { corta, nombre: NOMBRES_POR_CORTA[corta] || 'Unidades' };
};

const calculateDiscountPct = (baseVal, fixedVal) => {
    const base = parseFloat(baseVal);
    const fixed = parseFloat(fixedVal);
    if (!base || isNaN(base) || !fixed || isNaN(fixed) || base <= 0) return null;
    const diff = base - fixed;
    const pct = (diff / base) * 100;
    return pct.toFixed(0);
};

const calculateFinalPrice = (baseVal, pctVal) => {
    const base = parseFloat(baseVal);
    const pct = parseFloat(pctVal);
    if (!base || isNaN(base) || isNaN(pct)) return null;
    const finalPrice = base * (1 - pct / 100);
    return finalPrice.toFixed(2);
};

// Estética nueva (28/10/2026): encabezado con ícono, todo claro (zinc + brand-cyan), simulador, grupos y tabla con el
// estilo del sistema; moneda y tipo de cálculo con Selector; ventana de escalas sin blur y confirmaciones propias (antes
// window.confirm). En el celular: buscador, estado y grupo arriba con Selector y una tarjeta por artículo. La lógica
// de precios, escalas y tarifas no cambió.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CAMPO_CHICO = 'min-w-0 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400';
const TH = 'px-3 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide whitespace-nowrap';
const CHIP_CIAN = 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20';
// Campos de números (precio, escalas, tarifa): normal, con un cambio sin guardar (ámbar) y con foco en cian
const INPUT_NUM = 'border rounded-xl outline-none transition-colors font-mono font-bold tabular-nums';
const INPUT_NORMAL = 'border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const INPUT_PENDIENTE = 'border-amber-400 bg-amber-50 text-zinc-900 ring-2 ring-amber-100';
// Selector de moneda de la fila con un cambio sin guardar: el mismo tamaño que el modo `filtro`, en ámbar
const SELECTOR_PENDIENTE = 'flex items-center gap-2 shrink-0 rounded-xl border pl-3 pr-2.5 py-2 text-sm font-semibold text-left outline-none transition-colors border-amber-400 bg-amber-50 text-zinc-900 ring-2 ring-amber-100';
// Selector del tipo de cálculo de la fila: más chico, va debajo del nombre del artículo
const SELECTOR_CALCULO = 'flex items-center gap-1 rounded-lg border border-zinc-200 bg-white pl-2 pr-1.5 py-1 text-[11px] font-bold text-brand-cyan text-left outline-none transition-colors hover:border-zinc-300 focus-visible:border-brand-cyan focus-visible:ring-2 focus-visible:ring-brand-cyan/15';
// Grupo de la lista de la izquierda (elegido en cian) y su contador
const claseGrupo = (elegido) => `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-sm text-left transition-colors select-none ${elegido
    ? 'bg-brand-cyan/10 border-brand-cyan/20 text-brand-cyan font-bold'
    : 'border-transparent text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900'}`;
const claseContador = (elegido) => `shrink-0 text-[11px] px-2 py-0.5 rounded-full font-bold tabular-nums ${elegido ? 'bg-brand-cyan text-white' : 'bg-zinc-100 text-zinc-500'}`;
// En pantalla, «US$» (las cuentas de la fila siguen armando el texto con «U$S»)
const enPantalla = (t) => String(t).replace('U$S', 'US$');

// En el celular, una tarjeta por artículo en vez de la tabla (una vista sola: no se dibujan las dos ocultando una)
const MQ_TABLA = '(min-width: 1024px)';
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

// Componente de Grupo Colapsable
const PriceGroup = ({ 
    label, 
    items, 
    pendingChanges, 
    onPriceChange, 
    onAddPrice,
    profile,
    qtyColumns = [],
    profileRules = [],
    pendingTieredChanges = {},
    onTieredChange,
    onAddQtyColumn,
    onRemoveQtyColumn,
    onRenameQtyColumn
}) => {
    const [expanded, setExpanded] = useState(false);
    const metricUnit = profile ? getMetricUnit(profile.Categoria) : 'u.';

    // Prepend the virtual TOTAL row if profile exists
    const groupItems = useMemo(() => {
        if (!profile) return items;
        const totalItem = {
            ID: null,
            _tempID: `total-${profile.ID}`,
            CodArticulo: 'TOTAL',
            Descripcion: 'Aplica a TODOS (General)',
            Precio: '-',
            Moneda: 'USD',
            ProIdProducto: 0,
            _isVirtualTotal: true
        };
        return [totalItem, ...items];
    }, [items, profile]);

    return (
        <div className="border-b border-zinc-100 last:border-0">
            <div
                className="flex items-center gap-2 p-3 bg-zinc-50/50 hover:bg-zinc-100 cursor-pointer select-none transition-colors"
                onClick={() => setExpanded(!expanded)}
            >
                {expanded ? <FolderOpen size={16} className="text-brand-cyan shrink-0" /> : <Folder size={16} className="text-brand-cyan shrink-0" />}
                <span className="font-bold text-zinc-700 text-sm flex-1">{label || 'Sin Familia'}</span>

                {/* Badge con Nombre de Perfil Asociado y Unidad de Medida */}
                {profile && (
                    <div className="flex items-center gap-1.5 mr-4" onClick={(e) => e.stopPropagation()}>
                        <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${CHIP_CIAN}`}>
                            <Tags size={11} />
                            {profile.Nombre}
                        </span>
                        <span className={`${CHIP} bg-zinc-50 text-zinc-500 border-zinc-200`}>
                            Métrica: {metricUnit === 'pts' ? 'Puntadas' : metricUnit === 'baj.' ? 'Bajadas' : 'Unidades'}
                        </span>
                    </div>
                )}

                <span className="text-[11px] font-bold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full tabular-nums">{items.length}</span>
                {expanded ? <ChevronUp size={14} className="text-zinc-400" /> : <ChevronDown size={14} className="text-zinc-400" />}
            </div>

            {expanded && (
                <div className="pl-4 border-l-2 border-zinc-100 ml-4 mb-2 overflow-x-auto">
                    <table className="min-w-full text-left text-sm border-collapse">
                        <thead className="bg-zinc-50 border-b border-zinc-200 sticky top-0 z-10">
                            <tr>
                                <th className={`${TH} w-32`}>Código</th>
                                <th className={TH}>Descripción</th>
                                <th className={`${TH} text-right w-28`}>Precio Base</th>
                                <th className={`${TH} text-center w-24`}>Moneda</th>

                                {/* Columnas de escalas */}
                                {qtyColumns.map(q => (
                                    <th key={q} className={`${TH} text-center w-28 relative group/hdr select-none`}>
                                        Min {q} {metricUnit}
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemoveQtyColumn(profile.ID, q);
                                            }}
                                            className="absolute top-1/2 -translate-y-1/2 right-1 w-5 h-5 rounded-md flex items-center justify-center text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/10 opacity-0 group-hover/hdr:opacity-100 transition-colors"
                                            title={`Eliminar rango Min ${q}`}
                                        >
                                            <X size={12} />
                                        </button>
                                    </th>
                                ))}

                                {/* Botón para agregar nueva escala */}
                                {profile && (
                                    <th className={`${TH} text-center w-12 align-middle`} onClick={(e) => e.stopPropagation()}>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onAddQtyColumn(profile.ID);
                                            }}
                                            className="w-6 h-6 mx-auto rounded-full flex items-center justify-center bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20"
                                            title="Agregar columna de cantidad (Rango)"
                                        >
                                            <Plus size={13} />
                                        </button>
                                    </th>
                                )}

                                <th className={`${TH} w-16`}></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                            {groupItems.map(item => (
                                <PriceRow
                                    key={item.ID || item._tempID}
                                    item={item}
                                    changes={pendingChanges[item.ID || item._tempID]}
                                    onChange={onPriceChange}
                                    onAdd={onAddPrice}
                                    qtyColumns={qtyColumns}
                                    profileRules={profileRules}
                                    pendingTieredChanges={pendingTieredChanges}
                                    onTieredChange={onTieredChange}
                                    profile={profile}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// Componente Fila Editable con Escalas e Incorporación
const PriceRow = ({
    item,
    changes,
    onChange,
    onAdd,
    qtyColumns = [],
    profileRules = [],
    pendingTieredChanges = {},
    onTieredChange,
    profile,
    hideAddCurrency = false,
    // [19/10/2026] Bordado y estampado: se cobran con la tarifa del recuadro de arriba. En bordado el motor no
    // mira este precio (reemplazaLista: la fila no deja cargarlo); en estampado es el que se cobra si la orden
    // no trae bajadas (sigue editable, con la aclaración debajo).
    cobroTecnico = null,
    // [23/10/2026] Desde qué cantidades tiene escalas propias (perfil global): la marca "PRECIO POR CANTIDAD"
    escalasDelArticulo = null,
    // Estética nueva (28/10/2026): en el celular la fila se dibuja como tarjeta (mismos campos y handlers);
    // `unidadEscala` es la unidad del rótulo de cada escala en la tarjeta ("Min 100 m"), la del encabezado de la tabla
    tarjeta = false,
    unidadEscala = 'u.'
}) => {
    const isTotalRow = item._isVirtualTotal || item.CodArticulo === 'TOTAL';
    const displayVal = changes?.precio !== undefined ? changes.precio : (item.Precio || 0);
    const displayMoneda = changes?.moneda !== undefined ? changes.moneda : (item.Moneda || 'UYU');
    const isDirty = changes !== undefined;
    const sinLista = !!cobroTecnico?.reemplazaLista;

    const rowId = item.ID || item._tempID;

    // Obtener reglas activas de este producto específico
    const activeRules = profileRules.filter(r => 
        (isTotalRow && (r.CodArticulo === 'TOTAL' || r.ProIdProducto === 0)) ||
        (!isTotalRow && (r.ProIdProducto === item.ProIdProducto || (item.CodArticulo && r.CodArticulo === item.CodArticulo)))
    );
    
    // Ver si el tipo de regla general se cambió localmente
    const typeChangeKey = profile ? `${profile.ID}-${item.CodArticulo}-type` : null;
    const pendingType = typeChangeKey ? pendingTieredChanges[typeChangeKey]?.tipoRegla : null;
    
    const ruleType = pendingType || (activeRules.length > 0 ? activeRules[0].TipoRegla : 'percentage_discount');

    const handleTypeSelectorChange = (e) => {
        const newType = e.target.value;
        if (!profile) return;
        
        onTieredChange(typeChangeKey, {
            perfilId: profile.ID,
            proIdProducto: item.ProIdProducto,
            codArticulo: item.CodArticulo,
            tipoRegla: newType,
            isTypeChangeOnly: true
        });
        
        // Actualizar tipos de regla de todas las columnas en cambios pendientes
        qtyColumns.forEach(q => {
            const rule = activeRules.find(r => r.CantidadMinima === q);
            const ruleKey = `${profile.ID}-${item.CodArticulo}-${q}`;
            const currentVal = pendingTieredChanges[ruleKey]?.valor !== undefined
                ? pendingTieredChanges[ruleKey].valor
                : (rule ? rule.Valor : '');
            
            if (currentVal !== '') {
                onTieredChange(ruleKey, {
                    id: rule ? rule.ID : null,
                    perfilId: profile.ID,
                    proIdProducto: item.ProIdProducto,
                    codArticulo: item.CodArticulo,
                    cantidadMinima: q,
                    tipoRegla: newType,
                    valor: currentVal,
                    moneda: displayMoneda
                });
            }
        });
    };

    // ── Piezas de la fila, para la tabla y para la tarjeta del celular (las cuentas y los handlers son los de antes) ──
    const etiquetas = (
        <>
            {item._isNew && <span className={`${CHIP} bg-emerald-50 text-emerald-700 border-emerald-200`}>NUEVO</span>}
            {!isTotalRow && !(item.Mostrar === true || item.Mostrar === 1) && (
                <span className={`${CHIP} bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20`}>INACTIVO</span>
            )}
            {!isTotalRow && escalasDelArticulo?.length > 0 && (
                <span className={`${CHIP} ${CHIP_CIAN}`}
                    title={`Tiene precio por cantidad: cambia desde ${escalasDelArticulo.map(q => q.toLocaleString('es-UY')).join(', ')}. Se aplica solo al poner la cantidad (caja, pedidos).`}>
                    PRECIO POR CANTIDAD
                </span>
            )}
        </>
    );

    // Tipo de regla selector (solo si pertenece a un perfil)
    const selectorCalculo = profile && (
        <div className="mt-1.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <span className="text-[10px] text-zinc-400 font-black uppercase tracking-wider">Cálculo:</span>
            <Selector value={ruleType} onChange={handleTypeSelectorChange} claseBoton={SELECTOR_CALCULO} className="w-[132px]"
                aria-label="Tipo de cálculo de las escalas">
                <option value="percentage_discount">Descuento (%)</option>
                <option value="fixed_price">Precio Fijo ($)</option>
                <option value="percentage_surcharge">Recargo (%)</option>
            </Selector>
        </div>
    );

    const campoPrecio = (
        <>
            {isTotalRow ? (
                <span className="text-zinc-300 font-black text-center block">-</span>
            ) : sinLista ? (
                <span className={`inline-block text-[11px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${CHIP_CIAN}`}
                    title="Se cobra con la tarifa de arriba. Este precio no se usa.">
                    {cobroTecnico.etiqueta}
                </span>
            ) : (
                <input
                    type="number" step="0.01"
                    className={`w-28 text-right px-2.5 py-2 text-sm ${INPUT_NUM} ${isDirty ? INPUT_PENDIENTE : INPUT_NORMAL}`}
                    placeholder="0.00"
                    value={displayVal}
                    onChange={(e) => onChange(rowId, { precio: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    aria-label={`Precio base de ${item.CodArticulo}`}
                />
            )}
            {cobroTecnico && !sinLista && (
                <span className={`block mt-1 text-[10px] leading-tight font-bold text-brand-cyan ${tarjeta ? 'text-left' : 'text-right'}`}>{cobroTecnico.pista}</span>
            )}
        </>
    );

    const campoMoneda = isTotalRow ? (
        <span className="text-zinc-300 font-black text-center block">-</span>
    ) : sinLista ? (
        <span className="text-sm font-bold text-zinc-500" title="La tarifa es en pesos">$</span>
    ) : (
        <Selector filtro resaltar={false} className="w-[84px]" value={displayMoneda}
            claseBoton={isDirty && changes?.moneda !== undefined ? SELECTOR_PENDIENTE : undefined}
            onChange={(e) => onChange(rowId, { moneda: e.target.value })}
            aria-label={`Moneda de ${item.CodArticulo}`}>
            <option value="UYU">$</option>
            <option value="USD">US$</option>
        </Selector>
    );

    // Celdas de las escalas de volumen: el valor propio o el heredado de la fila General, y la vista previa del cálculo
    const escala = (q) => {
        const rule = activeRules.find(r => r.CantidadMinima === q);
        const ruleKey = profile ? `${profile.ID}-${item.CodArticulo}-${q}` : null;
                
        const pendingRule = ruleKey ? pendingTieredChanges[ruleKey] : null;
        const ruleVal = pendingRule?.valor !== undefined 
            ? pendingRule.valor 
            : (rule ? rule.Valor : '');
                
        const isRuleDirty = pendingRule !== undefined && pendingRule.valor !== undefined;
        const isDeleted = pendingRule?.action === 'delete';

        const cellSymbol = ruleType.includes('percentage') ? '%' : (displayMoneda === 'USD' ? 'U$S' : '$');
        const isPct = ruleType.includes('percentage');

        // Si NO es la fila TOTAL, buscamos si hay una regla heredada de la fila general
        const totalRule = !isTotalRow && profileRules.find(r => r.CantidadMinima === q && (r.CodArticulo === 'TOTAL' || r.ProIdProducto === 0));
        const isInherited = !isTotalRow && ruleVal === '' && totalRule && !isDeleted;
                
        const effectiveVal = ruleVal !== '' && !isDeleted 
            ? ruleVal 
            : (isInherited ? totalRule.Valor : '');

        // Previsualización dinámica de cálculo
        let previewText = '';
        if (effectiveVal !== '' && !isNaN(parseFloat(effectiveVal)) && !isTotalRow) {
            if (isPct) {
                const finalPrice = calculateFinalPrice(displayVal, effectiveVal);
                if (finalPrice !== null) {
                    previewText = `${displayMoneda === 'USD' ? 'U$S' : '$'} ${finalPrice}`;
                }
            } else {
                const discountPct = calculateDiscountPct(displayVal, effectiveVal);
                if (discountPct !== null) {
                    previewText = `-${discountPct}%`;
                }
            }
        }

        return (
            <div className="flex flex-col items-center justify-center gap-1">
                <div className="relative flex items-center justify-center">
                    <input
                        type="text"
                        className={`w-24 text-center px-2 py-1.5 text-xs ${INPUT_NUM} ${isDeleted
                            ? 'border-brand-magenta/30 bg-brand-magenta/5 text-brand-magenta/60 line-through'
                            : isRuleDirty
                                ? 'border-brand-cyan bg-brand-cyan/5 text-brand-cyan ring-2 ring-brand-cyan/15'
                                : INPUT_NORMAL
                        }`}
                            title={isInherited ? `Valor general (${totalRule.Valor}) heredado — escribí acá para fijar un valor propio de este producto` : undefined}
                            placeholder="-"
                            value={isDeleted ? '' : effectiveVal}
                            onChange={(e) => {
                                if (!profile) return;
                                const inputVal = e.target.value;
                                        
                                if (inputVal === '') {
                                    if (rule) {
                                        onTieredChange(ruleKey, {
                                            id: rule.ID,
                                            perfilId: profile.ID,
                                            proIdProducto: item.ProIdProducto,
                                            codArticulo: item.CodArticulo,
                                            cantidadMinima: q,
                                            tipoRegla: ruleType,
                                            action: 'delete'
                                        });
                                    } else {
                                        onTieredChange(ruleKey, undefined);
                                    }
                                } else {
                                    onTieredChange(ruleKey, {
                                        id: rule ? rule.ID : null,
                                        perfilId: profile.ID,
                                        proIdProducto: item.ProIdProducto,
                                        codArticulo: item.CodArticulo,
                                        cantidadMinima: q,
                                        tipoRegla: ruleType,
                                        valor: inputVal,
                                        moneda: displayMoneda
                                    });
                                }
                            }}
                            onFocus={(e) => e.target.select()}
                        />
                    <span className="text-[10px] text-zinc-400 font-bold ml-1 w-6 text-left">{enPantalla(cellSymbol)}</span>
                </div>

                {/* Previsualización dinámica: Badge o Precio final */}
                {previewText && (
                    <div className="text-[11px] leading-none mt-1 select-none font-mono">
                        {isPct ? (
                            <span className="text-zinc-400 font-semibold">
                                {enPantalla(previewText)} {isInherited && <span className="text-[8px] text-zinc-300 italic font-sans">(Gen)</span>}
                            </span>
                        ) : (
                            <span className={`inline-block px-1.5 py-0.5 rounded-md border font-bold text-[9px] ${isInherited ? 'bg-zinc-100 border-zinc-200 text-zinc-400' : CHIP_CIAN}`}>
                                {previewText} {isInherited && <span className="text-[8px] opacity-75 font-sans">(Gen)</span>}
                            </span>
                        )}
                    </div>
                )}
            </div>
        );
    };

    const acciones = !isTotalRow && (
        <div className="flex justify-end items-center gap-2 shrink-0">
            {isDirty && <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" title="Cambio sin guardar" />}
            {!hideAddCurrency && !sinLista && (
                <button
                    onClick={() => onAdd(item)}
                    className={tarjeta
                        ? `${BTN_SECUNDARIO} text-xs px-2.5 py-1.5 whitespace-nowrap`
                        : 'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity text-zinc-400 hover:text-brand-cyan p-1.5 rounded-lg hover:bg-brand-cyan/5'}
                    title="Agregar precio en otra moneda"
                    aria-label="Agregar precio en otra moneda"
                >
                    <Plus size={14} />{tarjeta && 'Otra moneda'}
                </button>
            )}
        </div>
    );

    return tarjeta ? (
        <div className={`rounded-2xl border p-3.5 flex flex-col gap-3 ${isTotalRow ? 'bg-brand-cyan/5 border-brand-cyan/30' : 'bg-white border-zinc-200'}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="font-mono text-xs font-bold text-zinc-500">
                        {isTotalRow ? <span className={`${CHIP} ${CHIP_CIAN}`}>TOTAL</span> : item.CodArticulo}
                    </div>
                    <div className={`mt-0.5 text-sm ${isTotalRow ? 'text-zinc-900 font-bold' : 'font-semibold text-zinc-800'}`}>
                        {item.Descripcion || <span className="text-zinc-400 italic">Sin descripción</span>}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1 empty:hidden">{etiquetas}</div>
                </div>
                {acciones}
            </div>
            {!isTotalRow && (
                <div className="flex flex-wrap items-start gap-2">
                    <div>
                        <span className={`${ETIQUETA} mb-1`}>Precio base</span>
                        {campoPrecio}
                    </div>
                    <div>
                        <span className={`${ETIQUETA} mb-1`}>Moneda</span>
                        {campoMoneda}
                    </div>
                </div>
            )}
            {selectorCalculo}
            {qtyColumns.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                    {qtyColumns.map(q => (
                        <div key={q} className="rounded-xl bg-zinc-50 border border-zinc-100 px-2 py-2 flex flex-col items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                            <span className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Min {q} {unidadEscala}</span>
                            {escala(q)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    ) : (
        <tr className={`transition-colors ${isTotalRow ? 'bg-brand-cyan/5 font-semibold border-b-2 border-brand-cyan/15' : 'hover:bg-zinc-50 group'}`}>
            <td className="px-3 py-3 font-mono text-zinc-500 font-bold text-xs align-middle whitespace-nowrap">
                {isTotalRow ? (
                    <span className={`${CHIP} ${CHIP_CIAN}`}>TOTAL</span>
                ) : (
                    item.CodArticulo
                )}
            </td>
            <td className="px-3 py-3 align-middle min-w-[220px]">
                <div className={isTotalRow ? 'text-zinc-900 font-bold text-sm' : 'font-semibold text-zinc-800 text-sm'}>
                    {item.Descripcion || <span className="text-zinc-400 italic">Sin descripción</span>}
                </div>
                <div className="flex flex-wrap gap-1 mt-1 empty:hidden">{etiquetas}</div>
                {selectorCalculo}
            </td>
            <td className="px-3 py-3 text-right align-middle w-32">
                {campoPrecio}
            </td>
            <td className="px-3 py-3 text-center w-28 align-middle">
                <div className="inline-flex">{campoMoneda}</div>
            </td>

            {/* Celdas de las escalas de volumen */}
            {qtyColumns.map(q => (
                <td key={q} className="px-3 py-3 text-center align-middle w-32" onClick={(e) => e.stopPropagation()}>
                    {escala(q)}
                </td>
            ))}

            {qtyColumns.length > 0 && <td className="w-12"></td>}

            <td className="px-3 py-3 text-right w-16 align-middle">
                {acciones}
            </td>
        </tr>
    );
};

// [19/10/2026] Tarifa por dato técnico del grupo (bordado: puntadas; estampado: bajadas). Los valores viven en
// ConfiguracionPrecios y los lee el motor en cada cálculo (pricingService.tarifaBordado / tarifaEstampado):
// GET/PUT /prices/tarifa/:tipo. Va arriba de la tabla del grupo. Campos, textos y tabla: tarifasCobro.js.
const TarifaPanel = ({ tarifa, onGuardada }) => {
    const campos = CAMPOS_TARIFA[tarifa.tipo];
    const textos = TEXTOS_TARIFA[tarifa.tipo];
    const guardados = () => Object.fromEntries(campos.map(c => [c.campo, String(tarifa[c.campo] ?? '')]));
    const [valores, setValores] = useState(guardados);
    // [23/10/2026] Bordado: las franjas de puntadas ("hasta 4.000 puntadas, $ 70"), como texto mientras se escriben
    const conFranjas = Array.isArray(tarifa.franjas);
    const franjasGuardadas = () => (tarifa.franjas || []).map(f => ({ hasta: String(f.hasta), precio: String(f.precio) }));
    const [franjas, setFranjas] = useState(franjasGuardadas);
    const [guardando, setGuardando] = useState(false);
    const [confirmar, ventanaConfirmar] = useConfirmar();
    const franjasCambiadas = conFranjas && JSON.stringify(franjas) !== JSON.stringify(franjasGuardadas());
    const cambiado = franjasCambiadas || campos.some(c => String(tarifa[c.campo] ?? '') !== valores[c.campo]);
    const actual = {
        ...tarifa,
        ...Object.fromEntries(Object.entries(valores).map(([k, v]) => [k, String(v).replace(',', '.')])),
        ...(conFranjas ? { franjas } : {}),
    };
    const cambiarFranja = (i, campo, valor) => setFranjas(fs => fs.map((f, k) => (k === i ? { ...f, [campo]: valor } : f)));
    const descartar = () => { setValores(guardados()); setFranjas(franjasGuardadas()); };

    const guardar = async () => {
        if (!(await confirmar({ titulo: `Guardar la ${textos.titulo.toLowerCase()}`, texto: 'La tarifa nueva se usa para todo lo que se cotice desde ahora (lo ya facturado no cambia). ¿Guardar?', confirmar: 'Guardar' }))) return;
        setGuardando(true);
        try {
            const r = await api.put(`/prices/tarifa/${tarifa.tipo}`, conFranjas ? { ...valores, franjas } : valores);
            toast.success(`${textos.titulo} guardada`);
            onGuardada(r.data);
        } catch (e) {
            toast.error(e.response?.data?.error || `No se pudo guardar la ${textos.titulo.toLowerCase()}`);
        } finally {
            setGuardando(false);
        }
    };

    return (
        <div className={`${CARD} p-4`}>
            {ventanaConfirmar}
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                <div className="flex items-start gap-2.5 min-w-[220px] flex-1">
                    <Calculator size={20} className="text-brand-cyan shrink-0 mt-0.5" />
                    <div className="min-w-0">
                        <h3 className="text-base font-black text-zinc-800 leading-tight">{textos.titulo}</h3>
                        <p className="text-xs text-zinc-500 mt-1">{textos.descripcion}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    {cambiado && (
                        <button onClick={descartar}
                            className={`${BTN_SECUNDARIO} flex-1 sm:flex-none`}
                            title="Volver a los valores guardados">
                            Descartar
                        </button>
                    )}
                    <button onClick={guardar} disabled={!cambiado || guardando}
                        className={`${BTN_PRINCIPAL} flex-1 sm:flex-none`}
                        title={cambiado ? `Guardar la ${textos.titulo.toLowerCase()}` : 'No hay cambios'}>
                        {guardando ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
                        {guardando ? 'Guardando…' : 'Guardar tarifa'}
                    </button>
                </div>
            </div>
            {conFranjas && (
                <div className="mb-4">
                    <span className={`${ETIQUETA} mb-1.5`}>Franjas de puntadas (precio por bordado, en pesos)</span>
                    <div className="flex flex-wrap gap-2">
                        {franjas.map((f, i) => {
                            const guardada = franjasGuardadas()[i];
                            const marca = (campo) => (!guardada || guardada[campo] !== f[campo]
                                ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-100'
                                : 'border-zinc-200 bg-white focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15');
                            return (
                                <div key={i} className="flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-2.5 py-1.5">
                                    <span className="text-[11px] text-zinc-500">Hasta</span>
                                    <input type="number" min="1" step="1000" value={f.hasta} aria-label={`Franja ${i + 1}: hasta cuántas puntadas`}
                                        onChange={(e) => cambiarFranja(i, 'hasta', e.target.value)}
                                        className={`w-20 text-right border rounded-lg px-1.5 py-1 outline-none font-mono font-bold text-xs tabular-nums ${marca('hasta')}`} />
                                    <span className="text-[11px] text-zinc-500">puntadas, $</span>
                                    <input type="number" min="0" step="1" value={f.precio} aria-label={`Franja ${i + 1}: precio por bordado`}
                                        onChange={(e) => cambiarFranja(i, 'precio', e.target.value)}
                                        className={`w-16 text-right border rounded-lg px-1.5 py-1 outline-none font-mono font-bold text-xs tabular-nums ${marca('precio')}`} />
                                    <button onClick={() => setFranjas(fs => fs.filter((_, k) => k !== i))} disabled={franjas.length <= 1}
                                        className="text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 disabled:opacity-30 disabled:hover:text-zinc-400 disabled:hover:bg-transparent p-1 rounded-md transition-colors"
                                        title="Quitar esta franja (se guarda con «Guardar tarifa»)" aria-label={`Quitar la franja ${i + 1}`}>
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            );
                        })}
                        <button onClick={() => setFranjas(fs => [...fs, { hasta: '', precio: '' }])}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-brand-cyan/40 text-brand-cyan hover:bg-brand-cyan/5 px-3 py-1.5 text-xs font-bold transition-colors"
                            title="Agregar una franja de puntadas (se guarda con «Guardar tarifa»)">
                            <Plus size={13} /> Agregar franja
                        </button>
                    </div>
                    <span className="block text-[11px] text-zinc-400 mt-1.5">Cada bordado paga el precio de la primera franja que alcanza sus puntadas. Se ordenan solas de menor a mayor al guardar.</span>
                </div>
            )}
            <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 ${campos.length === 3 ? 'lg:grid-cols-3' : 'lg:grid-cols-4'}`}>
                {campos.map(c => (
                    <label key={c.campo} className="block min-w-0">
                        <span className={ETIQUETA}>{c.etiqueta}</span>
                        <input type="number" min="0" step={c.paso} value={valores[c.campo]}
                            onChange={(e) => setValores(v => ({ ...v, [c.campo]: e.target.value }))}
                            className={`mt-1.5 w-full text-right px-3 py-2 text-sm ${INPUT_NUM} ${String(tarifa[c.campo] ?? '') !== valores[c.campo] ? INPUT_PENDIENTE : INPUT_NORMAL}`} />
                        <span className="block text-[11px] text-zinc-400 mt-1">{c.ayuda}</span>
                    </label>
                ))}
            </div>
            {/* La misma tabla que Precios por cantidad, con los valores que se están escribiendo */}
            <div className="mt-4 min-w-0">
                <TablaTarifa conTitulo={false} tabla={tablaDeTarifa(actual)} />
            </div>
            <p className="mt-2 text-[11px] text-zinc-500">
                {textos.nota}{cambiado ? ', con los valores sin guardar' : ''}. {typeof textos.extra === 'function' ? textos.extra(actual) : textos.extra}
            </p>
        </div>
    );
};

// embebido: dentro de Perfiles de precio, que ya tiene su encabezado; se oculta el título propio
const BasePrices = ({ hideGeneralRow = false, hideAddCurrency = false, embebido = false }) => {
    // --- ESTADO ---
    const [prices, setPrices] = useState([]);
    const [profiles, setProfiles] = useState([]);
    const [tieredRules, setTieredRules] = useState([]);
    // [19/10/2026] Tarifas por dato técnico, por tipo (null = no se pudo leer: ese grupo se ve como antes)
    const [tarifas, setTarifas] = useState({ bordado: null, estampado: null });
    const [loading, setLoading] = useState(false);
    const [filter, setFilter] = useState('');

    // Filtro por estado del artículo (Mostrar): ALL | ACTIVE | INACTIVE
    const [activeFilter, setActiveFilter] = useState('ACTIVE');

    // Categoría seleccionada (por defecto 'ALL' o la primera que cargue)
    const [selectedGroupKey, setSelectedGroupKey] = useState('ALL');

    // Fila "Aplica a TODOS (General)": colapsada por defecto, se abre a pedido
    const [showGeneralRow, setShowGeneralRow] = useState(false);

    // Cambios Pendientes Base
    const [pendingChanges, setPendingChanges] = useState({});
    
    // Cambios Pendientes Escalas
    const [pendingTieredChanges, setPendingTieredChanges] = useState({});

    // Columnas agregadas localmente por perfil
    const [addedColumns, setAddedColumns] = useState({});

    // Modal para agregar/modificar escala de volumen (reemplaza prompts nativos)
    const [scaleModal, setScaleModal] = useState({
        isOpen: false,
        type: 'add',
        profileId: null,
        oldQty: null,
        value: ''
    });

    // Simulador
    const [simCode, setSimCode] = useState('');
    const [simClient, setSimClient] = useState('');
    const [simResult, setSimResult] = useState(null);
    // Estética nueva (28/10/2026): confirmación del sistema (antes window.confirm) y tabla o tarjetas según el ancho
    const [confirmar, ventanaConfirmar] = useConfirmar();
    const conTabla = useConTabla();

    useEffect(() => {
        loadPrices();
    }, []);

    const loadPrices = async () => {
        setLoading(true);
        try {
            const [pricesRes, profilesRes, tieredRes, bordadoRes, estampadoRes] = await Promise.all([
                api.get('/prices/base'),
                api.get('/profiles'),
                api.get('/prices/tiered'),
                // Si fallan, la pantalla funciona igual que antes (sin recuadro ni "Por puntadas / bajadas")
                api.get('/prices/tarifa/bordado').catch(() => ({ data: null })),
                api.get('/prices/tarifa/estampado').catch(() => ({ data: null }))
            ]);
            setTarifas({ bordado: bordadoRes.data || null, estampado: estampadoRes.data || null });
            
            const data = pricesRes.data.map(item => ({
                ...item,
                Precio: item.Precio ?? 0,
                Moneda: item.Moneda || 'UYU',
                _tempID: item.ID ? null : `init-${item.CodArticulo}`
            }));
            
            setPrices(data);
            setProfiles(profilesRes.data || []);
            setTieredRules(tieredRes.data || []);
        } catch (e) {
            console.error("Error loadPrices/profiles:", e);
            toast.error("Error al cargar datos de precios");
        } finally {
            setLoading(false);
        }
    };

    // [19/10/2026] La tarifa del área del artículo (por el área de su grupo) y cómo se cobra: en bordado todo
    // menos los cargos (matriz, relieve 3D, aplicación), que van por su precio de lista; en estampado, todo
    const tarifaDelArea = (item) => Object.values(tarifas).find(t => t && t.areas.includes(String(item.AreaGrupo || '').trim().toUpperCase())) || null;
    const cobroDe = (item) => {
        const t = tarifaDelArea(item);
        if (!t || t.cargos.includes(String(item.CodArticulo || '').trim())) return null;
        const tx = TEXTOS_TARIFA[t.tipo];
        return { etiqueta: tx.cobro, reemplazaLista: tx.reemplazaLista, pista: tx.pista };
    };

    const handlePriceChange = (id, changes) => {
        if (!id) return;
        setPendingChanges(prev => {
            const current = prev[id] || {};
            return { ...prev, [id]: { ...current, ...changes } };
        });
    };

    const handleTieredChange = (key, change) => {
        if (!key) return;
        setPendingTieredChanges(prev => {
            if (change === undefined) {
                const next = { ...prev };
                delete next[key];
                return next;
            }
            return { ...prev, [key]: change };
        });
    };

    const handleAddPrice = (sourceItem) => {
        const newMoneda = (sourceItem.Moneda === 'UYU') ? 'USD' : 'UYU';
        const newItem = {
            ...sourceItem,
            ID: null,
            _tempID: `new-${sourceItem.CodArticulo}-${Date.now()}`,
            Moneda: newMoneda,
            Precio: 0,
            _isNew: true
        };

        const index = prices.findIndex(p => p === sourceItem);
        const newPrices = [...prices];
        newPrices.splice(index + 1, 0, newItem);

        setPrices(newPrices);
        handlePriceChange(newItem._tempID, { precio: 0, moneda: newMoneda });
    };

    const handleSaveAll = async () => {
        const baseIds = Object.keys(pendingChanges);
        const tieredKeys = Object.keys(pendingTieredChanges);

        if (baseIds.length === 0 && tieredKeys.length === 0) return;

        // 1. Preparar precios base
        const baseToSave = [];
        baseIds.forEach(id => {
            const changes = pendingChanges[id];
            const item = prices.find(p => String(p.ID) === id || p._tempID === id);
            if (!item) return;

            baseToSave.push({
                id: item.ID,
                proIdProducto: item.ProIdProducto,
                codArticulo: item.CodArticulo,
                precio: changes.precio !== undefined ? parseFloat(changes.precio) : parseFloat(item.Precio || 0),
                moneda: changes.moneda !== undefined ? changes.moneda : (item.Moneda || 'UYU')
            });
        });

        // 2. Preparar escalas (con parsing a float seguro al momento de guardar)
        const tieredToSave = [];
        tieredKeys.forEach(key => {
            const change = pendingTieredChanges[key];
            if (!change) return;

            if (change.isTypeChangeOnly) return;

            tieredToSave.push({
                id: change.id,
                perfilId: change.perfilId,
                proIdProducto: change.proIdProducto,
                codArticulo: change.codArticulo,
                codGrupo: change.codGrupo,
                tipoRegla: change.tipoRegla,
                valor: change.valor !== undefined && change.valor !== '' && change.valor !== null ? parseFloat(change.valor) : null,
                moneda: change.moneda,
                cantidadMinima: change.cantidadMinima,
                action: change.action
            });
        });

        try {
            const promises = [];
            if (baseToSave.length > 0) {
                promises.push(api.post('/prices/base/bulk', { items: baseToSave }));
            }
            if (tieredToSave.length > 0) {
                promises.push(api.post('/prices/tiered/bulk', { items: tieredToSave }));
            }

            await Promise.all(promises);
            toast.success("Precios base y escalas guardados correctamente");
            setPendingChanges({});
            setPendingTieredChanges({});
            setAddedColumns({});
            loadPrices();
        } catch (e) {
            console.error("Error guardando cambios:", e);
            toast.error("Error al guardar: " + e.message);
        }
    };

    const handleAddQtyColumn = (profileId) => {
        setScaleModal({
            isOpen: true,
            type: 'add',
            profileId,
            oldQty: null,
            value: ''
        });
    };

    const handleRemoveQtyColumn = async (profileId, q) => {
        if (!(await confirmar({ titulo: `Quitar la escala Min ${q}`, texto: `¿Quitar escala Min ${q}? Se borrarán las reglas correspondientes al guardar.`, confirmar: 'Quitar', peligro: true }))) return;

        // Buscar reglas activas en DB para marcar de borrado.
        // Clave por rule.ID (no por CodArticulo): el mismo CodArticulo puede pertenecer a
        // más de un producto (ver comentario en pricesController.js sobre el código '28'
        // duplicado); con la clave vieja, dos reglas de productos distintos con igual
        // CodArticulo se pisaban entre sí y solo una llegaba a borrarse -> la columna
        // "reaparecía" después de guardar porque la otra regla seguía viva en la BD.
        const activeRules = tieredRules.filter(r => r.PerfilID === profileId && r.CantidadMinima === q);
        activeRules.forEach(rule => {
            const ruleKey = `del-${rule.ID}`;
            setPendingTieredChanges(prev => ({
                ...prev,
                [ruleKey]: {
                    id: rule.ID,
                    perfilId: profileId,
                    proIdProducto: rule.ProIdProducto,
                    codArticulo: rule.CodArticulo,
                    cantidadMinima: q,
                    action: 'delete'
                }
            }));
        });

        // Quitar de las columnas agregadas localmente
        setAddedColumns(prev => {
            const list = prev[profileId] || [];
            return { ...prev, [profileId]: list.filter(item => item !== q) };
        });

        // Limpiar cambios locales no guardados para esa columna
        setPendingTieredChanges(prev => {
            const next = { ...prev };
            Object.keys(next).forEach(key => {
                if (key.endsWith(`-${q}`) && key.startsWith(`${profileId}-`)) {
                    if (!next[key].id) delete next[key];
                }
            });
            return next;
        });

        // Eliminar del estado visual inmediatamente
        setTieredRules(prev => prev.filter(r => !(r.PerfilID === profileId && r.CantidadMinima === q)));
    };

    const handleRenameQtyColumn = (profileId, oldQty) => {
        setScaleModal({
            isOpen: true,
            type: 'edit',
            profileId,
            oldQty,
            value: String(oldQty)
        });
    };

    const handleScaleModalSubmit = () => {
        const { type, profileId, oldQty, value } = scaleModal;
        const num = parseInt(value);
        if (isNaN(num) || num <= 1) {
            return toast.error("La cantidad debe ser un número mayor a 1");
        }

        if (type === 'add') {
            const existingColumns = getQtyColumnsForProfile(profileId);
            if (existingColumns.includes(num)) {
                return toast.error(`La escala Min ${num} ya existe en este perfil`);
            }

            setAddedColumns(prev => {
                const list = prev[profileId] || [];
                if (list.includes(num)) return prev;
                return { ...prev, [profileId]: [...list, num].sort((a, b) => a - b) };
            });

            toast.success(`Columna 'Min ${num}' añadida. Ingrese valores y guarde.`);
        } else if (type === 'edit') {
            if (num === oldQty) {
                setScaleModal(prev => ({ ...prev, isOpen: false }));
                return;
            }

            const existingColumns = getQtyColumnsForProfile(profileId);
            if (existingColumns.includes(num) && num !== oldQty) {
                return toast.error(`La escala Min ${num} ya existe en este perfil`);
            }

            // 1. Actualizar las reglas cargadas en memoria
            setTieredRules(prev => prev.map(rule => {
                if (rule.PerfilID === profileId && rule.CantidadMinima === oldQty) {
                    const ruleKey = `${profileId}-${rule.CodArticulo}-${num}`;
                    const originalKey = `${profileId}-${rule.CodArticulo}-${oldQty}`;
                    
                    const existingChange = pendingTieredChanges[originalKey];
                    
                    setPendingTieredChanges(prevChanges => {
                        const next = { ...prevChanges };
                        delete next[originalKey];
                        next[ruleKey] = {
                            id: rule.ID,
                            perfilId: profileId,
                            proIdProducto: rule.ProIdProducto,
                            codArticulo: rule.CodArticulo,
                            cantidadMinima: num,
                            tipoRegla: existingChange?.tipoRegla || rule.TipoRegla,
                            valor: existingChange?.valor !== undefined ? existingChange.valor : rule.Valor,
                            moneda: existingChange?.moneda || rule.Moneda
                        };
                        return next;
                    });

                    return { ...rule, CantidadMinima: num };
                }
                return rule;
            }));

            // 2. Actualizar cambios locales totalmente nuevos (que no tienen ID en DB)
            setPendingTieredChanges(prevChanges => {
                const next = { ...prevChanges };
                Object.keys(next).forEach(key => {
                    if (key.endsWith(`-${oldQty}`) && key.startsWith(`${profileId}-`)) {
                        const change = next[key];
                        if (!change.id) {
                            const newKey = key.replace(`-${oldQty}`, `-${num}`);
                            delete next[key];
                            next[newKey] = {
                                ...change,
                                cantidadMinima: num
                            };
                        }
                    }
                });
                return next;
            });

            // 3. Actualizar columnas locales
            setAddedColumns(prev => {
                const list = prev[profileId] || [];
                return {
                    ...prev,
                    [profileId]: list.map(item => item === oldQty ? num : item).sort((a, b) => a - b)
                };
            });

            toast.success(`Escala modificada de Min ${oldQty} a Min ${num}. Recuerde guardar los cambios.`);
        }

        setScaleModal(prev => ({ ...prev, isOpen: false }));
    };

    const getProfileForGroup = (groupLabel) => {
        const upper = groupLabel.toUpperCase();
        let matchedCat = null;
        if (groupLabel === GRUPO_SALON) matchedCat = 'SALON';
        else if (upper.includes('DTF')) matchedCat = 'DTF';
        else if (upper.includes('TPU')) matchedCat = 'TPU';
        else if (upper.includes('IMPRESION DIRECTA') || upper.includes('IMD')) matchedCat = 'IMD';
        else if (upper.includes('SUBLIMAC') || upper.includes('SB')) matchedCat = 'SB';
        else if (upper.includes('ECOUV')) matchedCat = 'ECOUV';
        else if (upper.includes('ESTAMPAD')) matchedCat = 'Estampados';
        else if (upper.includes('BORDAD')) matchedCat = 'Bordado';

        if (!matchedCat) return null;
        return profiles.find(p => p.Categoria === matchedCat && p.Activo);
    };

    const getQtyColumnsForProfile = (profileId) => {
        if (!profileId) return [];
        const rules = tieredRules.filter(r => r.PerfilID === profileId);
        const quantities = new Set();
        rules.forEach(r => {
            if (r.CantidadMinima > 1) quantities.add(parseInt(r.CantidadMinima));
        });
        
        // Agregar columnas locales
        const localList = addedColumns[profileId] || [];
        localList.forEach(q => quantities.add(q));

        return Array.from(quantities).sort((a, b) => a - b);
    };

    const handleSimulate = () => {
        if (!simCode) return toast.error("Ingresa código de artículo");

        api.post('/prices/calculate', {
            codArticulo: simCode,
            cantidad: 1,
            clienteId: simClient || null
        })
            .then(res => setSimResult(res.data))
            .catch(e => toast.error("Error simulación: " + e.message));
    };

    // [23/10/2026] Qué artículos tienen precio por cantidad: escalas propias (Min 10, Min 100…) con valor, en un perfil
    // global activo. ProIdProducto → cantidades desde las que cambia. Se calcula solo: no hay que marcar el artículo.
    const escalasPorArticulo = useMemo(() => {
        const globales = new Set(profiles.filter(p => p.EsGlobal && p.Activo).map(p => p.ID));
        const mapa = new Map();
        tieredRules.forEach(r => {
            if (!globales.has(r.PerfilID) || !(Number(r.ProIdProducto) > 0) || !(Number(r.CantidadMinima) > 1) || !(Number(r.Valor) > 0)) return;
            const id = Number(r.ProIdProducto);
            mapa.set(id, [...new Set([...(mapa.get(id) || []), Number(r.CantidadMinima)])].sort((a, b) => a - b));
        });
        return mapa;
    }, [profiles, tieredRules]);

    // Lista según el switch Activos/Inactivos (Mostrar = 1 es activo en todo el sistema)
    const isArticleActive = (p) => p.Mostrar === true || p.Mostrar === 1;
    const visiblePrices = useMemo(() => {
        if (activeFilter === 'ALL') return prices;
        return prices.filter(p => activeFilter === 'ACTIVE' ? isArticleActive(p) : !isArticleActive(p));
    }, [prices, activeFilter]);

    // Agrupación optimizada con trim() para evitar carpetas duplicadas (ej: ECOUV)
    const groupedItems = useMemo(() => {
        const groups = {};
        visiblePrices.forEach(p => {
            const cleanSupFlia = (p.SupFlia || '').trim();
            const cleanGrupo = (p.Grupo || '').trim();
            const cleanRef = (p.NombreReferenciaGrupo || '').trim();

            let key = cleanSupFlia ? `${cleanSupFlia}${cleanGrupo ? ' - ' + cleanGrupo : ''}` : 'Otros / Sin Familia';
            if (cleanRef) {
                key += ` (${cleanRef})`;
            }
            if (CODSTOCK_SALON.includes((p.CodStock || '').trim())) key = GRUPO_SALON;
            
            if (!groups[key]) groups[key] = [];
            groups[key].push({
                ...p,
                SupFlia: cleanSupFlia,
                Grupo: cleanGrupo,
                NombreReferenciaGrupo: cleanRef
            });
        });

        const sortedKeys = Object.keys(groups).sort();
        const sortedGroups = {};
        sortedKeys.forEach(k => sortedGroups[k] = groups[k]);

        return sortedGroups;
    }, [visiblePrices]);

    // Nombre para mostrar de un grupo (la clave no cambia). Los artículos de una familia sin grupo asignado quedan con
    // la clave «1» (solo el número de la familia), que no dice nada: se muestran como «1 - Sin grupo».
    const familiaSinGrupo = (key) => {
        const p = groupedItems[key]?.[0];
        return p && p.SupFlia && !p.Grupo && !p.NombreReferenciaGrupo && key === p.SupFlia ? p.SupFlia : null;
    };
    const nombreGrupo = (key) => (familiaSinGrupo(key) ? `${key} - Sin grupo` : key);

    // Filtrar los productos del grupo seleccionado si se usa el buscador
    const getFilteredGroupItems = (groupName) => {
        const items = groupedItems[groupName] || [];
        if (!filter) return items;
        
        return items.filter(p =>
            (p.CodArticulo || '').toLowerCase().includes(filter.toLowerCase()) ||
            (p.Descripcion || '').toLowerCase().includes(filter.toLowerCase())
        );
    };

    // Lista de productos para la pestaña 'ALL' (buscador general)
    const allFiltered = useMemo(() => {
        if (!filter) return visiblePrices;
        return visiblePrices.filter(p =>
            (p.CodArticulo || '').toLowerCase().includes(filter.toLowerCase()) ||
            (p.Descripcion || '').toLowerCase().includes(filter.toLowerCase())
        );
    }, [visiblePrices, filter]);

    const changesCount = Object.keys(pendingChanges).length + Object.keys(pendingTieredChanges).length;

    // Seleccionar por defecto la primera categoría si es que no está en 'ALL' y ya cargaron los datos
    useEffect(() => {
        if (selectedGroupKey === 'ALL' && Object.keys(groupedItems).length > 0 && !filter) {
            setSelectedGroupKey(Object.keys(groupedItems)[0]);
        }
    }, [groupedItems, selectedGroupKey, filter]);

    // Simulador: dentro de la tarjeta del grupo, en la ruta suelta y embebido (así no queda un hueco al lado del grupo)
    const simulador = (
        <div className="w-full sm:w-auto">
            <span className={`${ETIQUETA} mb-1.5`}>Simular Precio</span>
            <div className="flex gap-2">
                <input className={`${CAMPO_CHICO} flex-1 sm:flex-none sm:w-32`} placeholder="Cód. Art." aria-label="Código de artículo a simular" value={simCode} onChange={e => setSimCode(e.target.value)} />
                <input className={`${CAMPO_CHICO} flex-1 sm:flex-none sm:w-28`} placeholder="Cliente ID" aria-label="ID del cliente a simular" value={simClient} onChange={e => setSimClient(e.target.value)} />
                <button onClick={handleSimulate} className={`${BTN_PRINCIPAL} px-3 shrink-0`} title="Simular precio" aria-label="Simular precio">
                    <Calculator size={16} />
                </button>
            </div>
        </div>
    );

    return (
        <div className={`px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4 ${changesCount > 0 ? 'pb-28' : ''}`}>
            {ventanaConfirmar}

            {/* FLOATING SAVE BAR (fija abajo: se ve aunque se baje por la lista) */}
            {changesCount > 0 && (
                <div className="fixed z-[5000] bottom-4 inset-x-3 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 bg-white border border-amber-200 rounded-2xl shadow-xl shadow-zinc-900/10 pl-4 pr-2 py-2 flex items-center gap-2 sm:gap-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                    <span className="text-sm text-zinc-700 flex-1 sm:flex-none whitespace-nowrap">
                        <span className="font-black text-amber-700 tabular-nums">{changesCount}</span> cambios<span className="hidden sm:inline"> pendientes</span>
                    </span>
                    <button
                        onClick={handleSaveAll}
                        className={`${BTN_PRINCIPAL} whitespace-nowrap`}
                    >
                        <Save size={15} /> Guardar Todo
                    </button>
                    <button
                        onClick={() => { 
                            setPendingChanges({}); 
                            setPendingTieredChanges({}); 
                            setAddedColumns({}); 
                            loadPrices(); 
                        }}
                        className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 transition-colors"
                        title="Descartar cambios"
                        aria-label="Descartar cambios"
                    >
                        <X size={17} />
                    </button>
                </div>
            )}

            {/* ENCABEZADO (embebido no va: ya está el de Precios y perfiles) */}
            {!embebido && (
                <div className="flex flex-wrap items-center gap-3">
                    <Tags size={30} className="text-brand-cyan shrink-0" />
                    <div className="min-w-[220px] flex-1">
                        <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Precios y Escalas de Volumen</h1>
                        <p className="text-sm text-zinc-500 mt-1">Gestiona precios base y escalas por volumen de forma integrada desde un solo lugar.</p>
                    </div>
                </div>
            )}

            {/* RESULTADO SIMULACION */}
            {simResult && (
                <div className={`${CARD} p-4`}>
                    <div className="flex justify-between items-start gap-3 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                            <Calculator size={18} className="text-brand-cyan shrink-0" />
                            <h3 className="font-black text-zinc-800 truncate">Resultado Simulación: <span className="font-mono">{simResult.codArticulo}</span></h3>
                        </div>
                        <button onClick={() => setSimResult(null)} title="Cerrar" aria-label="Cerrar la simulación"
                            className="text-zinc-400 hover:text-brand-magenta w-8 h-8 shrink-0 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors">
                            <X size={16} />
                        </button>
                    </div>
                    <div className="flex flex-col sm:flex-row gap-4 sm:gap-8">
                        <div className="text-3xl font-black text-zinc-900 tabular-nums whitespace-nowrap">
                            {simResult.moneda === 'USD' ? 'US$' : '$'} {simResult.precioTotal.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className="flex-1 min-w-0 sm:border-l border-zinc-100 sm:pl-6 text-sm">
                            {simResult.breakdown.map((step, i) => (
                                <div key={i} className="flex justify-between gap-3 py-1.5 border-b border-zinc-100 last:border-0">
                                    <span className="text-zinc-600">{step.desc}</span>
                                    <span className={`font-mono font-bold tabular-nums whitespace-nowrap ${step.valor < 0 ? 'text-emerald-600' : 'text-zinc-600'}`}>{step.valor > 0 ? '+' : ''}{step.valor.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* MAIN WORKSPACE: SIDEBAR + EDITOR PANE (en el celular, los filtros y el grupo arriba con Selector) */}
            <div className="flex flex-col lg:flex-row gap-4 lg:items-start">
                {conTabla ? (
                    /* SIDEBAR: Category list */
                    <div className={`${CARD} lg:w-80 shrink-0 flex flex-col overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100dvh-16rem)]`}>
                        <div className="px-4 py-3 border-b border-zinc-100 flex justify-between items-center gap-2 shrink-0">
                            <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Categorías / Familias</h3>
                            <span className="text-[11px] font-bold bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full tabular-nums">
                                {Object.keys(groupedItems).length} Grupos
                            </span>
                        </div>

                        {/* Buscador de productos rápido */}
                        <div className="p-3 border-b border-zinc-100 shrink-0 flex flex-col gap-2">
                            <div className="relative">
                                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                <input
                                    className={CAMPO}
                                    placeholder="Filtrar productos..."
                                    aria-label="Filtrar productos"
                                    value={filter}
                                    onChange={e => setFilter(e.target.value)}
                                />
                            </div>

                            {/* Switch Activos / Inactivos */}
                            <div className="flex rounded-xl border border-zinc-200 bg-white p-1 gap-1 select-none">
                                {[
                                    { key: 'ALL', label: 'Todos' },
                                    { key: 'ACTIVE', label: 'Activos' },
                                    { key: 'INACTIVE', label: 'Inactivos' }
                                ].map(opt => (
                                    <button
                                        key={opt.key}
                                        onClick={() => setActiveFilter(opt.key)}
                                        className={`flex-1 text-xs font-bold py-1.5 rounded-lg transition-colors ${activeFilter === opt.key
                                            ? 'bg-zinc-900 text-white'
                                            : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto p-2 flex flex-col gap-0.5">
                            {/* Pestaña Virtual de TODOS los productos */}
                            <button type="button" onClick={() => setSelectedGroupKey('ALL')} className={claseGrupo(selectedGroupKey === 'ALL')}>
                                <Globe size={16} className="text-brand-cyan shrink-0" />
                                <span className="flex-1 min-w-0 truncate">Todos los Productos</span>
                                <span className={claseContador(selectedGroupKey === 'ALL')}>
                                    {allFiltered.length}
                                </span>
                            </button>

                            {loading ? (
                                <div className="p-4 flex items-center justify-center gap-2 text-zinc-400 text-sm">
                                    <Loader2 size={16} className="animate-spin text-brand-cyan" /> Cargando...
                                </div>
                            ) : (
                                Object.keys(groupedItems).map(groupName => {
                                    const isSelected = selectedGroupKey === groupName;
                                    const items = getFilteredGroupItems(groupName);
                                    const profile = getProfileForGroup(groupName);

                                    if (filter && items.length === 0) return null;

                                    return (
                                        <button
                                            type="button"
                                            key={groupName}
                                            onClick={() => setSelectedGroupKey(groupName)}
                                            className={claseGrupo(isSelected)}
                                            title={nombreGrupo(groupName)}
                                        >
                                            {isSelected
                                                ? <FolderOpen size={16} className="text-brand-cyan shrink-0" />
                                                : <Folder size={16} className="text-brand-cyan shrink-0" />}
                                            <div className="flex-1 min-w-0">
                                                <div className="truncate">{nombreGrupo(groupName)}</div>
                                                {profile && (
                                                    <div className={`text-[10px] truncate mt-0.5 font-bold uppercase tracking-wide ${isSelected ? 'text-brand-cyan/80' : 'text-zinc-400'}`}>
                                                        {profile.Nombre}
                                                    </div>
                                                )}
                                            </div>
                                            <span className={claseContador(isSelected)}>
                                                {items.length}
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                ) : (
                    /* Celular: buscador, Activos / Inactivos y grupo, arriba */
                    <div className={`${CARD} p-3 flex flex-col gap-2`}>
                        <div className="relative">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            <input
                                className={CAMPO}
                                placeholder="Filtrar productos..."
                                aria-label="Filtrar productos"
                                value={filter}
                                onChange={e => setFilter(e.target.value)}
                            />
                        </div>
                        <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2">
                            <Selector filtro resaltar={false} className="w-full" value={activeFilter} onChange={e => setActiveFilter(e.target.value)} aria-label="Estado de los artículos">
                                <option value="ALL">Todos</option>
                                <option value="ACTIVE">Activos</option>
                                <option value="INACTIVE">Inactivos</option>
                            </Selector>
                            <Selector filtro resaltar={false} className="w-full" value={selectedGroupKey} onChange={e => setSelectedGroupKey(e.target.value)} aria-label="Grupo" anchoLista={300}>
                                <option value="ALL" descripcion={`${allFiltered.length} productos`}>Todos los Productos</option>
                                {!loading && Object.keys(groupedItems).map(groupName => {
                                    const items = getFilteredGroupItems(groupName);
                                    const profile = getProfileForGroup(groupName);
                                    if (filter && items.length === 0) return null;
                                    return (
                                        <option key={groupName} value={groupName} descripcion={`${items.length} productos${profile ? ` · ${profile.Nombre}` : ''}`}>
                                            {nombreGrupo(groupName)}
                                        </option>
                                    );
                                })}
                            </Selector>
                        </div>
                        {loading && (
                            <div className="flex items-center gap-2 text-zinc-400 text-sm px-1">
                                <Loader2 size={16} className="animate-spin text-brand-cyan" /> Cargando...
                            </div>
                        )}
                    </div>
                )}

                {/* EDITOR PANE: Main product table grid */}
                <div className="flex-1 min-w-0 flex flex-col gap-4">
                    {selectedGroupKey ? (
                        (() => {
                            const isAllTab = selectedGroupKey === 'ALL';
                            const items = isAllTab ? allFiltered : getFilteredGroupItems(selectedGroupKey);
                            const profile = isAllTab ? null : getProfileForGroup(selectedGroupKey);
                            const qtyColumns = profile ? getQtyColumnsForProfile(profile.ID) : [];
                            const unidad = unidadDelGrupo(items, profile);
                            const metricUnit = unidad.corta;

                            // Prepend TOTAL virtual row: nunca si se pide ocultarla (vista Marketing),
                            // y en el resto de los casos solo si el usuario la abrió (colapsada por defecto)
                            const groupItems = (profile && items.length > 0 && !hideGeneralRow && showGeneralRow) ? [
                                {
                                    ID: null,
                                    _tempID: `total-${profile.ID}`,
                                    CodArticulo: 'TOTAL',
                                    Descripcion: 'Aplica a TODOS (General)',
                                    Precio: '-',
                                    Moneda: 'USD',
                                    ProIdProducto: 0,
                                    _isVirtualTotal: true
                                },
                                ...items
                            ] : items;

                            return (
                                <>
                                    {/* Editor Header */}
                                    <div className={`${CARD} p-4 flex flex-wrap items-center gap-3`}>
                                        <div className="min-w-[220px] flex-1">
                                            <h2 className="text-lg font-black text-zinc-800 leading-tight">
                                                {isAllTab ? 'Catálogo General de Precios' : nombreGrupo(selectedGroupKey)}
                                            </h2>
                                            {profile && (
                                                <p className="text-sm text-zinc-500 mt-1">
                                                    Perfil: <span className="font-bold text-brand-cyan">{profile.Nombre}</span> · Métrica: <span className="font-bold text-brand-cyan uppercase">{unidad.nombre}</span>
                                                </p>
                                            )}
                                            {!isAllTab && !profile && (
                                                <p className="text-sm text-zinc-500 mt-1">
                                                    {items.length} producto{items.length !== 1 ? 's' : ''}
                                                    {familiaSinGrupo(selectedGroupKey) ? ` de la familia ${familiaSinGrupo(selectedGroupKey)} que no tienen grupo asignado` : ''} · sin perfil de escalas
                                                </p>
                                            )}
                                            {isAllTab && (
                                                <p className="text-sm text-zinc-400 mt-1">Muestra la lista de precios estándar para todo el catálogo.</p>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                                            {/* Toggle para mostrar/ocultar la fila "Aplica a TODOS (General)" */}
                                            {profile && items.length > 0 && !hideGeneralRow && (
                                                <button
                                                    onClick={() => setShowGeneralRow(v => !v)}
                                                    className={`${BTN_SECUNDARIO} flex-1 sm:flex-none`}
                                                    title={showGeneralRow ? 'Ocultar la fila General' : 'Mostrar la fila "Aplica a TODOS (General)"'}
                                                >
                                                    {showGeneralRow ? <ChevronUp size={15} className="text-brand-cyan" /> : <ChevronDown size={15} className="text-brand-cyan" />}
                                                    {showGeneralRow ? 'Ocultar General' : 'Ver General'}
                                                </button>
                                            )}
                                            {/* Botón para añadir escala de cantidad */}
                                            {profile && items.length > 0 && (
                                                <button
                                                    onClick={() => handleAddQtyColumn(profile.ID)}
                                                    className={`${BTN_PRINCIPAL} flex-1 sm:flex-none`}
                                                >
                                                    <Plus size={15} /> Agregar Escala
                                                </button>
                                            )}
                                        </div>

                                        {simulador}

                                        {/* Celular: las escalas del grupo (en la tabla se cambian y se quitan desde el encabezado de cada columna) */}
                                        {!conTabla && profile && qtyColumns.length > 0 && (
                                            <div className="w-full pt-3 border-t border-zinc-100">
                                                <span className={`${ETIQUETA} mb-1.5`}>Escalas por volumen</span>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {qtyColumns.map(q => (
                                                        <span key={q} className="inline-flex items-center rounded-xl border border-zinc-200 bg-white overflow-hidden">
                                                            <button
                                                                onClick={() => handleRenameQtyColumn(profile.ID, q)}
                                                                className="inline-flex items-center gap-1.5 pl-2.5 pr-2 py-1.5 text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors"
                                                                title="Haga clic para renombrar o cambiar la cantidad de este rango"
                                                            >
                                                                Min {q} {metricUnit}
                                                                <Pencil size={11} className="text-brand-cyan" />
                                                            </button>
                                                            <button
                                                                onClick={() => handleRemoveQtyColumn(profile.ID, q)}
                                                                className="px-2 py-1.5 border-l border-zinc-200 text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 transition-colors"
                                                                title={`Eliminar rango Min ${q}`}
                                                                aria-label={`Eliminar rango Min ${q}`}
                                                            >
                                                                <X size={13} />
                                                            </button>
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Table Grid container */}
                                    {/* [19/10/2026] Grupo de Bordado o Estampado: su tarifa, arriba de la tabla */}
                                    {!isAllTab && (() => {
                                        const t = items.map(tarifaDelArea).find(Boolean);
                                        return t ? <TarifaPanel key={JSON.stringify(t)} tarifa={t} onGuardada={(n) => setTarifas(prev => ({ ...prev, [n.tipo]: n }))} /> : null;
                                    })()}
                                    {items.length === 0 ? (
                                        <div className={`${CARD} px-4 py-14 flex flex-col items-center justify-center text-center`}>
                                            <SearchX size={40} className="mb-3 text-brand-cyan" />
                                            <span className="text-sm font-bold text-zinc-700">No se encontraron productos en esta sección.</span>
                                            {filter && <span className="text-xs text-zinc-400 mt-1">Probá con otra búsqueda o mirá en Todos / Inactivos.</span>}
                                        </div>
                                    ) : conTabla ? (
                                        <div className={`${CARD} overflow-hidden`}>
                                            {/* Scroll propio solo de la tabla: así el encabezado (las escalas) queda fijo arriba */}
                                            <div className="overflow-auto max-h-[calc(100dvh-17rem)]">
                                                <table className="w-full text-left text-sm border-collapse">
                                                    <thead className="bg-zinc-50 sticky top-0 z-10 shadow-[0_1px_0_0_#e4e4e7] select-none">
                                                        <tr>
                                                            <th className={`${TH} w-28 text-left`}>Código</th>
                                                            <th className={`${TH} text-left`}>Producto</th>
                                                            <th className={`${TH} text-right w-32`}>Precio Base</th>
                                                            <th className={`${TH} text-center w-28`}>Moneda</th>
                                                            {qtyColumns.map(q => (
                                                                <th key={q} className={`${TH} text-center w-32`}>
                                                                    <div className="inline-flex items-center gap-1">
                                                                        {profile ? (
                                                                            <span
                                                                                onClick={() => handleRenameQtyColumn(profile.ID, q)}
                                                                                className="cursor-pointer hover:text-brand-cyan inline-flex items-center gap-1 transition-colors"
                                                                                title="Haga clic para renombrar o cambiar la cantidad de este rango"
                                                                            >
                                                                                Min {q} {metricUnit}
                                                                                <Pencil size={10} className="text-brand-cyan" />
                                                                            </span>
                                                                        ) : (
                                                                            `Min ${q} ${metricUnit}`
                                                                        )}

                                                                        {profile && (
                                                                            <button
                                                                                onClick={() => handleRemoveQtyColumn(profile.ID, q)}
                                                                                className="w-5 h-5 rounded-md flex items-center justify-center text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/10 transition-colors"
                                                                                title={`Eliminar rango Min ${q}`}
                                                                                aria-label={`Eliminar rango Min ${q}`}
                                                                            >
                                                                                <X size={12} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </th>
                                                            ))}
                                                            {qtyColumns.length > 0 && <th className="w-12"></th>}
                                                            <th className={`${TH} w-16`}></th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-zinc-100">
                                                        {groupItems.map(item => (
                                                            <PriceRow
                                                                key={item.ID || item._tempID}
                                                                item={item}
                                                                changes={pendingChanges[item.ID || item._tempID]}
                                                                onChange={handlePriceChange}
                                                                onAdd={handleAddPrice}
                                                                qtyColumns={qtyColumns}
                                                                profileRules={profile ? tieredRules.filter(r => r.PerfilID === profile.ID) : []}
                                                                pendingTieredChanges={pendingTieredChanges}
                                                                onTieredChange={handleTieredChange}
                                                                profile={profile}
                                                                hideAddCurrency={hideAddCurrency}
                                                                cobroTecnico={item._isVirtualTotal ? null : cobroDe(item)}
                                                                escalasDelArticulo={escalasPorArticulo.get(Number(item.ProIdProducto)) || null}
                                                            />
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    ) : (
                                        /* Celular: una tarjeta por artículo, con los mismos campos que la fila */
                                        <div className="flex flex-col gap-2.5">
                                            {groupItems.map(item => (
                                                <PriceRow
                                                    tarjeta
                                                    unidadEscala={metricUnit}
                                                    key={item.ID || item._tempID}
                                                    item={item}
                                                    changes={pendingChanges[item.ID || item._tempID]}
                                                    onChange={handlePriceChange}
                                                    onAdd={handleAddPrice}
                                                    qtyColumns={qtyColumns}
                                                    profileRules={profile ? tieredRules.filter(r => r.PerfilID === profile.ID) : []}
                                                    pendingTieredChanges={pendingTieredChanges}
                                                    onTieredChange={handleTieredChange}
                                                    profile={profile}
                                                    hideAddCurrency={hideAddCurrency}
                                                    cobroTecnico={item._isVirtualTotal ? null : cobroDe(item)}
                                                    escalasDelArticulo={escalasPorArticulo.get(Number(item.ProIdProducto)) || null}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </>
                            );
                        })()
                    ) : (
                        <div className={`${CARD} p-8 flex flex-col items-center justify-center text-center gap-2`}>
                            <FolderOpen size={40} className="text-brand-cyan" />
                            <h3 className="text-sm font-bold text-zinc-700">Selecciona una categoría</h3>
                            <p className="max-w-xs text-xs text-zinc-400">Elige una familia de productos en el listado de la izquierda para ver y editar sus precios.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* MODAL PARA AGREGAR/MODIFICAR ESCALA */}
            {scaleModal.isOpen && (
                <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-4" onClick={() => setScaleModal(prev => ({ ...prev, isOpen: false }))}>
                    <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-sm overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        {/* Header */}
                        <div className="px-5 py-4 border-b border-zinc-100 flex justify-between items-center gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                                <Layers size={18} className="text-brand-cyan shrink-0" />
                                <h3 className="text-base font-black text-zinc-900">
                                    {scaleModal.type === 'add' ? 'Agregar Escala de Volumen' : 'Modificar Escala de Volumen'}
                                </h3>
                            </div>
                            <button
                                onClick={() => setScaleModal(prev => ({ ...prev, isOpen: false }))}
                                className="text-zinc-400 hover:text-brand-magenta w-8 h-8 shrink-0 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors"
                                aria-label="Cerrar"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="p-5">
                            <label className={`${ETIQUETA} mb-1.5`}>
                                Cantidad Mínima ({selectedGroupKey && unidadDelGrupo(getFilteredGroupItems(selectedGroupKey), getProfileForGroup(selectedGroupKey)).corta})
                            </label>
                            <input
                                type="number"
                                min="2"
                                className="w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-bold font-mono tabular-nums text-zinc-800 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
                                    placeholder="Ej: 50"
                                    value={scaleModal.value}
                                    onChange={(e) => setScaleModal(prev => ({ ...prev, value: e.target.value }))}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleScaleModalSubmit();
                                    }}
                                    autoFocus
                                />
                            <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
                                {scaleModal.type === 'add' 
                                    ? 'Ingrese el volumen a partir del cual se aplicará esta escala.' 
                                    : `Cambiando el volumen mínimo anterior de ${scaleModal.oldQty} ${selectedGroupKey ? unidadDelGrupo(getFilteredGroupItems(selectedGroupKey), getProfileForGroup(selectedGroupKey)).nombre.toLowerCase() : 'unidades'}.`}
                            </p>
                        </div>

                        {/* Footer */}
                        <div className="px-5 py-3.5 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-2">
                            <button
                                onClick={() => setScaleModal(prev => ({ ...prev, isOpen: false }))}
                                className={BTN_SECUNDARIO}
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleScaleModalSubmit}
                                className={BTN_PRINCIPAL}
                            >
                                {scaleModal.type === 'add' ? 'Aceptar' : 'Guardar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BasePrices;
