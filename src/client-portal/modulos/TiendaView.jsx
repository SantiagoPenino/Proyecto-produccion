import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
    ShoppingCart, Search, Package, Plus, Minus, Trash2, X,
    Store, ArrowRight, ImageOff, Sparkles, Scissors,
    CheckCircle2, Loader2, MapPin, Truck, CreditCard
} from 'lucide-react';
import { apiClient } from '../api/apiClient';
import { useToast } from '../pautas/Toast';
import handyLogo from '../../assets/images/pasarelas/handy.svg';
import mpLogo from '../../assets/images/pasarelas/mercadopago.svg';

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
    const i = tokens.findIndex((t, idx) => {
        if (!(TALLES_CONOCIDOS.has(t) || /^\d{1,3}$/.test(t))) return false;
        // "TOALLA 1,60 m": la M de METROS no es un talle (misma regla que el backend).
        if ((t === 'M' || t === 'L') && idx > 0 && /^\d+[.,]\d+$/.test(tokens[idx - 1])) return false;
        return true;
    });
    if (i < 0) return null;
    return { talle: tokens[i], color: tokens.slice(i + 1).join(' ') };
};
// [STOCK] Placeholder fijo mientras no exista el sistema de stock de la tienda: se muestra
// como "disponibles" en la ficha y hace de tope del contador de cantidad. Sin conexión real.
const DISPONIBLES_PLACEHOLDER = 12;

// [FOTOS POR COLOR — matching 21/08] Igualdad exacta primero (color de DATO contra el color
// de la foto) y recién después "el texto contiene el color", quedándose con el MÁS LARGO:
// con includes pelado, la foto de "AMARILLO" le pegaba a "AMARILLO FLUOR" y quedaban fotos
// cruzadas. Devuelve la entrada {color, url} o null.
const fotoDeColor = (fotosColor, texto) => {
    if (!texto || !fotosColor?.length) return null;
    const t = String(texto).toUpperCase();
    const exacta = fotosColor.find(fc => fc.color === t);
    if (exacta) return exacta;
    return fotosColor
        .filter(fc => fc.color && t.includes(fc.color))
        .sort((a, b) => b.color.length - a.color.length)[0] || null;
};

// [SWIPE-DOWN 18/08] Gesto compartido de los sheets mobile (ficha y carrito): el handle
// arrastra el panel con el dedo; al soltar, cierra si pasó el umbral (120px, o 40px con
// velocidad de flick) — la animación de salida arranca desde donde quedó el dedo (keyframe
// sin "from") — y si no, vuelve con un resorte corto. movedRef distingue arrastre de tap.
function useSwipeDown(panelRef, onClose) {
    const dragRef = React.useRef(null);
    const movedRef = React.useRef(false);
    const onTouchStart = (e) => {
        movedRef.current = false;
        dragRef.current = { y0: e.touches[0].clientY, y: e.touches[0].clientY, t: performance.now(), v: 0 };
        if (panelRef.current) panelRef.current.style.transition = 'none';
    };
    const onTouchMove = (e) => {
        const d = dragRef.current; if (!d) return;
        const y = e.touches[0].clientY;
        const now = performance.now();
        d.v = (y - d.y) / Math.max(1, now - d.t); d.y = y; d.t = now;
        const dy = Math.max(0, y - d.y0);
        if (dy > 8) movedRef.current = true;
        if (panelRef.current) panelRef.current.style.transform = `translateY(${dy}px)`;
    };
    const onTouchEnd = () => {
        const d = dragRef.current; dragRef.current = null;
        const p = panelRef.current; if (!p || !d) return;
        const dy = Math.max(0, d.y - d.y0);
        if (dy > 120 || (dy > 40 && d.v > 0.6)) {
            onClose();
        } else {
            p.style.transition = 'transform .18s ease';
            p.style.transform = '';
            setTimeout(() => { if (p) p.style.transition = ''; }, 200);
        }
    };
    return { onTouchStart, onTouchMove, onTouchEnd, movedRef };
}

