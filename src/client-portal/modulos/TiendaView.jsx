import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    ShoppingCart, Search, Package, Plus, Minus, Trash2, X,
    Store, ArrowRight, ImageOff, Sparkles, Scissors
} from 'lucide-react';
import { apiClient } from '../api/apiClient';
import { useToast } from '../pautas/Toast';

/*
 * [TIENDA] Vitrina del e-commerce del portal — F1 (plan: docs/ecommerce-portal-plan.md).
 *
 * Catálogo: GET /web-orders/tienda/catalogo (solo publicados en TiendaProductos).
 * Regla central: AL CARRITO SOLO ENTRAN LOS TERMINADOS (precio cerrado de PreciosBase).
 * Personalizados y confeccionados dependen de decoración/talles/medidas → no se pueden
 * cotizar al momento: su ficha muestra "precio a cotizar" e inicia un pedido normal
 * (F3 les va a precargar el producto en el form; por ahora llevan al catálogo de servicios).
 *
 * El checkout real es F2 — el botón del carrito queda deshabilitado con el aviso.
 * Carrito persistido en localStorage ('tienda_carrito'), fusionando por producto+variante.
 */

const SOLAPAS = [
    { id: 'TODOS', label: 'Todo' },
    { id: 'TERMINADO', label: 'Terminados' },
    { id: 'PERSONALIZADO', label: 'Personalizados' },
    { id: 'CONFECCIONADO', label: 'Confeccionados' },
];

const fmt = (n, moneda) =>
    (moneda === 'USD' ? 'US$ ' : '$ ') + (Number(n) || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 });

// Los 3 tipos comparten ficha; el chip identifica al producto cuando la solapa es "Todo".
// Va SOBRE la foto (esquina) y no en el bloque de texto: en mobile la grilla es de 2 columnas
// y el chip en línea ocupaba un renglón entero. Colores sólidos porque el fondo es blanco.
const CHIP_TIPO = {
    TERMINADO: { texto: 'En stock', cls: 'bg-emerald-500 text-white' },
    PERSONALIZADO: { texto: 'Personalizado', cls: 'bg-brand-cyan text-zinc-900' },
    CONFECCIONADO: { texto: 'A medida', cls: 'bg-purple-500 text-white' },
};

