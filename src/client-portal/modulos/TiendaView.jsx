import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
    ShoppingCart, Search, Package, Plus, Minus, Trash2, X,
    Store, ArrowRight, ImageOff, Sparkles, Scissors,
    CheckCircle2, Loader2, MapPin, Truck
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
 * Checkout (F2): forma de envío Retiro/Encomienda + POST /web-orders/tienda/checkout.
 * El server recalcula precios (acá solo viaja qué y cuánto) y devuelve el código VEN-;
 * sin pago online: se paga al retirar (o al coordinar la encomienda).
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

// [PRECIO — estilo C 18/08] Tipográfico: símbolo chico gris + número grande blanco.
// Se usa en la ficha (fila mobile junto al nombre y precio grande de desktop).
const PrecioFicha = ({ precio, moneda, grande }) => (
    precio == null
        ? <span className={`${grande ? 'text-3xl' : 'text-2xl'} font-black text-zinc-100`}>Consultar</span>
        : <span className="inline-flex items-baseline gap-1 whitespace-nowrap font-gsanscode">
            <span className={`${grande ? 'text-sm' : 'text-[13px]'} font-bold text-zinc-500`}>{moneda === 'USD' ? 'US$' : '$'}</span>
            <span className={`${grande ? 'text-3xl' : 'text-2xl'} font-black text-zinc-100`}>{(Number(precio) || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })}</span>
        </span>
);

// Los 3 tipos comparten ficha; el chip identifica al producto cuando la solapa es "Todo".
// Va SOBRE la foto (esquina) y no en el bloque de texto: en mobile la grilla es de 2 columnas
// y el chip en línea ocupaba un renglón entero. Estilo 2 "carbón mono" (18/08): pill carbón
// con el color del tipo en un puntito; el precio va igual en carbón con el número celeste.
const CHIP_TIPO = {
    TERMINADO: { texto: 'En stock', dot: 'bg-emerald-400' },
    PERSONALIZADO: { texto: 'Personalizado', dot: 'bg-custom-cyan' },
    CONFECCIONADO: { texto: 'A medida', dot: 'bg-purple-400' },
};