// [ANIMACIÓN 18/08] Números del carrito: al cambiar el valor, el número CUENTA de a 1 desde
// el valor actual hasta el nuevo (990 → 991 → … → 1.089). Deltas chicos duran un toque y
// deltas grandes se estiran hasta 600ms (el ojo igual ve la cuenta pasar). El valor final
// se estampa exacto (importa en precios con decimales). `formato` da el formateo visual.
const NumeroAnimado = ({ n, formato, className }) => {
    const [mostrado, setMostrado] = useState(n);
    // Efecto "color direccional": brand-cyan (#006E97) mientras sube, brand-magenta
    // (#BD0C7E) mientras baja, y vuelve a su color al asentarse (transition suaviza).
    const [tinte, setTinte] = useState(null);
    const prevRef = React.useRef(n);
    useEffect(() => {
        const desde = prevRef.current;
        prevRef.current = n;
        if (desde === n) return;
        const delta = n - desde;
        setTinte(delta > 0 ? '#006E97' : '#BD0C7E');
        const dur = Math.min(250, 60 + Math.abs(delta) * 8);
        const t0 = performance.now();
        let raf;
        const tick = (t) => {
            const p = Math.min(1, (t - t0) / dur);
            setMostrado(p >= 1 ? n : Math.round(desde + delta * p));
            if (p < 1) raf = requestAnimationFrame(tick);
            else setTinte(null);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [n]);
    return <span className={className} style={{ color: tinte || undefined, transition: 'color .15s' }}>{formato ? formato(mostrado) : mostrado}</span>;
};

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
                // Si hay foto del color de la variante (dato Color o el nombre), esa; si no, la portada.
                foto: fotoDeColor(producto.fotosColor, variante.color || variante.nombre)?.url
                    || producto.fotos?.[0] || null,
                cantidad,
            }];
        });
        addToast('Agregado al carrito.', 'success');
        // El cierre del modal lo dispara la propia ficha (cerrar()) para que corra la
        // animación de salida — acá no se desmonta en seco.
    };
    // Mismo tope que el contador de la ficha (DISPONIBLES_PLACEHOLDER, stock aún sin conectar).
    const cambiarCantidad = (key, delta) => setCarrito(prev => prev
        .map(it => `${it.proIdProducto}:${it.wmsVarianteId}` === key
            ? { ...it, cantidad: Math.min(DISPONIBLES_PLACEHOLDER, Math.max(1, it.cantidad + delta)) } : it));
    const quitarItem = (key) => setCarrito(prev => prev.filter(it => `${it.proIdProducto}:${it.wmsVarianteId}` !== key));

    // [ANIMACIÓN CERRAR CARRITO 18/08] Al cerrar, primero corre la animación de salida
    // (slide a la derecha en desktop, pop inverso en mobile, fondo con fade) y recién
    // después se desmonta el portal.
    const [carritoCerrando, setCarritoCerrando] = useState(false);
    const cerrarCarrito = () => {
        if (carritoCerrando) return;
        setCarritoCerrando(true);
        setTimeout(() => {
            setCarritoAbierto(false);
            setCarritoCerrando(false);
            setCompraOk(null);
        }, 240);
    };

    // [HANDLE CARRITO 18/08] Mismo handle arrastrable que la ficha (mobile).
    const cartPanelRef = React.useRef(null);
    const cartSwipe = useSwipeDown(cartPanelRef, cerrarCarrito);

    // [MÉTODO DE PAGO 18/08] "Confirmar compra" ya no confirma directo: abre un sheet desde
    // abajo para elegir Handy o MercadoPago (mismo diseño que portal/pickup). PLACEHOLDER:
    // el cobro online de la tienda todavía no existe en el backend (Handy/MP viven solo en
    // el flujo de retiros), así que al elegir un método hoy se registra el pedido como
    // siempre; cuando esté el backend de cobro, acá se genera el link según `metodo`.
    const [payModalAbierto, setPayModalAbierto] = useState(false);
    const [payCerrando, setPayCerrando] = useState(false);
    const cerrarPay = () => {
        if (payCerrando) return;
        setPayCerrando(true);
        setTimeout(() => { setPayModalAbierto(false); setPayCerrando(false); }, 240);
    };
    const payPanelRef = React.useRef(null);
    const paySwipe = useSwipeDown(payPanelRef, cerrarPay);
    // [PAGO ONLINE 21/08] Retiro en el local = paga-primero: se pide el link de pago
    // (la venta NO se crea acá — la crea el webhook al confirmarse el pago) y se
    // redirige a la pasarela. Al volver, /portal/payment-status muestra el resultado.
    const [pagando, setPagando] = useState(false);
    const elegirMetodoPago = async (metodo) => {
        if (pagando || carrito.length === 0) return;
        if (metodo !== 'handy') {
            addToast('MercadoPago está en camino — por ahora pagá con Handy.', 'error');
            return;
        }
        setPagando(true);
        try {
            const res = await apiClient.post('/web-orders/tienda/init-pago', {
                items: carrito.map(it => ({
                    proIdProducto: it.proIdProducto,
                    wmsVarianteId: it.wmsVarianteId,
                    cantidad: it.cantidad,
                })),
                formaEnvioId: formaEnvioId || null,
                metodo,
            });
            if (res?.url) {
                // El carrito NO se vacía acá: si el cliente cancela el pago, lo conserva.
                // Lo limpia /portal/payment-status cuando confirma que el pago quedó Pagado.
                window.location.href = res.url;
                return;
            }
            addToast('No pudimos generar el link de pago. Probá de nuevo.', 'error');
        } catch (e) {
            addToast(e.message || 'No pudimos generar el link de pago. Probá de nuevo.', 'error');
        } finally {
            setPagando(false);
        }
    };

    // [ANIMACIÓN ELIMINAR 18/08] Flash rojo → fade en el lugar → colapso del hueco
    // (keyframes tienda-item-out). El item recién sale del estado cuando termina.
    const [saliendo, setSaliendo] = useState({});
    const quitarItemAnimado = (key) => {
        if (saliendo[key]) return;
        setSaliendo(prev => ({ ...prev, [key]: true }));
        setTimeout(() => {
            quitarItem(key);
            setSaliendo(prev => { const n = { ...prev }; delete n[key]; return n; });
        }, 580);
    };

    // Personalizados/confeccionados: inician un pedido normal (precio por cotización).
    // F3: precargar el producto elegido en el form vía location.state.
    const iniciarPedido = () => { setFicha(null); navigate('/portal'); };

    // [BIFURCACIÓN 18/08] El camino del checkout depende de la forma de envío elegida:
    // RETIRO → pago online obligatorio (abre el sheet Handy/MP); ENCOMIENDA → se
    // confirma el pedido SIN pago (VEN impago, retenido en preparación) y el cliente
    // paga después desde Retiro de Pedidos, creando ahí su orden de retiro.
    const envioEsEncomienda = /encomienda/i.test(formasEnvio.find(f => f.ID === formaEnvioId)?.Nombre || '');

    return (
        <div className="space-y-6">
            {/* Header */}
            {/* Sin flex-wrap: en mobile el botón del carrito se hace ícono solo (el texto
                aparece de sm: en adelante) y queda al costado del título en la misma fila,
                en vez de bajar a un renglón propio que empujaba todo. */}
            <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                    <h1 className="text-2xl md:text-3xl font-black tracking-tight text-zinc-100 flex items-center gap-3">
                        <Store className="text-brand-cyan" size={28} /> Tienda
                    </h1>
                    <p className="text-sm text-zinc-500 mt-1">Productos listos, personalizados y confeccionados a medida.</p>
                </div>
                <button
                    onClick={() => setCarritoAbierto(true)}
                    className="relative shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2.5 rounded-xl border border-zinc-700 bg-custom-dark text-zinc-200 hover:border-brand-cyan/50 transition-colors text-sm font-bold"
                >
                    <ShoppingCart size={18} /> <span className="hidden sm:inline">Carrito</span>
                    {itemsCarrito > 0 && (
                        <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1 rounded-full bg-brand-cyan text-zinc-900 text-[11px] font-black flex items-center justify-center">
                            {itemsCarrito}
                        </span>
                    )}
                </button>
            </div>

            {/* Solapas + búsqueda */}
            <div className="flex flex-col md:flex-row md:items-center gap-3">
                {/* [21/08] Pills de filtro OCULTAS por ahora (pedido: esconderlas hasta que haya
                    más variedad de tipos publicados). La lógica de solapas queda intacta —
                    para reactivarlas, cambiar el `false &&` de abajo. La grilla era 2 columnas
                    en mobile porque las cuatro no entraban a lo ancho. */}
                {false && (
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
                )}
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
                                    {/* leading-none: sin él la caja de línea del texto es más alta que las
                                        mayúsculas y el punto quedaba corrido del centro visual. */}
                                    <span className="absolute top-2 left-2.5 z-10 inline-flex items-center gap-1.5 leading-none text-[10px] font-bold uppercase tracking-wide text-zinc-600">
                                        <span className={`w-2 h-2 rounded-full shrink-0 relative top-px animate-pulse ${chip.dot}`}></span>
                                        <span>{chip.texto}</span>
                                    </span>
                                    {p.fotos?.length ? (
                                        <img src={p.fotos[0]} alt={p.titulo} className="w-full h-full object-contain p-1.5 group-hover:scale-105 transition-transform duration-500" />
                                    ) : (
                                        <ImageOff size={36} className="text-zinc-300" />
                                    )}
                                    {p.tipo === 'TERMINADO' ? (
                                        p.precio != null ? (
                                            <span className="absolute bottom-1 right-2.5 z-10 whitespace-nowrap inline-flex items-baseline gap-1 font-gsanscode font-bold">
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
                                <div className="px-1.5 pt-1.5 pb-0.5">
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

            {/* Carrito — mismo formato que el modal del producto (18/08): portal al body,
                pantalla completa en mobile y card centrada con borde/redondeo en md+. */}
            {carritoAbierto && createPortal(
                // Mobile: pantalla completa con el pop de la ficha. Desktop (md+): drawer
                // lateral que entra deslizándose desde la derecha, alto completo.
                <div className="fixed inset-0 z-[10000] flex justify-end">
                    {/* Mobile: sheet (sube/baja); desktop: drawer que desliza desde la derecha.
                        tienda-item-out = eliminar item: flash rojo (15%) → fade (21→65%) → colapso. */}
                    <style>{`@keyframes tienda-sheet-in { from { transform: translateY(100%) } to { transform: none } } @keyframes tienda-sheet-out { to { transform: translateY(100%) } } @keyframes tienda-backdrop-in { from { opacity: 0 } to { opacity: 1 } } @keyframes tienda-backdrop-out { to { opacity: 0 } } @keyframes tienda-cart-slide { from { transform: translateX(100%) } to { transform: none } } @keyframes tienda-cart-slide-out { to { transform: translateX(100%) } } .tienda-cart-panel { animation: tienda-sheet-in 0.28s cubic-bezier(.2,.8,.3,1) } .tienda-cart-panel-out { animation: tienda-sheet-out 0.24s ease-in forwards } @media (min-width: 768px) { .tienda-cart-panel { animation: tienda-cart-slide 0.28s ease-out } .tienda-cart-panel-out { animation: tienda-cart-slide-out 0.24s ease forwards } } @keyframes tienda-item-out { 0% { opacity: 1; max-height: 8rem; background: transparent } 15% { background: rgba(226,75,74,.14) } 21% { opacity: 1 } 65% { opacity: 0; max-height: 8rem; background: rgba(226,75,74,.14) } 100% { opacity: 0; max-height: 0; background: rgba(226,75,74,.14) } }`}</style>
                    <div className="absolute inset-0 bg-black/70" onClick={cerrarCarrito} style={{ animation: carritoCerrando ? 'tienda-backdrop-out 0.22s ease forwards' : 'tienda-backdrop-in 0.2s ease' }} />
                    <aside ref={cartPanelRef} className={`${carritoCerrando ? 'tienda-cart-panel-out' : 'tienda-cart-panel'} relative bg-custom-dark w-full h-full flex flex-col overflow-hidden font-dmsans md:max-w-md md:border-l md:border-zinc-700/60`}>
                        {/* Cabezal compacto y FIJO (fila del flex, no scrollea — igual que el pie):
                            handle pegado al título en mobile; la X queda solo en desktop (el
                            drawer no tiene handle) — en mobile se cierra con handle o tocando afuera. */}
                        <div className="shrink-0 border-b border-zinc-800">
                            <div className="md:hidden flex justify-center">
                                <div
                                    className="pt-2.5 pb-0.5 px-10"
                                    style={{ touchAction: 'none' }}
                                    onClick={() => { if (!cartSwipe.movedRef.current) cerrarCarrito(); }}
                                    onTouchStart={cartSwipe.onTouchStart} onTouchMove={cartSwipe.onTouchMove} onTouchEnd={cartSwipe.onTouchEnd}
                                >
                                    <span className="block w-11 h-1.5 rounded-full bg-zinc-500"></span>
                                </div>
                            </div>
                            <div className="px-5 pt-1 pb-3.5 md:p-5 flex items-center justify-between">
                                <h2 className="font-dmsans font-black capitalize text-lg text-zinc-100 flex items-center gap-2"><ShoppingCart size={22} className="text-brand-cyan" /> Tu carrito</h2>
                                <button onClick={cerrarCarrito} className="hidden md:flex w-8 h-8 rounded-lg border border-zinc-800 text-zinc-500 hover:text-zinc-200 items-center justify-center"><X size={16} /></button>
                            </div>
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
                                            ? 'Tu pedido quedó registrado. Cuando quieras, pagalo desde Retiro de Pedidos y ahí coordinamos la encomienda — recién con el pago lo preparamos.'
                                            : 'Preparamos tu pedido y pagás al retirarlo en el local, mostrando este código. No se te cobró nada todavía.'}
                                    </p>
                                </div>
                                <button
                                    onClick={() => {
                                        cerrarCarrito();
                                        if (window.location.pathname !== '/portal/tienda') navigate('/portal/tienda');
                                    }}
                                    className="w-full py-3 rounded-xl bg-brand-cyan text-zinc-900 text-sm font-black uppercase tracking-wide hover:bg-brand-cyan/90 transition-colors"
                                >
                                    Seguir comprando
                                </button>
                            </div>
                        ) : (<>
                        {/* pt-3 = 12px: la misma distancia que hay entre el separador y el item
                            siguiente (space-y-3), así el 1er item respira igual contra el header. */}
                        <div className="flex-1 overflow-y-auto p-5 pt-3 space-y-3">
                            {carrito.length === 0 ? (
                                <div className="py-16 text-center text-zinc-600">
                                    <Package size={36} className="mx-auto mb-3 opacity-40" />
                                    <p className="text-sm font-bold text-zinc-500">Todavía no agregaste nada.</p>
                                </div>
                            ) : carrito.map((it, idx) => {
                                const key = `${it.proIdProducto}:${it.wmsVarianteId}`;
                                return (
                                    // Item estilo 1 (18/08): fila abierta sin sub-card — tile blanco,
                                    // contador ghost cyan al medio, tacho ghost magenta y precio
                                    // tipográfico en Google Sans Code. Entre items, separador sutil
                                    // al 90% del ancho.
                                    <React.Fragment key={key}>
                                    {idx > 0 && <div className="mx-auto w-[90%] h-px bg-zinc-800" />}
                                    <div className={`py-1 rounded-lg ${saliendo[key] ? 'overflow-hidden pointer-events-none' : ''}`}
                                        style={saliendo[key] ? { animation: 'tienda-item-out 0.58s ease forwards' } : undefined}>
                                        {/* Nivel 1 (layout B, 18/08): título a todo el ancho — no se trunca
                                            más — con el tacho en la misma línea, a la derecha. */}
                                        <div className="flex items-center justify-between gap-2 mb-2">
                                            <p className="flex-1 min-w-0 text-xs font-bold text-zinc-100 uppercase leading-snug">{it.titulo}</p>
                                            <button onClick={() => quitarItemAnimado(key)} className="w-5 h-5 shrink-0 rounded-md border border-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/20 flex items-center justify-center transition-colors"><Trash2 size={11} /></button>
                                        </div>
                                        {/* Nivel 2: foto + talle + contador centrado + precio (ancho fijo
                                            para que los dígitos no corran el contador entre filas). */}
                                        {/* relative: el contador va ABSOLUTO al centro del ancho de la fila
                                            (con flex quedaba centrado solo en el hueco libre, corrido). */}
                                        <div className="relative flex items-center gap-3">
                                            <div className="w-12 h-12 rounded-xl bg-white shrink-0 flex items-center justify-center overflow-hidden">
                                                {it.foto ? <img src={it.foto} alt="" className="w-full h-full object-contain" /> : <ImageOff size={18} className="text-zinc-300" />}
                                            </div>
                                            {/* Solo el TALLE (el color ya se ve en la foto); si el nombre no
                                                parsea, se muestra entero como antes. */}
                                            {it.variante && it.variante !== 'Única' && <span className="text-[11px] text-zinc-500 shrink-0">{parseVariante(it.variante)?.talle || it.variante}</span>}
                                            {/* Contador opción 4 (2ª ronda, 18/08): micro-botones circulares
                                                bien separados y el número con "UNID." debajo. */}
                                            <div className="absolute left-1/2 -translate-x-1/2 flex items-center justify-center">
                                                <div className="flex items-center gap-3">
                                                    <button onClick={() => cambiarCantidad(key, -1)} disabled={it.cantidad <= 1}
                                                        className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${it.cantidad <= 1
                                                            ? 'text-zinc-600 cursor-not-allowed'
                                                            : 'bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20'}`}><Minus size={10} /></button>
                                                    <div className="flex flex-col items-center leading-none">
                                                        <NumeroAnimado n={it.cantidad} className="text-base font-black text-zinc-100 font-gsanscode leading-none" />
                                                        <span className="text-[10px] tracking-wider text-zinc-600 mt-0.5">UNID.</span>
                                                    </div>
                                                    <button onClick={() => cambiarCantidad(key, +1)} disabled={it.cantidad >= DISPONIBLES_PLACEHOLDER}
                                                        className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${it.cantidad >= DISPONIBLES_PLACEHOLDER
                                                            ? 'text-zinc-600 cursor-not-allowed'
                                                            : 'bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20'}`}><Plus size={10} /></button>
                                                </div>
                                            </div>
                                            <span className="w-20 ml-auto text-right whitespace-nowrap font-gsanscode font-bold">
                                                <span className="text-[11px] text-zinc-500">{it.moneda === 'USD' ? 'US$' : '$'} </span>
                                                <NumeroAnimado n={Number(it.precio * it.cantidad) || 0} formato={v => v.toLocaleString('es-UY', { maximumFractionDigits: 2 })} className="text-[15px] text-zinc-100" />
                                            </span>
                                        </div>
                                    </div>
                                    </React.Fragment>
                                );
                            })}
                        </div>

                        {carrito.length > 0 && (
                            <div className="px-5 pt-3 pb-7 border-t border-zinc-800 space-y-3">
                                {/* Pie estilo 4 (18/08): total tipográfico grande, sin la moneda en el
                                    label (el símbolo del monto ya la dice). */}
                                <div className="space-y-1">
                                    {Object.entries(totales).map(([mon, tot]) => (
                                        <div key={mon} className="flex justify-between items-center">
                                            <span className="text-[12px] font-bold uppercase tracking-widest text-zinc-500">Total</span>
                                            <span className="whitespace-nowrap inline-flex items-baseline gap-1 font-gsanscode font-bold">
                                                <span className="text-[13px] text-zinc-500">{mon === 'USD' ? 'US$' : '$'}</span>
                                                <NumeroAnimado n={Number(tot) || 0} formato={v => v.toLocaleString('es-UY', { maximumFractionDigits: 2 })} className="text-2xl text-zinc-100" />
                                            </span>
                                        </div>
                                    ))}
                                    {monedasMezcladas && cotizacionDolar && (
                                        <div className="flex justify-between text-[11px] text-zinc-500">
                                            <span>Se registra todo en dólares (cotiz. {cotizacionDolar})</span>
                                            <span className="font-bold">≈ {fmt(totalAproxUSD, 'USD')}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Forma de envío (Retiro en el Local / Encomienda, patrón ECOUV).
                                    Vuelve a mostrarse (18/08): decide el camino del checkout —
                                    retiro = pago online obligatorio; encomienda = VEN sin pago
                                    y el cliente paga después desde Retiro de Pedidos. */}
                                {formasEnvio.length > 0 && (
                                    <div className="grid grid-cols-2 gap-2">
                                        {formasEnvio.map(f => {
                                            const esEnc = /encomienda/i.test(f.Nombre || '');
                                            const activa = formaEnvioId === f.ID;
                                            return (
                                                <button
                                                    key={f.ID}
                                                    onClick={() => setFormaEnvioId(f.ID)}
                                                    className={`px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wide border transition-colors flex items-center justify-center gap-1.5 ${activa
                                                        ? 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan'
                                                        : 'border-zinc-700 text-zinc-500 hover:text-zinc-300'}`}
                                                >
                                                    {esEnc ? <Truck size={14} /> : <MapPin size={14} />}
                                                    {/* Sin el paréntesis del nomenclador: "Encomienda (Agencia)" → "Encomienda" */}
                                                    {String(f.Nombre || '').replace(/\s*\(.+?\)/g, '').trim()}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}

                                <button
                                    onClick={() => envioEsEncomienda ? confirmarCompra() : setPayModalAbierto(true)}
                                    disabled={comprando}
                                    className={`w-full pt-4 pb-3.5 rounded-xl text-sm font-black uppercase tracking-wide border transition-colors flex items-center justify-center leading-none ${comprando
                                        ? 'bg-zinc-800 border-transparent text-zinc-500 cursor-wait'
                                        : 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20'}`}
                                >
                                    {comprando
                                        ? <span className="inline-flex items-center gap-2 relative -top-px"><Loader2 size={16} className="animate-spin" /> Confirmando...</span>
                                        : envioEsEncomienda
                                            ? <span className="inline-flex items-center gap-2 relative -top-px"><CheckCircle2 size={16} /> Confirmar pedido</span>
                                            : <span className="inline-flex items-center gap-2 relative -top-px"><CreditCard size={16} /> Pagar ahora</span>}
                                </button>
                            </div>
                        )}
                        </>)}
                    </aside>

                    {/* Sheet de método de pago (18/08): sube desde abajo sobre el carrito.
                        Diseño calcado del modal de portal/pickup (Handy / MercadoPago + nota). */}
                    {payModalAbierto && (
                        <div className="absolute inset-0 z-30 flex items-end md:items-center justify-center">
                            <div className="absolute inset-0 bg-black/70" onClick={cerrarPay} style={{ animation: payCerrando ? 'tienda-backdrop-out 0.22s ease forwards' : 'tienda-backdrop-in 0.2s ease' }} />
                            <div
                                ref={payPanelRef}
                                className="relative w-full md:max-w-[420px] bg-[#212124] border-t md:border border-zinc-700/60 rounded-t-2xl md:rounded-2xl px-4 pt-2 pb-8 md:p-7"
                                style={{ animation: payCerrando ? 'tienda-sheet-out 0.24s ease-in forwards' : 'tienda-sheet-in 0.28s cubic-bezier(.2,.8,.3,1)' }}
                            >
                                {/* Handle (mobile): tap cierra, arrastrable — mismo gesto que los sheets */}
                                <div className="md:hidden flex justify-center">
                                    <div
                                        className="pt-0.5 pb-2 px-10"
                                        style={{ touchAction: 'none' }}
                                        onClick={() => { if (!paySwipe.movedRef.current) cerrarPay(); }}
                                        onTouchStart={paySwipe.onTouchStart} onTouchMove={paySwipe.onTouchMove} onTouchEnd={paySwipe.onTouchEnd}
                                    >
                                        <span className="block w-11 h-1.5 rounded-full bg-zinc-500"></span>
                                    </div>
                                </div>
                                <p className="text-[12px] uppercase tracking-[0.15em] text-zinc-500 m-0 mb-1.5">Elegí cómo pagar</p>
                                <h2 className="text-xl font-black text-zinc-100 mb-3">Método de pago</h2>

                                <div className="flex gap-3.5">
                                    <button
                                        onClick={() => elegirMetodoPago('handy')}
                                        disabled={comprando}
                                        className="flex-1 h-[140px] flex flex-col items-center justify-center gap-3 rounded-2xl bg-[#722efa] border border-[#722efa]/60 hover:bg-[#5e1fe8] hover:scale-[1.02] transition-all"
                                    >
                                        <img src={handyLogo} alt="Handy" className="h-10 object-contain max-w-full" />
                                        <span className="text-center leading-tight">
                                            <span className="block text-white font-bold text-sm">Handy</span>
                                            <span className="block text-white/65 text-[11px]">Tarjeta crédito / débito</span>
                                        </span>
                                    </button>
                                    <button
                                        onClick={() => elegirMetodoPago('mercadopago')}
                                        disabled={comprando}
                                        className="flex-1 h-[140px] flex flex-col items-center justify-center gap-3 rounded-2xl bg-[#ffe600] border border-[#ffe600]/60 hover:bg-[#e6cf00] hover:scale-[1.02] transition-all"
                                    >
                                        <img src={mpLogo} alt="MercadoPago" className="h-10 object-contain max-w-full" />
                                        <span className="text-center leading-tight">
                                            <span className="block text-[#1a1a1a] font-bold text-sm">MercadoPago</span>
                                            <span className="block text-black/55 text-[11px]">Saldo, tarjeta o cuotas</span>
                                        </span>
                                    </button>
                                </div>

                                <div className="mt-5 px-3.5 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] flex items-start gap-2">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                                    <p className="text-[11px] text-white/35 m-0 leading-relaxed">
                                        Tus datos de tarjeta son procesados directamente por Handy o MercadoPago. USER no almacena ni accede a información financiera de ningún tipo.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            , document.body)}
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
        if (!fotosColor.length || !varSel) return;
        const fc = fotoDeColor(fotosColor, varSel.color || varSel.nombre);
        const idx = fc ? fotosColor.indexOf(fc) : -1;
        if (idx >= 0) setFotoIdx((producto.fotos?.length || 0) + idx);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [varSel]);

    // Ejes talle/color. [VARIANTES 21/08] Fuente DATOS-primero: si la variante trae
    // talle/color cargados en la base (los llena el auto-parse del backend y los corrige
    // marketing), se usan esos; si no, la heurística de nombres de siempre (parseVariante).
    // Soporta solo-color (talle único: todas con talle null y color cargado — el caso
    // gorros) y solo-talle. Si alguna variante queda sin resolver por NINGUNA vía, lista
    // plana como siempre — nunca se esconde una variante.
    const ejeDe = (v) => (v?.talle != null || v?.color != null)
        ? { talle: v.talle || null, color: v.color || null }
        : parseVariante(v?.nombre);
    const ejes = useMemo(() => {
        if (variantes.length <= 1) return null;
        const parsed = variantes.map(v => ({ v, p: ejeDe(v) }));
        if (parsed.some(x => !x.p)) return null;
        const colores = [...new Set(parsed.map(x => x.p.color).filter(Boolean))];
        const talles = [...new Set(parsed.map(x => x.p.talle).filter(Boolean))].sort(cmpTalles);
        if (!colores.length && !talles.length) return null; // nada distinguible → lista plana
        return { parsed, colores, talles };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [producto]);
    const p0 = ejeDe(variantes[0]);
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

    // [ANIMACIÓN CERRAR 18/08] Igual que el carrito: corre la salida (pop inverso +
    // fade del fondo) y recién después avisa al padre para desmontar.
    const [cerrando, setCerrando] = useState(false);
    const cerrar = () => {
        if (cerrando) return;
        setCerrando(true);
        setTimeout(onCerrar, 240);
    };

    const panelRef = React.useRef(null);
    const swipe = useSwipeDown(panelRef, cerrar);

    // Portal al body: dentro del árbol del layout el fixed se anclaba a un ancestro (con
    // transform, fixed deja de referir al viewport) y el modal quedaba con un hueco arriba
    // en mobile. Colgado del body, inset-0 es el viewport de verdad.
    return createPortal(
        // Mobile: la ficha ocupa TODO el viewport (sin borde ni redondeo); de md: para
        // arriba vuelve a ser la card centrada de siempre. z-[10000] porque la navbar del
        // portal (LandingNavbar) es fixed con zIndex 9999 y tapaba el modal.
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-0 md:p-4">
            {/* Animación (18/08): mobile = sheet (sube desde abajo / baja al cerrar);
                desktop = zoom con rebote al abrir y zoom-out al cerrar. Fondo con fade. */}
            <style>{`@keyframes tienda-sheet-in { from { transform: translateY(100%) } to { transform: none } } @keyframes tienda-sheet-out { to { transform: translateY(100%) } } @keyframes tienda-zoom-in { 0% { opacity: 0; transform: scale(.8) } 70% { opacity: 1; transform: scale(1.03) } 100% { opacity: 1; transform: scale(1) } } @keyframes tienda-zoom-out { to { opacity: 0; transform: scale(.85) } } .tienda-ficha-panel { animation: tienda-sheet-in 0.28s cubic-bezier(.2,.8,.3,1) } .tienda-ficha-panel-out { animation: tienda-sheet-out 0.24s ease-in forwards } @media (min-width: 768px) { .tienda-ficha-panel { animation: tienda-zoom-in 0.32s cubic-bezier(.2,.9,.3,1.2) } .tienda-ficha-panel-out { animation: tienda-zoom-out 0.2s ease forwards } } @keyframes tienda-backdrop-in { from { opacity: 0 } to { opacity: 1 } } @keyframes tienda-backdrop-out { to { opacity: 0 } }`}</style>
            <div className="absolute inset-0 bg-black/70" onClick={cerrar} style={{ animation: cerrando ? 'tienda-backdrop-out 0.22s ease forwards' : 'tienda-backdrop-in 0.2s ease' }} />
            {/* Tipografía de la ficha (18/08): texto en DM Sans, números en Google Sans Code */}
            {/* Mobile: el modal NO scrollea entero — es columna flex con la foto fija arriba
                y SOLO los datos scrollean (ver columna de datos). Desktop: scroll normal. */}
            <div ref={panelRef} className={`${cerrando ? 'tienda-ficha-panel-out' : 'tienda-ficha-panel'} relative bg-custom-dark w-full h-full overflow-hidden flex flex-col font-dmsans md:block md:overflow-y-auto md:h-auto md:max-h-[90vh] md:max-w-3xl md:rounded-2xl md:border md:border-zinc-700/60`}>
                {/* Cerrar (mobile): handle de bottom-sheet, sticky al tope — tap cierra y
                    también se puede ARRASTRAR hacia abajo (ver dragStart/Move/End). La zona
                    táctil es solo el área del handle, para no pelearse con el scroll. */}
                {/* Franja SÓLIDA (no overlay): al scrollear, la foto pasa por debajo de esta
                    banda oscura y el handle nunca queda flotando sobre el blanco. */}
                <div className="md:hidden sticky top-0 z-20 bg-custom-dark flex justify-center">
                    <div
                        className="pt-2.5 pb-3 px-10 cursor-grab active:cursor-grabbing"
                        style={{ touchAction: 'none' }}
                        onClick={() => { if (!swipe.movedRef.current) cerrar(); }}
                        onTouchStart={swipe.onTouchStart} onTouchMove={swipe.onTouchMove} onTouchEnd={swipe.onTouchEnd}
                    >
                        <span className="block w-11 h-1.5 rounded-full bg-zinc-500"></span>
                    </div>
                </div>
                {/* Cerrar (desktop): arriba a la derecha del modal, mismo ghost adaptado al fondo oscuro. */}
                <button onClick={cerrar} className="hidden md:flex absolute top-3 right-3 z-10 w-8 h-8 rounded-lg border border-zinc-500/60 bg-zinc-500/10 text-zinc-300 hover:bg-zinc-500/20 items-center justify-center transition-colors"><X size={16} /></button>

                <div className="flex flex-col flex-1 min-h-0 md:grid md:grid-cols-2 md:gap-0">
                    {/* Fotos — centradas verticalmente en su columna (desktop: la columna de
                        datos suele ser más alta y la foto quedaba arriba). En mobile SIN padding
                        arriba: la única separación con el handle es la de la propia franja, así
                        el gap en reposo es igual al que se ve con el scroll abajo. */}
                    <div className="p-4 pt-0 md:pt-4 space-y-2 flex flex-col justify-center shrink-0">
                        {/* Mobile: la foto se acota a 42vh para que el resto de la ficha entre en
                            pantalla; en md+ vuelve al cuadrado de siempre. */}
                        <div className="relative h-[42vh] md:h-auto md:aspect-square rounded-xl bg-white flex items-center justify-center overflow-hidden">
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

                    {/* Datos — en mobile ESTA columna es el único scroller (flex-1 + overflow):
                        la foto de arriba queda fija. pb-0: el remate inferior lo pone el bloque
                        sticky (su pb-4); así el sticky llega hasta el final real del scroll. */}
                    <div className="p-5 pb-0 md:pb-5 md:pr-8 space-y-4 flex-1 min-h-0 overflow-y-auto md:flex-none md:min-h-fit md:overflow-visible">
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
                                                {/* Pills uniformes: miniatura (si el color tiene foto) + nombre SIEMPRE
                                                    visible. Antes convivían cuadraditos mudos con chips de texto y el
                                                    selector quedaba ilegible cuando solo algunos colores tenían foto. */}
                                                <div className="flex gap-2 flex-wrap">
                                                    {ejes.colores.map(c => {
                                                        const foto = fotoDeColor(fotosColor, c)?.url || null;
                                                        const on = colorSel === c;
                                                        return (
                                                            <button key={c} onClick={() => elegirColor(c)} title={c}
                                                                className={`flex items-center gap-1.5 rounded-xl text-xs font-bold border transition-colors ${foto ? 'pl-1.5 pr-3 py-1.5' : 'px-3 py-2'} ${on
                                                                    ? 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan'
                                                                    : 'border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'}`}>
                                                                {foto && (
                                                                    <span className="w-7 h-7 rounded-lg bg-white overflow-hidden shrink-0">
                                                                        <img src={foto} alt="" className="w-full h-full object-contain" />
                                                                    </span>
                                                                )}
                                                                {c}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                        {ejes.talles.length > 0 && (
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
                                        )}
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

                                {/* Cantidad + agregar (opción C, 18/08). En mobile TODO el bloque va
                                    sticky al fondo (cantidad + disponibles + botón): si fuera solo el
                                    botón, al abrir pisaba la fila de cantidad hasta scrollear. En md+
                                    vuelve al flujo normal. */}
                                {/* OJO: sin margen negativo abajo — el -mb achicaba el contenedor del
                                    sticky y el botón se soltaba del borde antes de terminar el scroll. */}
                                <div className="space-y-2.5 sticky bottom-0 z-10 bg-custom-dark -mx-5 px-5 pt-2 pb-4 md:static md:bg-transparent md:mx-0 md:px-0 md:pt-0 md:pb-0">
                                    {/* Mismo contador que el carrito (opción 4): micro-botones circulares
                                        y el número con "UNID." debajo, con la animación de conteo. */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Cantidad</span>
                                        <div className="flex items-center gap-3">
                                            <button onClick={() => setCantidad(c => Math.max(1, c - 1))} disabled={cantidad <= 1}
                                                className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${cantidad <= 1
                                                    ? 'text-zinc-600 cursor-not-allowed'
                                                    : 'bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20'}`}><Minus size={10} /></button>
                                            <div className="flex flex-col items-center leading-none">
                                                <NumeroAnimado n={cantidad} className="text-base font-black text-zinc-100 font-gsanscode leading-none" />
                                                <span className="text-[10px] tracking-wider text-zinc-600 mt-0.5">UNID.</span>
                                            </div>
                                            <button onClick={() => setCantidad(c => Math.min(DISPONIBLES_PLACEHOLDER, c + 1))} disabled={cantidad >= DISPONIBLES_PLACEHOLDER}
                                                className={`w-5 h-5 rounded-full flex items-center justify-center transition-colors ${cantidad >= DISPONIBLES_PLACEHOLDER
                                                    ? 'text-zinc-600 cursor-not-allowed'
                                                    : 'bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20'}`}><Plus size={10} /></button>
                                        </div>
                                    </div>
                                    {/* [STOCK] Placeholder visual con número FIJO, sin conectar a nada:
                                        el sistema de stock de la tienda no existe todavía. Cuando esté,
                                        acá va el disponible real de la variante elegida (y el tope del +). */}
                                    <p className="text-[11px] font-bold text-zinc-500 text-right -mt-1"><span className="font-gsanscode">{DISPONIBLES_PLACEHOLDER}</span> disponibles</p>
                                    <button
                                        onClick={() => { onAgregar(producto, varSel, cantidad); cerrar(); }}
                                        disabled={sinPrecio}
                                        className={`w-full py-3.5 rounded-xl text-sm font-black uppercase tracking-wide border transition-colors ${sinPrecio
                                            ? 'bg-zinc-800 border-transparent text-zinc-600 cursor-not-allowed'
                                            : 'border-brand-cyan/60 bg-brand-cyan/10 text-brand-cyan hover:bg-brand-cyan/20'}`}
                                    >
                                        <span className="inline-flex items-center justify-center gap-2 w-full"><ShoppingCart size={16} /> Agregar</span>
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