export const TiendaView = () => {
    const navigate = useNavigate();
    const { addToast } = useToast();

    const [catalogo, setCatalogo] = useState([]);
    const [cotizacionDolar, setCotizacionDolar] = useState(null);
    const [loading, setLoading] = useState(true);
    const [solapa, setSolapa] = useState('TODOS');
    const [categoria, setCategoria] = useState('');
    const [busqueda, setBusqueda] = useState('');
    const [ficha, setFicha] = useState(null);          // producto abierto en el modal
    const [carritoAbierto, setCarritoAbierto] = useState(false);

    const [carrito, setCarrito] = useState(() => {
        try { return JSON.parse(localStorage.getItem('tienda_carrito') || '[]'); } catch { return []; }
    });
    useEffect(() => { localStorage.setItem('tienda_carrito', JSON.stringify(carrito)); }, [carrito]);

    useEffect(() => {
        apiClient.get('/web-orders/tienda/catalogo')
            .then(res => {
                setCatalogo(res?.data || []);
                setCotizacionDolar(res?.cotizacionDolar || null);
            })
            .catch(() => addToast('No se pudo cargar la tienda. Probá de nuevo en un rato.', 'error'))
            .finally(() => setLoading(false));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Filtros: solapa → categoría → texto. Las categorías salen de lo que hay en la solapa actual.
    const productosSolapa = useMemo(() => (
        solapa === 'TODOS' ? catalogo : catalogo.filter(p => p.tipo === solapa)
    ), [catalogo, solapa]);
    const categorias = useMemo(() => (
        [...new Set(productosSolapa.map(p => (p.categoria || '').trim()).filter(Boolean))]
    ), [productosSolapa]);
    useEffect(() => { setCategoria(''); }, [solapa]);
    const productos = useMemo(() => {
        const q = busqueda.trim().toLowerCase();
        return productosSolapa
            .filter(p => !categoria || (p.categoria || '').trim() === categoria)
            .filter(p => !q || `${p.titulo} ${p.descripcion || ''} ${p.categoria || ''}`.toLowerCase().includes(q));
    }, [productosSolapa, categoria, busqueda]);

    // ── Carrito (solo TERMINADOS) ────────────────────────────────────────────
    const itemsCarrito = carrito.reduce((s, it) => s + (parseInt(it.cantidad, 10) || 0), 0);
    const totales = useMemo(() => {
        const t = {};
        carrito.forEach(it => { t[it.moneda] = (t[it.moneda] || 0) + (it.precio * it.cantidad); });
        return t;
    }, [carrito]);
    // Aproximado en pesos cuando conviven monedas (informativo; el cobro real es F2/caja).
    const totalAproxUYU = (totales.UYU || 0) + (cotizacionDolar ? (totales.USD || 0) * cotizacionDolar : 0);
    const monedasMezcladas = Object.keys(totales).length > 1;

    const agregarAlCarrito = (producto, variante, cantidad) => {
        const key = `${producto.proIdProducto}:${variante.wmsVarianteId}`;
        setCarrito(prev => {
            const idx = prev.findIndex(it => `${it.proIdProducto}:${it.wmsVarianteId}` === key);
            if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], cantidad: next[idx].cantidad + cantidad };
                return next;
            }
            return [...prev, {
                proIdProducto: producto.proIdProducto,
                wmsVarianteId: variante.wmsVarianteId,
                titulo: producto.titulo,
                variante: variante.nombre,
                sku: variante.sku || '',
                precio: variante.precio,
                moneda: variante.moneda,
                foto: producto.fotos?.[0] || null,
                cantidad,
            }];
        });
        addToast('Agregado al carrito.', 'success');
        setFicha(null);
    };
    const cambiarCantidad = (key, delta) => setCarrito(prev => prev
        .map(it => `${it.proIdProducto}:${it.wmsVarianteId}` === key
            ? { ...it, cantidad: Math.max(1, it.cantidad + delta) } : it));
    const quitarItem = (key) => setCarrito(prev => prev.filter(it => `${it.proIdProducto}:${it.wmsVarianteId}` !== key));

    // Personalizados/confeccionados: inician un pedido normal (precio por cotización).
    // F3: precargar el producto elegido en el form vía location.state.
    const iniciarPedido = () => { setFicha(null); navigate('/portal'); };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black tracking-tight text-zinc-100 flex items-center gap-3">
                        <Store className="text-brand-cyan" size={28} /> Tienda
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1">Productos listos, personalizados y confeccionados a medida.</p>
                </div>
                <button
                    onClick={() => setCarritoAbierto(true)}
                    className="relative flex items-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-700 bg-custom-dark text-zinc-200 hover:border-brand-cyan/50 transition-colors text-sm font-bold"
                >
                    <ShoppingCart size={18} /> Carrito
                    {itemsCarrito > 0 && (
                        <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full bg-brand-cyan text-zinc-900 text-[11px] font-black flex items-center justify-center">
                            {itemsCarrito}
                        </span>
                    )}
                </button>
            </div>

            {/* Solapas + búsqueda */}
            <div className="flex flex-col md:flex-row md:items-center gap-3">
                {/* `no-scrollbar` (src/index.css) — "scrollbar-hide" no existe en este proyecto y
                    dejaba la barra visible abajo de las solapas en mobile. */}
                <div className="flex gap-1.5 md:gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
                    {SOLAPAS.map(s => (
                        <button
                            key={s.id}
                            onClick={() => setSolapa(s.id)}
                            className={`px-3 md:px-4 py-2 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-wide whitespace-nowrap border transition-colors shrink-0 ${solapa === s.id
                                ? 'bg-brand-cyan/10 border-brand-cyan/50 text-brand-cyan'
                                : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'}`}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>
                <div className="relative md:ml-auto md:w-72">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                    <input
                        value={busqueda}
                        onChange={e => setBusqueda(e.target.value)}
                        placeholder="Buscar en la tienda..."
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-custom-dark border border-zinc-800 focus:border-brand-cyan/50 outline-none text-sm text-zinc-200 placeholder:text-zinc-600"
                    />
                </div>
            </div>

            {/* Categorías de la solapa — misma fila deslizable sin barra que las solapas */}
            {categorias.length > 0 && (
                <div className="flex gap-2 overflow-x-auto no-scrollbar -mx-4 px-4 md:mx-0 md:px-0">
                    <button onClick={() => setCategoria('')} className={`px-3 py-1.5 rounded-full text-[11px] font-bold border whitespace-nowrap shrink-0 transition-colors ${!categoria ? 'border-zinc-400 text-zinc-200' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>Todas</button>
                    {categorias.map(c => (
                        <button key={c} onClick={() => setCategoria(c)} className={`px-3 py-1.5 rounded-full text-[11px] font-bold border whitespace-nowrap shrink-0 transition-colors ${categoria === c ? 'border-zinc-400 text-zinc-200' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>{c}</button>
                    ))}
                </div>
            )}

            {/* Grilla */}
            {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                    {Array.from({ length: 10 }).map((_, i) => (
                        <div key={i} className="rounded-2xl border border-zinc-800 bg-custom-dark h-56 animate-pulse" />
                    ))}
                </div>
            ) : productos.length === 0 ? (
                <div className="py-24 text-center text-zinc-600">
                    <Store size={44} className="mx-auto mb-4 opacity-40" />
                    <p className="font-bold text-zinc-500">No hay productos {busqueda ? 'para esa búsqueda' : 'en esta sección todavía'}.</p>
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                    {productos.map(p => {
                        const chip = CHIP_TIPO[p.tipo] || CHIP_TIPO.TERMINADO;
                        return (
                            <button
                                key={p.proIdProducto}
                                onClick={() => setFicha(p)}
                                className="text-left rounded-2xl border border-zinc-800 bg-custom-dark overflow-hidden hover:border-brand-cyan/40 hover:shadow-xl hover:shadow-black/30 transition-all group"
                            >
                                <div className="relative aspect-square bg-white flex items-center justify-center overflow-hidden">
                                    <span className={`absolute top-2 left-2 z-10 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wide ${chip.cls}`}>{chip.texto}</span>
                                    {p.fotos?.length ? (
                                        <img src={p.fotos[0]} alt={p.titulo} className="w-full h-full object-contain group-hover:scale-105 transition-transform duration-500" />
                                    ) : (
                                        <ImageOff size={36} className="text-zinc-300" />
                                    )}
                                </div>
                                <div className="p-3 space-y-1">
                                    <p className="text-sm font-bold text-zinc-200 leading-snug line-clamp-2">{p.titulo}</p>
                                    {p.tipo === 'TERMINADO' ? (
                                        <p className="text-base font-black text-zinc-100">{p.precio != null ? fmt(p.precio, p.moneda) : 'Consultar'}</p>
                                    ) : (
                                        <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wide">Precio a cotizar</p>
                                    )}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Ficha de producto */}
            {ficha && (
                <FichaProducto
                    producto={ficha}
                    onCerrar={() => setFicha(null)}
                    onAgregar={agregarAlCarrito}
                    onIniciarPedido={iniciarPedido}
                />
            )}

            {/* Carrito */}
            {carritoAbierto && (
                <div className="fixed inset-0 z-[9000]">
                    <div className="absolute inset-0 bg-black/70" onClick={() => setCarritoAbierto(false)} />
                    <aside className="absolute right-0 top-0 h-full w-full max-w-md bg-custom-dark border-l border-zinc-800 flex flex-col">
                        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
                            <h2 className="font-black text-zinc-100 flex items-center gap-2"><ShoppingCart size={18} /> Tu carrito</h2>
                            <button onClick={() => setCarritoAbierto(false)} className="w-8 h-8 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-200 flex items-center justify-center"><X size={16} /></button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-3">
                            {carrito.length === 0 ? (
                                <div className="py-16 text-center text-zinc-600">
                                    <Package size={36} className="mx-auto mb-3 opacity-40" />
                                    <p className="text-sm font-bold text-zinc-500">Todavía no agregaste nada.</p>
                                </div>
                            ) : carrito.map(it => {
                                const key = `${it.proIdProducto}:${it.wmsVarianteId}`;
                                return (
                                    <div key={key} className="flex gap-3 p-3 rounded-xl border border-zinc-800 bg-zinc-900/60">
                                        <div className="w-14 h-14 rounded-lg bg-white shrink-0 flex items-center justify-center overflow-hidden">
                                            {it.foto ? <img src={it.foto} alt="" className="w-full h-full object-contain" /> : <ImageOff size={18} className="text-zinc-300" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-bold text-zinc-200 truncate">{it.titulo}</p>
                                            {it.variante && it.variante !== 'Única' && <p className="text-[11px] text-zinc-500">{it.variante}</p>}
                                            <div className="flex items-center justify-between mt-1.5">
                                                <div className="flex items-center gap-1">
                                                    <button onClick={() => cambiarCantidad(key, -1)} className="w-6 h-6 rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-100 flex items-center justify-center"><Minus size={12} /></button>
                                                    <span className="w-8 text-center text-xs font-black text-zinc-200">{it.cantidad}</span>
                                                    <button onClick={() => cambiarCantidad(key, +1)} className="w-6 h-6 rounded-md border border-zinc-700 text-zinc-400 hover:text-zinc-100 flex items-center justify-center"><Plus size={12} /></button>
                                                </div>
                                                <p className="text-sm font-black text-zinc-100">{fmt(it.precio * it.cantidad, it.moneda)}</p>
                                            </div>
                                        </div>
                                        <button onClick={() => quitarItem(key)} className="self-start text-zinc-600 hover:text-red-400 transition-colors"><Trash2 size={15} /></button>
                                    </div>
                                );
                            })}
                        </div>

                        {carrito.length > 0 && (
                            <div className="p-5 border-t border-zinc-800 space-y-3">
                                <div className="space-y-1">
                                    {Object.entries(totales).map(([mon, tot]) => (
                                        <div key={mon} className="flex justify-between text-sm">
                                            <span className="text-zinc-500 font-bold">Total {mon}</span>
                                            <span className="font-black text-zinc-100">{fmt(tot, mon)}</span>
                                        </div>
                                    ))}
                                    {monedasMezcladas && cotizacionDolar && (
                                        <div className="flex justify-between text-[11px] text-zinc-500">
                                            <span>≈ Total en pesos (cotiz. {cotizacionDolar})</span>
                                            <span className="font-bold">{fmt(totalAproxUYU, 'UYU')}</span>
                                        </div>
                                    )}
                                </div>
                                {/* F2: acá se enchufa el checkout (VEN- con el cliente del token). */}
                                <button
                                    disabled
                                    className="w-full py-3 rounded-xl bg-zinc-800 text-zinc-500 text-sm font-black uppercase tracking-wide cursor-not-allowed"
                                    title="El checkout se habilita en la próxima actualización"
                                >
                                    Confirmar compra
                                </button>
                                <p className="text-[11px] text-center text-zinc-600">Muy pronto: confirmá y retirá en el local. Pagás al retirar.</p>
                            </div>
                        )}
                    </aside>
                </div>
            )}
        </div>
    );
};

// ── Ficha de producto (modal) ────────────────────────────────────────────────
const FichaProducto = ({ producto, onCerrar, onAgregar, onIniciarPedido }) => {
    // Sin mapeo WMS no hay variantes: se ofrece una "Única" apoyada en el precio base —
    // mismo fallback que usa el catálogo interno (wms_variante_id = ProIdProducto).
    const variantes = producto.variantes?.length ? producto.variantes : [{
        wmsVarianteId: producto.proIdProducto, sku: '', nombre: 'Única',
        precio: producto.precio, moneda: producto.moneda, stock: null,
    }];
    const [varSel, setVarSel] = useState(variantes[0]);
    const [cantidad, setCantidad] = useState(1);
    const [fotoIdx, setFotoIdx] = useState(0);
    const esTerminado = producto.tipo === 'TERMINADO';
    const sinPrecio = varSel?.precio == null;

    return (
        <div className="fixed inset-0 z-[9000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/70" onClick={onCerrar} />
            <div className="relative bg-custom-dark border border-zinc-700/60 rounded-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
                <button onClick={onCerrar} className="absolute top-3 right-3 z-10 w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-700 text-zinc-400 hover:text-zinc-100 flex items-center justify-center"><X size={16} /></button>

                <div className="grid md:grid-cols-2 gap-0">
                    {/* Fotos */}
                    <div className="p-4 space-y-2">
                        <div className="aspect-square rounded-xl bg-white flex items-center justify-center overflow-hidden">
                            {producto.fotos?.length ? (
                                <img src={producto.fotos[fotoIdx] || producto.fotos[0]} alt={producto.titulo} className="w-full h-full object-contain" />
                            ) : (
                                <ImageOff size={48} className="text-zinc-300" />
                            )}
                        </div>
                        {producto.fotos?.length > 1 && (
                            <div className="flex gap-2 overflow-x-auto">
                                {producto.fotos.map((f, i) => (
                                    <button key={i} onClick={() => setFotoIdx(i)} className={`w-14 h-14 rounded-lg bg-white shrink-0 overflow-hidden border-2 ${fotoIdx === i ? 'border-brand-cyan' : 'border-transparent'}`}>
                                        <img src={f} alt="" className="w-full h-full object-contain" />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Datos */}
                    <div className="p-5 md:pr-8 space-y-4">
                        {producto.categoria && <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500">{producto.categoria}</p>}
                        <h2 className="text-xl font-black text-zinc-100 leading-tight">{producto.titulo}</h2>
                        {producto.descripcion && <p className="text-sm text-zinc-400 whitespace-pre-line">{producto.descripcion}</p>}

                        {esTerminado ? (
                            <>
                                <p className="text-2xl font-black text-zinc-100">{sinPrecio ? 'Consultar' : fmt(varSel.precio, varSel.moneda)}</p>

                                {variantes.length > 1 && (
                                    <div>
                                        <p className="text-xs font-bold uppercase text-zinc-500 mb-2">Variante</p>
                                        <div className="flex gap-2 flex-wrap">
                                            {variantes.map(v => (
                                                <button
                                                    key={v.wmsVarianteId}
                                                    onClick={() => setVarSel(v)}
                                                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${varSel?.wmsVarianteId === v.wmsVarianteId
                                                        ? 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan'
                                                        : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}
                                                >
                                                    {v.nombre}
                                                    {v.precio != null && v.precio !== varSel?.precio && <span className="ml-1 opacity-70">{fmt(v.precio, v.moneda)}</span>}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Stock informativo: nunca bloquea (se vende también sin stock) */}
                                {varSel?.stock != null && (
                                    varSel.stock > 0
                                        ? <p className="text-xs font-bold text-emerald-400">En stock: {varSel.stock}</p>
                                        : <p className="text-xs font-bold text-amber-400">Sin stock — se prepara a pedido</p>
                                )}

                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1 border border-zinc-700 rounded-xl px-2 py-1.5">
                                        <button onClick={() => setCantidad(c => Math.max(1, c - 1))} className="w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-100 flex items-center justify-center"><Minus size={14} /></button>
                                        <span className="w-10 text-center font-black text-zinc-100">{cantidad}</span>
                                        <button onClick={() => setCantidad(c => c + 1)} className="w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-100 flex items-center justify-center"><Plus size={14} /></button>
                                    </div>
                                    <button
                                        onClick={() => onAgregar(producto, varSel, cantidad)}
                                        disabled={sinPrecio}
                                        className={`flex-1 py-3 rounded-xl text-sm font-black uppercase tracking-wide transition-colors ${sinPrecio
                                            ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                                            : 'bg-brand-cyan text-zinc-900 hover:bg-brand-cyan/90'}`}
                                    >
                                        <span className="inline-flex items-center gap-2"><ShoppingCart size={16} /> Agregar</span>
                                    </button>
                                </div>
                                {sinPrecio && <p className="text-[11px] text-zinc-500">Este producto no tiene precio cargado — consultanos por soporte.</p>}
                            </>
                        ) : (
                            <>
                                <div className="p-4 rounded-xl border border-zinc-700/60 bg-zinc-900/60 space-y-1">
                                    <p className="text-sm font-black text-zinc-200 flex items-center gap-2">
                                        {producto.tipo === 'CONFECCIONADO' ? <Scissors size={15} className="text-purple-400" /> : <Sparkles size={15} className="text-brand-cyan" />}
                                        Precio a cotizar
                                    </p>
                                    <p className="text-xs text-zinc-500 leading-relaxed">
                                        {producto.tipo === 'CONFECCIONADO'
                                            ? 'Se fabrica a medida: el precio depende de talles, cantidades y terminaciones. Iniciá el pedido y te lo cotizamos.'
                                            : 'El precio depende de la personalización (bordado, estampado, DTF…). Iniciá el pedido y te lo cotizamos.'}
                                    </p>
                                </div>
                                <button
                                    onClick={onIniciarPedido}
                                    className="w-full py-3 rounded-xl bg-brand-cyan text-zinc-900 text-sm font-black uppercase tracking-wide hover:bg-brand-cyan/90 transition-colors"
                                >
                                    <span className="inline-flex items-center gap-2">Iniciar pedido <ArrowRight size={16} /></span>
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TiendaView;