// [SELECTOR TALLE/COLOR — opción B 18/08] Las variantes del WMS vienen como una lista plana
// "<producto> <TALLE> <COLOR...>" ("Short 2XL AZUL FRANCIA"). Para no mostrar 30+ chips, la
// ficha las parte en dos ejes: el talle es el primer token del conjunto conocido (o numérico,
// talles de niño tipo 14/16) y el color es todo lo que sigue. Si ALGUNA variante del producto
// no parsea, se cae a la lista plana de siempre — nunca se esconde una variante.
const TALLES_CONOCIDOS = new Set(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL', '5XL', '6XL']);
const ORDEN_TALLES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL', '6XL'];
const parseVariante = (nombre) => {
    const tokens = String(nombre || '').trim().toUpperCase().split(/\s+/);
    const i = tokens.findIndex(t => TALLES_CONOCIDOS.has(t) || /^\d{1,3}$/.test(t));
    if (i < 0) return null;
    return { talle: tokens[i], color: tokens.slice(i + 1).join(' ') };
};
// [STOCK] Placeholder fijo mientras no exista el sistema de stock de la tienda: se muestra
// como "disponibles" en la ficha y hace de tope del contador de cantidad. Sin conexión real.
const DISPONIBLES_PLACEHOLDER = 12;

// Numéricos primero (14 < 16), después letras en orden lógico S→3XL, desconocidos al final.
const cmpTalles = (a, b) => {
    const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
    if (na && nb) return parseInt(a, 10) - parseInt(b, 10);
    if (na !== nb) return na ? -1 : 1;
    const ia = ORDEN_TALLES.indexOf(a), ib = ORDEN_TALLES.indexOf(b);
    if (ia >= 0 && ib >= 0) return ia - ib;
    if ((ia >= 0) !== (ib >= 0)) return ia >= 0 ? -1 : 1;
    return a.localeCompare(b);
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

    // ── Checkout (F2) ────────────────────────────────────────────────────────
    // Forma de envío: mismo nomenclador FormasEnvio del resto del portal, y como en
    // ECOUV solo se ofrecen Retiro en el Local y Encomienda. Default: Retiro.
    const [formasEnvio, setFormasEnvio] = useState([]);
    const [formaEnvioId, setFormaEnvioId] = useState(null);
    const [comprando, setComprando] = useState(false);
    const [compraOk, setCompraOk] = useState(null);       // respuesta del checkout (código VEN...)
    useEffect(() => {
        apiClient.get('/nomenclators/shipping-methods')
            .then(res => {
                const lista = res.success ? (res.data || []) : [];
                const permitidas = lista.filter(f => /retiro|encomienda/i.test(f.Nombre || ''));
                setFormasEnvio(permitidas);
                setFormaEnvioId(prev => prev ?? (
                    permitidas.find(f => /retiro/i.test(f.Nombre || ''))?.ID ?? permitidas[0]?.ID ?? null
                ));
            })
            .catch(() => setFormasEnvio([]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const confirmarCompra = async () => {
        if (comprando || carrito.length === 0) return;
        setComprando(true);
        try {
            // El server recalcula precios y moneda desde PreciosBase (acá solo va qué y cuánto).
            const res = await apiClient.post('/web-orders/tienda/checkout', {
                items: carrito.map(it => ({
                    proIdProducto: it.proIdProducto,
                    wmsVarianteId: it.wmsVarianteId,
                    cantidad: it.cantidad,
                })),
                formaEnvioId: formaEnvioId || null,
            });
            setCompraOk(res);
            setCarrito([]);   // el carrito ya es pedido: se vacía también en localStorage
        } catch (e) {
            addToast(e.message || 'No pudimos confirmar la compra. Probá de nuevo.', 'error');
        } finally {
            setComprando(false);
        }
    };

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
    // Con monedas mezcladas el pedido se registra TODO en dólares (misma regla que el
    // carrito interno del WMS y que aplica el checkout en el server): se muestra el
    // equivalente para que el total confirmado no sorprenda.
    const totalAproxUSD = (totales.USD || 0) + (cotizacionDolar ? (totales.UYU || 0) / cotizacionDolar : 0);
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
                // Si hay foto del color de la variante ("Short 14 ROJO" ⊃ "ROJO"), esa; si no, la portada.
                foto: (producto.fotosColor || []).find(fc =>
                    fc.color && String(variante.nombre || '').toUpperCase().includes(fc.color)
                )?.url || producto.fotos?.[0] || null,
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
                {/* GRILLA, no fila deslizable: en un teléfono angosto las cuatro solapas no entran
                    a lo ancho y "Confeccionados" quedaba cortada contra el borde — deslizar no
                    alcanza porque nada indica que haya más. Con 2 columnas en mobile las cuatro
                    se ven completas, y desde `sm` vuelven a una sola fila. */}
                <div className="grid grid-cols-2 sm:flex gap-1.5 md:gap-2">
                    {SOLAPAS.map(s => (
                        <button
                            key={s.id}
                            onClick={() => setSolapa(s.id)}
                            className={`px-3 md:px-4 py-2 rounded-xl text-[10px] md:text-xs font-black uppercase tracking-wide text-center border transition-colors ${solapa === s.id
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
                            // Card "C" (18/08, elegida tras probar también la D): superficie oscura un
                            // paso más clara que el fondo (#202024 — zinc-900 se fundía con la página),
                            // la foto en panel blanco adentro (mismo lenguaje que la ficha) y el precio
                            // en pill cyan translúcida, familia del botón AGREGAR.
                            <button
                                key={p.proIdProducto}
                                onClick={() => setFicha(p)}
                                className="text-left rounded-2xl bg-[#202024] border border-zinc-700/60 p-2 hover:-translate-y-0.5 transition-transform group"
                            >
                                <div className="relative aspect-square bg-white rounded-xl flex items-center justify-center overflow-hidden">
                                    {/* Estilo 7 "sin pills" (18/08): punto de color + texto para el tipo,
                                        y el precio tipográfico directo sobre el blanco de la foto. */}
                                    <span className="absolute top-2 left-2.5 z-10 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-zinc-600">
                                        <span className={`w-1.5 h-1.5 rounded-full ${chip.dot}`}></span>{chip.texto}
                                    </span>
                                    {p.fotos?.length ? (
                                        <img src={p.fotos[0]} alt={p.titulo} className="w-full h-full object-contain p-1.5 group-hover:scale-105 transition-transform duration-500" />
                                    ) : (
                                        <ImageOff size={36} className="text-zinc-300" />
                                    )}
                                    {p.tipo === 'TERMINADO' ? (
                                        p.precio != null ? (
                                            <span className="absolute bottom-2 right-2.5 z-10 whitespace-nowrap inline-flex items-baseline gap-1 font-gsanscode font-bold">
                                                <span className="text-[11px] text-zinc-500">{p.moneda === 'USD' ? 'US$' : '$'}</span>
                                                <span className="text-[16px] tracking-tight text-zinc-900 tabular-nums">{(Number(p.precio) || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 })}</span>
                                            </span>
                                        ) : (
                                            <span className="absolute bottom-2 right-2.5 z-10 text-[10px] font-bold uppercase tracking-wide text-zinc-500">Consultar</span>
                                        )
                                    ) : (
                                        <span className="absolute bottom-2 right-2.5 z-10 text-[10px] font-bold uppercase tracking-wide text-zinc-500">A cotizar</span>
                                    )}
                                </div>
                                <div className="px-1.5 pt-2.5 pb-1">
                                    <p className="text-[13px] font-semibold text-zinc-300 leading-snug line-clamp-2 uppercase">{p.titulo}</p>
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
                <div className="fixed inset-0 z-[10000]">
                    <div className="absolute inset-0 bg-black/70" onClick={() => { setCarritoAbierto(false); setCompraOk(null); }} />
                    <aside className="absolute right-0 top-0 h-full w-full max-w-md bg-custom-dark border-l border-zinc-800 flex flex-col">
                        <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
                            <h2 className="font-black text-zinc-100 flex items-center gap-2"><ShoppingCart size={18} /> Tu carrito</h2>
                            <button onClick={() => { setCarritoAbierto(false); setCompraOk(null); }} className="w-8 h-8 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-200 flex items-center justify-center"><X size={16} /></button>
                        </div>

                        {compraOk ? (
                            /* Compra confirmada: el pedido ya existe (código VEN), el carrito quedó vacío. */
                            <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center space-y-4">
                                <CheckCircle2 size={52} className="text-emerald-400" />
                                <div>
                                    <p className="text-lg font-black text-zinc-100">¡Compra confirmada!</p>
                                    <p className="text-sm text-zinc-500 mt-1">Tu pedido quedó registrado como</p>
                                    <p className="text-2xl font-black text-brand-cyan tracking-wide mt-1">{compraOk.codigoVenta}</p>
                                </div>
                                {compraOk.total != null && (
                                    <p className="text-sm text-zinc-300 font-bold">Total a pagar: {fmt(compraOk.total, compraOk.moneda)}</p>
                                )}
                                <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/60 text-left space-y-1.5 w-full">
                                    {compraOk.modoRetiro && (
                                        <p className="text-xs text-zinc-400 flex items-center gap-2">
                                            {/encomienda/i.test(compraOk.modoRetiro) ? <Truck size={14} className="shrink-0 text-zinc-500" /> : <MapPin size={14} className="shrink-0 text-zinc-500" />}
                                            Envío: <span className="font-bold text-zinc-300">{compraOk.modoRetiro}</span>
                                        </p>
                                    )}
                                    <p className="text-xs text-zinc-500 leading-relaxed">
                                        {/encomienda/i.test(compraOk.modoRetiro || '')
                                            ? 'Preparamos tu pedido y te contactamos para coordinar la encomienda y el pago. No se te cobró nada todavía.'
                                            : 'Preparamos tu pedido y pagás al retirarlo en el local, mostrando este código. No se te cobró nada todavía.'}
                                    </p>
                                </div>
                                <button
                                    onClick={() => setCompraOk(null)}
                                    className="w-full py-3 rounded-xl bg-brand-cyan text-zinc-900 text-sm font-black uppercase tracking-wide hover:bg-brand-cyan/90 transition-colors"
                                >
                                    Seguir comprando
                                </button>
                            </div>
                        ) : (<>
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
                                            <span>Se registra todo en dólares (cotiz. {cotizacionDolar})</span>
                                            <span className="font-bold">≈ {fmt(totalAproxUSD, 'USD')}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Forma de envío (Retiro en el Local / Encomienda, patrón ECOUV) */}
                                {formasEnvio.length > 0 && (
                                    <div className="grid grid-cols-2 gap-2">
                                        {formasEnvio.map(f => {
                                            const esEnc = /encomienda/i.test(f.Nombre || '');
                                            const activa = formaEnvioId === f.ID;
                                            return (
                                                <button
                                                    key={f.ID}
                                                    onClick={() => setFormaEnvioId(f.ID)}
                                                    className={`px-3 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-wide border transition-colors flex items-center justify-center gap-1.5 ${activa
                                                        ? 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan'
                                                        : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                                                >
                                                    {esEnc ? <Truck size={14} /> : <MapPin size={14} />}
                                                    {f.Nombre}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}

                                <button
                                    onClick={confirmarCompra}
                                    disabled={comprando}
                                    className={`w-full py-3 rounded-xl text-sm font-black uppercase tracking-wide transition-colors ${comprando
                                        ? 'bg-zinc-800 text-zinc-500 cursor-wait'
                                        : 'bg-brand-cyan text-zinc-900 hover:bg-brand-cyan/90'}`}
                                >
                                    {comprando
                                        ? <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" /> Confirmando...</span>
                                        : 'Confirmar compra'}
                                </button>
                                <p className="text-[11px] text-center text-zinc-600">
                                    {/encomienda/i.test(formasEnvio.find(f => f.ID === formaEnvioId)?.Nombre || '')
                                        ? 'Sin pago online: te contactamos para coordinar la encomienda y el pago.'
                                        : 'Sin pago online: pagás al retirar en el local.'}
                                </p>
                            </div>
                        )}
                        </>)}
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
    // Combos: el stock que se muestra es el ARMABLE (min de componentes, viene en
    // stockTotal); además el catálogo ya los oculta si algún componente está en 0.
    const variantes = producto.variantes?.length ? producto.variantes : [{
        wmsVarianteId: producto.proIdProducto, sku: '', nombre: 'Única',
        precio: producto.precio, moneda: producto.moneda,
        stock: producto.esCombo ? producto.stockTotal : null,
    }];
    const [varSel, setVarSel] = useState(variantes[0]);
    const [cantidad, setCantidad] = useState(1);
    const [fotoIdx, setFotoIdx] = useState(0);
    const esTerminado = producto.tipo === 'TERMINADO';
    const sinPrecio = varSel?.precio == null;

    // [IMÁGENES POR COLOR] La galería junta las fotos comunes + las de color. Al elegir una
    // variante cuyo nombre contiene el color de una foto ("Short 14 ROJO" ⊃ "ROJO") se salta
    // solo a esa foto; el cliente puede seguir navegando las miniaturas igual.
    const fotosColor = producto.fotosColor || [];
    const fotosTodas = [...(producto.fotos || []), ...fotosColor.map(fc => fc.url)];
    useEffect(() => {
        if (!fotosColor.length || !varSel?.nombre) return;
        const nom = String(varSel.nombre).toUpperCase();
        const idx = fotosColor.findIndex(fc => fc.color && nom.includes(fc.color));
        if (idx >= 0) setFotoIdx((producto.fotos?.length || 0) + idx);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [varSel]);

    // Ejes talle/color (ver parseVariante). Solo si TODAS las variantes parsean; si el
    // producto no distingue color (color vacío en todas), queda solo el eje de talles.
    const ejes = useMemo(() => {
        if (variantes.length <= 1) return null;
        const parsed = variantes.map(v => ({ v, p: parseVariante(v.nombre) }));
        if (parsed.some(x => !x.p)) return null;
        const colores = [...new Set(parsed.map(x => x.p.color).filter(Boolean))];
        const talles = [...new Set(parsed.map(x => x.p.talle))].sort(cmpTalles);
        return { parsed, colores, talles };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [producto]);
    const p0 = parseVariante(variantes[0]?.nombre);
    const [talleSel, setTalleSel] = useState(p0?.talle || null);
    const [colorSel, setColorSel] = useState(p0?.color || null);
    const elegirColor = (c) => {
        const m = ejes.parsed.find(x => x.p.color === c && x.p.talle === talleSel)
            || ejes.parsed.find(x => x.p.color === c);
        if (!m) return;
        setColorSel(c); setTalleSel(m.p.talle); setVarSel(m.v);
    };
    const elegirTalle = (t) => {
        const m = ejes.parsed.find(x => x.p.talle === t && (!ejes.colores.length || x.p.color === colorSel))
            || ejes.parsed.find(x => x.p.talle === t);
        if (!m) return;
        setTalleSel(t); setColorSel(m.p.color || null); setVarSel(m.v);
    };

    // [FADE] Al cambiar la foto (otro color o miniatura), la nueva entra con fade sobre la
    // anterior, que queda 250ms debajo como base del crossfade y después se retira.
    const [imgActual, setImgActual] = useState(fotosTodas[0] || null);
    const [imgPrev, setImgPrev] = useState(null);
    useEffect(() => {
        const src = fotosTodas[fotoIdx] || fotosTodas[0] || null;
        if (!src || src === imgActual) return;
        setImgPrev(imgActual);
        setImgActual(src);
        const t = setTimeout(() => setImgPrev(null), 250);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fotoIdx]);

    // Portal al body: dentro del árbol del layout el fixed se anclaba a un ancestro (con
    // transform, fixed deja de referir al viewport) y el modal quedaba con un hueco arriba
    // en mobile. Colgado del body, inset-0 es el viewport de verdad.
    return createPortal(
        // Mobile: la ficha ocupa TODO el viewport (sin borde ni redondeo); de md: para
        // arriba vuelve a ser la card centrada de siempre. z-[10000] porque la navbar del
        // portal (LandingNavbar) es fixed con zIndex 9999 y tapaba el modal.
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-0 md:p-4">
            <div className="absolute inset-0 bg-black/70" onClick={onCerrar} />
            {/* Tipografía de la ficha (18/08): texto en DM Sans, números en Google Sans Code */}
            <div className="relative bg-custom-dark w-full h-full overflow-y-auto font-dmsans md:h-auto md:max-h-[90vh] md:max-w-3xl md:rounded-2xl md:border md:border-zinc-700/60">
                {/* Cerrar (desktop): arriba a la derecha del modal, mismo ghost adaptado al fondo oscuro. */}
                <button onClick={onCerrar} className="hidden md:flex absolute top-3 right-3 z-10 w-8 h-8 rounded-lg border border-zinc-500/60 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20 items-center justify-center transition-colors"><X size={16} /></button>

                <div className="grid md:grid-cols-2 gap-0">
                    {/* Fotos — centradas verticalmente en su columna (desktop: la columna de
                        datos suele ser más alta y la foto quedaba arriba) */}
                    <div className="p-4 space-y-2 flex flex-col justify-center">
                        <div className="relative aspect-square rounded-xl bg-white flex items-center justify-center overflow-hidden">
                            {/* Cerrar (solo mobile, donde la foto es el tope del modal): estilo ghost
                                carbón dentro del panel blanco. En desktop va arriba a la derecha DEL
                                MODAL (ver más abajo), que es donde se espera el cerrar. */}
                            <button onClick={onCerrar} className="md:hidden absolute top-2 right-2 z-10 w-8 h-8 rounded-lg border border-brand-dark/60 bg-brand-dark/10 text-brand-dark hover:bg-brand-dark/20 flex items-center justify-center transition-colors"><X size={16} /></button>
                            {fotosTodas.length ? (
                                <>
                                    {imgPrev && <img src={imgPrev} alt="" className="absolute inset-0 w-full h-full object-contain" />}
                                    <img key={imgActual} src={imgActual} alt={producto.titulo} className="relative w-full h-full object-contain" style={{ animation: 'tienda-fade-img 0.25s ease' }} />
                                </>
                            ) : (
                                <ImageOff size={48} className="text-zinc-300" />
                            )}
                            <style>{`@keyframes tienda-fade-img { from { opacity: 0 } to { opacity: 1 } }`}</style>
                        </div>
                        {/* Miniaturas: solo la galería común — las fotos de color ya se eligen
                            con el selector de COLOR y acá abajo quedaban duplicadas. */}
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
                        <div className="flex items-start justify-between gap-3">
                            <h2 className="text-lg font-black text-zinc-100 leading-tight">{producto.titulo}</h2>
                            {/* Mobile: el precio va a la derecha del nombre; en md+ abajo, como siempre */}
                            {esTerminado && (
                                <span className="md:hidden mr-2"><PrecioFicha precio={varSel.precio} moneda={varSel.moneda} grande /></span>
                            )}
                        </div>
                        {producto.descripcion && <p className="text-sm text-zinc-400 whitespace-pre-line">{producto.descripcion}</p>}

                        {esTerminado ? (
                            <>
                                <p className="hidden md:block text-center"><PrecioFicha precio={varSel.precio} moneda={varSel.moneda} /></p>

                                {variantes.length > 1 && (ejes ? (
                                    <div className="space-y-3">
                                        {ejes.colores.length > 0 && (
                                            <div>
                                                <p className="text-xs font-bold uppercase text-zinc-500 mb-2">Color — <span className="text-zinc-300">{colorSel}</span></p>
                                                <div className="flex gap-2 flex-wrap">
                                                    {ejes.colores.map(c => {
                                                        const foto = fotosColor.find(fc => fc.color && c.includes(fc.color))?.url || null;
                                                        const on = colorSel === c;
                                                        return foto ? (
                                                            <button key={c} onClick={() => elegirColor(c)} title={c}
                                                                className={`w-11 h-11 rounded-xl bg-white overflow-hidden border-2 transition-colors ${on ? 'border-brand-cyan' : 'border-zinc-700 hover:border-zinc-500'}`}>
                                                                <img src={foto} alt={c} className="w-full h-full object-contain" />
                                                            </button>
                                                        ) : (
                                                            <button key={c} onClick={() => elegirColor(c)}
                                                                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${on
                                                                    ? 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan'
                                                                    : 'border-zinc-700 text-zinc-400 hover:text-zinc-200'}`}>
                                                                {c}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        <div>
                                            <p className="text-xs font-bold uppercase text-zinc-500 mb-2">Talle</p>
                                            <div className="flex gap-2 flex-wrap">
                                                {ejes.talles.map(t => {
                                                    const on = talleSel === t;
                                                    // Sin esa combinación con el color elegido: atenuado, pero clickeable
                                                    // (al clickear se ajusta el color al primero que exista en ese talle).
                                                    const hay = !ejes.colores.length || ejes.parsed.some(x => x.p.talle === t && x.p.color === colorSel);
                                                    return (
                                                        <button key={t} onClick={() => elegirTalle(t)}
                                                            className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors ${on
                                                                ? 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan'
                                                                : hay
                                                                    ? 'border-zinc-700 text-zinc-400 hover:text-zinc-200'
                                                                    : 'border-zinc-800 text-zinc-600 hover:text-zinc-400'}`}>
                                                            {t}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                ) : (
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
                                ))}

                                {/* Cantidad + agregar (opción C, 18/08): fila de cantidad con botones
                                    redondos discretos y botón ancho completo con el total vivo. */}
                                <div className="space-y-2.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Cantidad</span>
                                        <div className="flex items-center gap-1.5">
                                            <button onClick={() => setCantidad(c => Math.max(1, c - 1))} disabled={cantidad <= 1}
                                                className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${cantidad <= 1
                                                    ? 'border-zinc-800 text-zinc-600 cursor-not-allowed'
                                                    : 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20'}`}><Minus size={13} /></button>
                                            <span className="w-9 text-center font-black text-zinc-100 font-gsanscode">{cantidad}</span>
                                            <button onClick={() => setCantidad(c => Math.min(DISPONIBLES_PLACEHOLDER, c + 1))} disabled={cantidad >= DISPONIBLES_PLACEHOLDER}
                                                className={`w-8 h-8 rounded-full border flex items-center justify-center transition-colors ${cantidad >= DISPONIBLES_PLACEHOLDER
                                                    ? 'border-zinc-800 text-zinc-600 cursor-not-allowed'
                                                    : 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20'}`}><Plus size={13} /></button>
                                        </div>
                                    </div>
                                    {/* [STOCK] Placeholder visual con número FIJO, sin conectar a nada:
                                        el sistema de stock de la tienda no existe todavía. Cuando esté,
                                        acá va el disponible real de la variante elegida (y el tope del +). */}
                                    <p className="text-[11px] font-bold text-zinc-500 text-right -mt-1"><span className="font-gsanscode">{DISPONIBLES_PLACEHOLDER}</span> disponibles</p>
                                    <button
                                        onClick={() => onAgregar(producto, varSel, cantidad)}
                                        disabled={sinPrecio}
                                        className={`w-full py-3.5 rounded-xl text-sm font-black uppercase tracking-wide border transition-colors ${sinPrecio
                                            ? 'bg-zinc-800 border-transparent text-zinc-600 cursor-not-allowed'
                                            : 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20'}`}
                                    >
                                        {/* Dos zonas fijas 55/45, cada una con su contenido centrado —
                                            al variar la cantidad nada se corre. */}
                                        <span className="flex items-center w-full">
                                            <span className={`${sinPrecio ? 'w-full' : 'w-[55%]'} inline-flex items-center justify-center gap-2`}><ShoppingCart size={16} /> Agregar</span>
                                            {!sinPrecio && <span className="w-[45%] text-white text-center text-base font-gsanscode">{fmt(varSel.precio * cantidad, varSel.moneda)}</span>}
                                        </span>
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
    , document.body);
};

export default TiendaView;
