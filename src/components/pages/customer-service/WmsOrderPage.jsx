import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { Search, ShoppingCart, Package, Plus, Minus, Trash2, CheckCircle, RefreshCw, X, User, Loader2, PackageSearch, UserX, Printer, ArrowLeftRight } from 'lucide-react';
import { wmsService } from '../../../services/api';
import { clientsService } from '../../../services/api';

// Estética nueva (27/10/2026): encabezado de una línea, barra de herramientas aparte (interruptores brand-cyan,
// buscador, Sincronizar), catálogo en tarjetas blancas y carrito CLARO (Confirmar en brand-cyan, Cotizar secundario),
// montos en formato uruguayo con «$» / «US$», ventanas claras en z-[6000]. En el celular el carrito queda abajo y una
// barra pegada abajo lleva hasta él. Embebido (/ventas/pedido-prenda) sigue oscuro como antes. La lógica no cambió; el ticket
// que se imprime tampoco.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
const CAMPO = 'w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
// Interruptores de la barra (prendido: pista brand-cyan)
const INTERRUPTOR = 'inline-flex items-center justify-center sm:justify-start gap-2 px-3 py-2 rounded-xl border text-xs sm:text-sm font-bold whitespace-nowrap transition-colors flex-1 sm:flex-none';
const INTERRUPTOR_SI = 'border-brand-cyan/30 bg-brand-cyan/5 text-zinc-800';
const INTERRUPTOR_NO = 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50';
const PISTA = 'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors';
const PERILLA = 'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform';
// Botones − / + de las cantidades
const PASO = 'w-8 h-8 inline-flex items-center justify-center text-zinc-500 hover:bg-zinc-50 hover:text-brand-cyan transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-zinc-500';
// Montos en pantalla: formato uruguayo con 2 decimales y «$» / «US$» (el ticket impreso sigue con su formato)
const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const simbolo = (moneda) => (moneda === 'USD' ? 'US$' : '$');

// [PRENDAS] embedded/initialClient son ADITIVOS: sin props (uso normal en
// /atencion-cliente/pedidos-wms) el comportamiento es idéntico al de siempre.
// Se usan para incrustar este mismo carrito dentro de /ventas/pedido-prenda
// cuando el vendedor elige "Comprar prendas", con el cliente ya elegido arriba.
const WmsOrderPage = forwardRef(({ embedded = false, initialClient = null, onCartChange = null, personalizacionResumen = [], showOwnCheckout = true } = {}, ref) => {
    const [catalog, setCatalog] = useState([]);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
    // Freno de doble clic en "Confirmar": el ref corta en seco (el state tarda un render),
    // el state apaga el botón. Sin esto, dos clics seguidos crearon VEN-2431 dos veces.
    const [confirmando, setConfirmando] = useState(false);
    const confirmandoRef = useRef(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [hideOutOfStock, setHideOutOfStock] = useState(true);
    const [showImages, setShowImages] = useState(true);
    const [cart, setCart] = useState([]);
    const [selectedProduct, setSelectedProduct] = useState(null);

    // Client Selection State
    const [clientSearchTerm, setClientSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearchingClient, setIsSearchingClient] = useState(false);
    const [selectedClient, setSelectedClient] = useState(initialClient);
    const searchTimeoutRef = useRef(null);

    // [PRENDAS] Si el padre cambia el cliente elegido, este carrito lo sigue.
    useEffect(() => {
        if (initialClient) setSelectedClient(initialClient);
    }, [initialClient]);

    // [PRENDAS] Tema: embebido usa dark (combina con /ventas/pedido-prenda), standalone
    // sigue con el theme claro de siempre. `t('claro', 'oscuro')` elige según el modo.
    const t = (lightCls, darkCls) => (embedded ? darkCls : lightCls);

    // [PRENDAS] Avisa al padre qué hay en el carrito (array completo, no solo el total) —
    // el padre lo usa para precargar "Cantidad Total" en Personalizar y, si personaliza,
    // para armar la línea de producto terminado que se suma al mismo pedido de producción.
    useEffect(() => {
        if (onCartChange) onCartChange(cart);
    }, [cart, onCartChange]);

    const [variantModalItem, setVariantModalItem] = useState(null);
    const [selectedVariantId, setSelectedVariantId] = useState(null);
    const [selectedSize, setSelectedSize] = useState(null);
    const [selectedColor, setSelectedColor] = useState(null);
    const [variantQty, setVariantQty] = useState(1);

    const [exchangeRate, setExchangeRate] = useState(40.0);

    const [orderState, setOrderState] = useState({
        moneda: 'UYU',
        successCode: null
    });

    const orderCurrency = cart.some(item => item.moneda === 'USD') ? 'USD' : (cart.length > 0 ? cart[0].moneda : 'UYU');
    
    const totalCart = cart.reduce((sum, item) => {
        let itemPrice = item.precio;
        if (orderCurrency === 'USD' && item.moneda !== 'USD') {
            itemPrice = itemPrice / exchangeRate;
        } else if (orderCurrency === 'UYU' && item.moneda === 'USD') {
            itemPrice = itemPrice * exchangeRate;
        }
        return sum + (itemPrice * item.cantidad);
    }, 0);

    useEffect(() => {
        loadCatalog();
        loadExchangeRate();
    }, []);

    const loadExchangeRate = async () => {
        try {
            const res = await wmsService.getExchangeRate();
            if (res && res.rate) {
                setExchangeRate(res.rate);
            }
        } catch (e) {
            console.error("Error loading exchange rate:", e);
        }
    };

    const loadCatalog = async () => {
        setLoading(true);
        try {
            const result = await wmsService.getCatalog();
            setCatalog(result.data || []);
        } catch (error) {
            toast.error('Error cargando el catálogo WMS');
        } finally {
            setLoading(false);
        }
    };

    const handleSync = async () => {
        setSyncing(true);
        try {
            const result = await wmsService.syncCatalog();
            toast.success(result.message || 'Catálogo sincronizado exitosamente');
            await loadCatalog();
        } catch (error) {
            toast.error('Error sincronizando con WMS');
        } finally {
            setSyncing(false);
        }
    };

    const handleClientSearch = (e) => {
        const val = e.target.value;
        setClientSearchTerm(val);

        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        
        if (val.trim().length < 3) {
            setSearchResults([]);
            return;
        }

        setIsSearchingClient(true);
        searchTimeoutRef.current = setTimeout(async () => {
            try {
                // Ajustar si en tu API el search de cliente devuelve { data: [...] }
                const res = await clientsService.search(val);
                setSearchResults(res.data || res || []);
            } catch (error) {
                console.error("Error searching clients:", error);
            } finally {
                setIsSearchingClient(false);
            }
        }, 500);
    };

    const addItemToCart = (product, variant, qty) => {
        if (qty > variant.stock) {
            toast.error('Cantidad supera el stock disponible');
            return;
        }

        setCart(prev => {
            const existing = prev.find(item => item.wms_variante_id === variant.wms_variante_id);
            if (existing) {
                if (existing.cantidad + qty > variant.stock) {
                    toast.error('Stock máximo alcanzado con esta suma');
                    return prev;
                }
                return prev.map(item => 
                    item.wms_variante_id === variant.wms_variante_id 
                        ? { ...item, cantidad: item.cantidad + qty }
                        : item
                );
            }
            return [...prev, {
                wms_variante_id: variant.wms_variante_id,
                ProIdProducto: product.ProIdProducto,
                nombre: variant.nombre_variante === 'Única' ? product.Descripcion : `${product.Descripcion} - ${variant.nombre_variante}`,
                cantidad: qty,
                // Precio: usa precio_excepcion de la variante si existe, sino el precio base del producto
                precio: variant.precio_excepcion != null ? variant.precio_excepcion : product.precio,
                moneda: variant.precio_excepcion != null && variant.moneda_excepcion ? variant.moneda_excepcion : product.moneda,
                stock: variant.stock
            }];
        });
        toast.success(`Añadido al carrito`);
    };

    const openVariantModal = (product) => {
        // Si el artículo solo tiene 1 variante (por ejemplo "Única") y tiene stock, agregarlo directamente
        if (product.variantes.length === 1 && product.variantes[0].stock > 0) {
            addItemToCart(product, product.variantes[0], 1);
            return;
        }
        
        // De lo contrario, abrir el modal de variantes
        setVariantModalItem(product);
        setSelectedVariantId(null);
        setSelectedSize(null);
        setSelectedColor(null);
        setVariantQty(1);
    };

    const handleAddToCart = () => {
        if (!selectedVariantId) {
            toast.error('Debes seleccionar una variante');
            return;
        }
        const variant = variantModalItem.variantes.find(v => v.wms_variante_id === selectedVariantId);
        addItemToCart(variantModalItem, variant, variantQty);
        setVariantModalItem(null);
    };

    const updateQuantity = (variantId, delta) => {
        setCart(prev => prev.map(item => {
            if (item.wms_variante_id === variantId) {
                const newQty = item.cantidad + delta;
                if (newQty < 1) return item;
                if (newQty > item.stock) {
                    toast.error('Stock máximo alcanzado');
                    return item;
                }
                return { ...item, cantidad: newQty };
            }
            return item;
        }));
    };

    const removeItem = (variantId) => {
        setCart(prev => prev.filter(item => item.wms_variante_id !== variantId));
    };

    const updatePrice = (variantId, newPrice) => {
        if (newPrice < 0) return;
        setCart(prev => prev.map(item => {
            if (item.wms_variante_id === variantId) {
                return { ...item, precio: newPrice };
            }
            return item;
        }));
    };

    const printTicketData = (comprobante, isCotizacion = false) => {
        const cartCurrency = orderCurrency === 'USD' ? 'U$S' : '$';
        
        const data = {
            empresa: 'USER',
            fecha: new Date().toLocaleDateString('es-UY') + ' ' + new Date().toLocaleTimeString('es-UY'),
            comprobante: isCotizacion ? 'COTIZACIÓN' : comprobante,
            cajero: 'VENTAS_WMS',
            cliente: selectedClient ? (selectedClient.Nombre || selectedClient.RazonSocial || selectedClient.nombre) : 'Consumidor Final',
            clienteDetalles: selectedClient ? {
                id: selectedClient.CodCliente || selectedClient.ClienteID || selectedClient.id,
                ruc: selectedClient.CioRuc || selectedClient.RUT || selectedClient.RUC || selectedClient.CI,
                email: selectedClient.Email || selectedClient.Correo,
                telefono: selectedClient.TelefonoTrabajo || selectedClient.Telefono || selectedClient.Celular,
                direccion: selectedClient.DireccionTrabajo || selectedClient.CliDireccion || selectedClient.Direccion
            } : null,
            items: cart.map(i => {
                let itemPrice = i.precio;
                if (orderCurrency === 'USD' && i.moneda !== 'USD') {
                    itemPrice = itemPrice / exchangeRate;
                } else if (orderCurrency === 'UYU' && i.moneda === 'USD') {
                    itemPrice = itemPrice * exchangeRate;
                }
                return { descripcion: i.nombre, cantidad: i.cantidad, importe: itemPrice * i.cantidad };
            }),
            totales: { total: totalCart, moneda: cartCurrency }
        };

        const fmtN = (n) => Number(n || 0).toFixed(2);
        const itemsHtml = (data.items || []).map(it =>
            `<tr><td style="padding:2px 0;vertical-align:top">${it.descripcion}</td><td style="text-align:center;vertical-align:top">${it.cantidad || 1}</td><td style="text-align:right;vertical-align:top">$${fmtN(it.importe)}</td></tr>`
        ).join('');

        let clientDetailsHtml = '';
        if (data.clienteDetalles) {
            clientDetailsHtml = `
            <div style="font-size:10px;color:#555;margin:4px 0 0 10px;line-height:1.3">
                ${data.clienteDetalles.id ? `<p><strong>IDCLIENTE:</strong> ${data.clienteDetalles.id}</p>` : ''}
                ${data.clienteDetalles.ruc ? `<p><strong>RUC / CI:</strong> ${data.clienteDetalles.ruc}</p>` : ''}
                ${data.clienteDetalles.email ? `<p><strong>Email:</strong> ${data.clienteDetalles.email}</p>` : ''}
                ${data.clienteDetalles.telefono ? `<p><strong>Teléfono:</strong> ${data.clienteDetalles.telefono}</p>` : ''}
                ${data.clienteDetalles.direccion ? `<p><strong>Dirección:</strong> ${data.clienteDetalles.direccion}</p>` : ''}
            </div>
            `;
        }

        const win = window.open('', '_blank', 'width=340,height=600');
        if (!win) {
            toast.error('Ventana emergente bloqueada. Habilite los pop-ups para imprimir.');
            return;
        }
        win.document.write(`
        <html><head><title>Ticket ${data.comprobante}</title>
        <style>
            *{margin:0;padding:0;box-sizing:border-box}
            body{font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.2;padding:5mm;width:80mm;background:#fff;color:#000}
            h2{font-size:18px;font-weight:bold;text-align:center;margin:0 0 5px}
            .sep{border-bottom:1px dashed #000;margin:10px 0}
            table{width:100%;font-size:11px;margin-bottom:10px}
            th{text-align:left;border-bottom:1px dotted #000}
            th:nth-child(2){text-align:center}th:last-child{text-align:right}
            .total{font-size:14px;font-weight:bold;display:flex;justify-content:space-between;margin:5px 0}
            .pie{text-align:center;font-size:10px;color:#999;margin-top:20px}
            @page{size:80mm auto;margin:0}
        </style></head><body>
        <div style="text-align:center;margin-bottom:10px">
            <h2>${data.empresa}</h2>
        </div>
        <div class="sep"></div>
        <p><strong>FECHA :</strong> ${data.fecha}</p>
        <p><strong>TICKET:</strong> ${data.comprobante}</p>
        <p><strong>CAJERO:</strong> ${data.cajero}</p>
        <p><strong>CLIENTE:</strong> ${data.cliente}</p>
        ${clientDetailsHtml}
        <div class="sep"></div>
        <table><thead><tr><th>Detalle</th><th>Cant</th><th>Total</th></tr></thead>
        <tbody>${itemsHtml}</tbody></table>
        <div class="sep"></div>
        <p class="total"><span>TOTAL:</span><span>${data.totales.moneda} ${fmtN(data.totales.total)}</span></p>
        <div class="sep"></div>
        <div class="pie"><p>Servicio brindado por USER ERP</p></div>
        <div style="height:10mm"></div>
        </body></html>`);
        win.document.close();
        win.focus();
        win.addEventListener('afterprint', () => {
            win.close();
        });
        setTimeout(() => {
            win.print();
        }, 1000);
    };

    const handleCotizar = () => {
        if (cart.length === 0) return;
        printTicketData('COTIZACIÓN', true);
        toast.success('Ticket de cotización generado');
    };

    const handleCheckout = async () => {
        if (cart.length === 0) return { success: false };
        if (!selectedClient) {
            toast.error('Por favor, selecciona un cliente para el pedido');
            return { success: false };
        }

        const convertedItems = cart.map(i => {
            let itemPrice = i.precio;
            if (orderCurrency === 'USD' && i.moneda !== 'USD') {
                itemPrice = itemPrice / exchangeRate;
            } else if (orderCurrency === 'UYU' && i.moneda === 'USD') {
                itemPrice = itemPrice * exchangeRate;
            }
            return { 
                ...i, 
                precio: itemPrice, 
                moneda: orderCurrency,
                precioOriginal: i.precio,
                monedaOriginal: i.moneda,
                subtotalOriginal: i.precio * i.cantidad
            };
        });

        const clienteId = selectedClient.CliIdCliente 
            || selectedClient.CodCliente 
            || selectedClient.ClienteID 
            || selectedClient.id 
            || 2089; // fallback: CONSUMIDOR FINAL

        const orderData = {
            clienteId,
            moneda: orderCurrency,
            items: convertedItems,
            total: totalCart
        };

        if (confirmandoRef.current) return { success: false, message: 'El pedido ya se está registrando' };
        confirmandoRef.current = true;
        setConfirmando(true);
        try {
            const res = await wmsService.createOrder(orderData);
            if (res.success) {
                setOrderState(prev => ({ ...prev, successCode: res.codigoVenta }));
                printTicketData(res.codigoVenta, false); // Print the actual order ticket
                setCart([]);
                if (!embedded) {
                    setSelectedClient(null);
                    setClientSearchTerm('');
                }
                toast.success('Pedido registrado con éxito y ticket generado');
                return { success: true, codigoVenta: res.codigoVenta };
            }
            return { success: false, message: res.message };
        } catch (error) {
            toast.error('Error al generar el pedido');
            return { success: false, message: error?.response?.data?.error || error?.message || 'Error al generar el pedido' };
        } finally {
            confirmandoRef.current = false;
            setConfirmando(false);
        }
    };

    // [PRENDAS] Cuando está embebido y "Comprar" no personaliza, el botón "Confirmar
    // Pedido" de PrendaOrderForm es el único punto de confirmación — dispara la compra
    // WMS desde acá vía ref, reusando handleCheckout tal cual (misma conversión de
    // moneda, mismo ticket) en vez de reimplementarlo aparte.
    useImperativeHandle(ref, () => ({
        confirmarCompra: () => handleCheckout(),
    }));

    const filteredCatalog = catalog.filter(p => {
        const matchesSearch = p.Descripcion.toLowerCase().includes(searchTerm.toLowerCase()) ||
                              (p.nombre_wms && p.nombre_wms.toLowerCase().includes(searchTerm.toLowerCase()));
        const hasStock = !hideOutOfStock || Number(p.total_stock) !== 0;
        return matchesSearch && hasStock;
    });

    // const totalCart = ... calculated at the top

    return (
        <div className={embedded ? "relative" : "px-3 sm:px-6 py-5 min-h-full text-zinc-700 relative"}>

            {/* Modal Variantes (en un portal: dentro del contenido quedaba debajo de la barra de arriba) */}
            {variantModalItem && createPortal(
                <div className="fixed inset-0 bg-black/40 z-[6000] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">

                        {/* Modal Header */}
                        <div className="flex justify-between items-start gap-3 px-5 py-4 border-b border-zinc-100">
                            <div className="min-w-0">
                                <h3 className="font-black text-zinc-900 text-lg leading-tight">Opciones: {variantModalItem.Descripcion}</h3>
                                <p className="text-xs text-zinc-400 mt-1">Selecciona la variante que deseas añadir</p>
                            </div>
                            <button type="button" onClick={() => setVariantModalItem(null)} aria-label="Cerrar" className="shrink-0 text-zinc-400 hover:text-brand-magenta w-9 h-9 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="px-5 py-4 overflow-y-auto max-h-[60vh] custom-scrollbar">
                            {(() => {
                                // Color mapping function
                                const getColorHex = (colorName) => {
                                    const c = colorName.toUpperCase();
                                    if (c.includes('ROJO') || c.includes('RED')) return '#ef4444';
                                    if (c.includes('AZUL MARINO')) return '#1e3a8a';
                                    if (c.includes('AZUL FRANCIA')) return '#2563eb';
                                    if (c.includes('AZUL') || c.includes('BLUE')) return '#3b82f6';
                                    if (c.includes('VERDE') || c.includes('GREEN')) return '#22c55e';
                                    if (c.includes('AMARILLO') || c.includes('YELLOW')) return '#eab308';
                                    if (c.includes('NARANJA') || c.includes('ORANGE')) return '#f97316';
                                    if (c.includes('NEGRO') || c.includes('BLACK')) return '#171717';
                                    if (c.includes('BLANCO') || c.includes('WHITE')) return '#ffffff';
                                    if (c.includes('GRIS') || c.includes('GRAY') || c.includes('GREY')) return '#9ca3af';
                                    if (c.includes('ROSA') || c.includes('PINK')) return '#ec4899';
                                    if (c.includes('VIOLETA') || c.includes('MORADO') || c.includes('PURPLE')) return '#a855f7';
                                    if (c.includes('MARRON') || c.includes('BROWN')) return '#92400e';
                                    if (c.includes('CYAN')) return '#06b6d4';
                                    if (c.includes('MAGENTA')) return '#d946ef';
                                    return 'transparent'; // Fallback
                                };

                                // Parser Heurístico para Talle y Color
                                const parsedVariants = variantModalItem.variantes.map(v => {
                                    const name = v.nombre_variante;
                                    const sizeRegex = /\b(XS|S|M|L|XL|XXL|2XL|3XL|4XL|5XL|\d{1,2})\b/i;
                                    const match = name.match(sizeRegex);
                                    let size = "Única";
                                    let color = name;

                                    if (match) {
                                        size = match[0].toUpperCase();
                                        const idx = name.indexOf(match[0]);
                                        const afterSize = name.substring(idx + match[0].length).trim();
                                        if (afterSize.length > 0) {
                                            color = afterSize.replace(/^-/, '').trim();
                                        } else {
                                            color = "Único";
                                        }
                                    }
                                    return { ...v, size, color: color.toUpperCase() };
                                });

                                let sizes = [...new Set(parsedVariants.map(v => v.size))];

                                // Ordenar Talles: Números primero, Letras después
                                const letterOrder = { 'XS': 1, 'S': 2, 'M': 3, 'L': 4, 'XL': 5, 'XXL': 6, '2XL': 7, '3XL': 8, '4XL': 9, '5XL': 10, 'ÚNICA': 99 };
                                sizes.sort((a, b) => {
                                    const aIsNum = !isNaN(a);
                                    const bIsNum = !isNaN(b);
                                    if (aIsNum && bIsNum) return Number(a) - Number(b);
                                    if (aIsNum && !bIsNum) return -1;
                                    if (!aIsNum && bIsNum) return 1;
                                    const aWeight = letterOrder[a] || 50;
                                    const bWeight = letterOrder[b] || 50;
                                    if (aWeight !== bWeight) return aWeight - bWeight;
                                    return a.localeCompare(b);
                                });

                                const colorsForSize = parsedVariants.filter(v => v.size === (selectedSize || sizes[0]));

                                // Auto-select size if not selected
                                if (!selectedSize && sizes.length > 0) {
                                    setTimeout(() => setSelectedSize(sizes[0]), 0);
                                }

                                return (
                                    <div className="space-y-5">
                                        {/* Talles */}
                                        <div>
                                            <div className="flex justify-between items-end mb-2">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Talle</label>
                                                {selectedSize && <span className="text-xs font-bold text-brand-cyan">{selectedSize}</span>}
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {sizes.map(sz => (
                                                    <button
                                                        type="button"
                                                        key={sz}
                                                        onClick={() => {
                                                            setSelectedSize(sz);
                                                            setSelectedColor(null); // Reset color when size changes
                                                            setSelectedVariantId(null);
                                                            setVariantQty(1);
                                                        }}
                                                        aria-pressed={selectedSize === sz}
                                                        className={`min-w-[3rem] px-3 py-2 rounded-xl font-bold text-sm transition-colors border ${
                                                            selectedSize === sz
                                                            ? 'bg-zinc-900 border-zinc-900 text-white'
                                                            : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50'
                                                        }`}
                                                    >
                                                        {sz}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Colores */}
                                        {selectedSize && (
                                            <div>
                                                <div className="flex justify-between items-end mb-2">
                                                    <label className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Color</label>
                                                    {selectedColor && <span className="text-xs font-bold text-brand-cyan">{selectedColor}</span>}
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {colorsForSize.map(v => {
                                                        const hexColor = getColorHex(v.color);
                                                        return (
                                                        <button
                                                            type="button"
                                                            key={v.color}
                                                            onClick={() => {
                                                                if(v.stock > 0) {
                                                                    setSelectedColor(v.color);
                                                                    setSelectedVariantId(v.wms_variante_id);
                                                                    setVariantQty(1);
                                                                }
                                                            }}
                                                            disabled={v.stock <= 0}
                                                            aria-pressed={selectedColor === v.color}
                                                            className={`relative px-3 py-2.5 rounded-xl border text-left flex flex-col transition-colors active:scale-95 flex-1 ${
                                                                selectedColor === v.color
                                                                ? 'bg-brand-cyan/5 border-brand-cyan ring-1 ring-brand-cyan'
                                                                : v.stock > 0
                                                                    ? 'bg-white border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50'
                                                                    : 'bg-zinc-50 border-zinc-100 opacity-50 cursor-not-allowed'
                                                            }`}
                                                        >
                                                            <div className="flex items-center justify-between mb-1">
                                                                <div className="flex items-center gap-2 min-w-0 pr-5">
                                                                    {hexColor !== 'transparent' && (
                                                                        <div
                                                                            className="w-4 h-4 rounded-full border border-zinc-300 shrink-0"
                                                                            style={{ backgroundColor: hexColor }}
                                                                        ></div>
                                                                    )}
                                                                    <span className={`font-bold text-xs sm:text-sm leading-snug line-clamp-2 ${selectedColor === v.color ? 'text-brand-cyan' : 'text-zinc-700'}`}>
                                                                        {v.color}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            {v.stock < 9999 && (
                                                                <span className={`text-[11px] font-bold ${v.stock > 10 ? 'text-emerald-600' : v.stock > 0 ? 'text-amber-600' : 'text-brand-magenta'}`}>
                                                                    Stock: {v.stock}
                                                                </span>
                                                            )}
                                                            <span className="text-[11px] font-black text-zinc-800 tabular-nums mt-0.5">
                                                                {v.precio_excepcion != null
                                                                    ? `${simbolo(v.moneda_excepcion)} ${fmt(v.precio_excepcion)}`
                                                                    : `${simbolo(variantModalItem.moneda)} ${fmt(variantModalItem.precio)}`
                                                                }
                                                                {v.precio_excepcion != null && (
                                                                    <span className="text-[10px] text-zinc-400 ml-1 font-medium">(precio propio)</span>
                                                                )}
                                                            </span>
                                                            {selectedColor === v.color && (
                                                                <CheckCircle size={16} className="absolute top-2 right-2 text-brand-cyan" />
                                                            )}
                                                        </button>
                                                    )})}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}
                        </div>

                        {/* Modal Footer (Controls) */}
                        <div className="px-5 py-4 border-t border-zinc-100 bg-white">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center bg-white rounded-xl border border-zinc-200 h-11 overflow-hidden shrink-0">
                                    <button
                                        type="button"
                                        onClick={() => setVariantQty(Math.max(1, variantQty - 1))}
                                        aria-label="Restar uno"
                                        className={`${PASO} h-full w-10`}
                                        disabled={!selectedVariantId}
                                    >
                                        <Minus size={16} />
                                    </button>
                                    <input
                                        type="number"
                                        min="1"
                                        value={variantQty}
                                        onChange={e => {
                                            const v = parseInt(e.target.value) || 1;
                                            const variant = selectedVariantId ? variantModalItem.variantes.find(v2 => v2.wms_variante_id === selectedVariantId) : null;
                                            setVariantQty(variant ? Math.min(Math.max(1, v), variant.stock) : Math.max(1, v));
                                        }}
                                        disabled={!selectedVariantId}
                                        aria-label="Cantidad"
                                        className="w-14 h-full text-center text-sm font-bold text-zinc-800 tabular-nums bg-transparent border-x border-zinc-200 outline-none disabled:text-zinc-400"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const variant = variantModalItem.variantes.find(v => v.wms_variante_id === selectedVariantId);
                                            if (variant && variantQty < variant.stock) setVariantQty(variantQty + 1);
                                        }}
                                        aria-label="Sumar uno"
                                        className={`${PASO} h-full w-10`}
                                        disabled={!selectedVariantId}
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleAddToCart}
                                    disabled={!selectedVariantId}
                                    className={`${BTN_PRINCIPAL} flex-1 h-11`}
                                >
                                    <ShoppingCart size={16} />
                                    Añadir al Carrito
                                </button>
                            </div>
                        </div>

                    </div>
                </div>,
                document.body
            )}

            {/* Success Modal (en un portal, igual que el de variantes) */}
            {orderState.successCode && createPortal(
                <div className="fixed inset-0 bg-black/40 z-[6000] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl p-6 sm:p-8 max-w-sm w-full shadow-2xl text-center">
                        <CheckCircle size={48} strokeWidth={1.75} className="mx-auto mb-4 text-emerald-600" />
                        <h2 className="text-xl font-black text-zinc-900 mb-1">¡Pedido Exitoso!</h2>
                        <p className="text-sm text-zinc-500 mb-5">El pedido ha sido enviado a Logística para su preparación.</p>
                        <div className="bg-zinc-50 rounded-xl py-4 mb-6 border border-zinc-200">
                            <p className="text-[10px] text-zinc-400 uppercase font-black tracking-widest mb-1">CÓDIGO DE PEDIDO</p>
                            <p className="text-3xl font-mono font-black text-brand-cyan">{orderState.successCode}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setOrderState(prev => ({ ...prev, successCode: null }))}
                            className={`${BTN_PRINCIPAL} w-full h-11`}
                        >
                            Crear Nuevo Pedido
                        </button>
                    </div>
                </div>,
                document.body
            )}

            <div className={t('flex flex-col lg:flex-row gap-4 lg:gap-5', 'max-w-[1400px] mx-auto flex flex-col lg:flex-row gap-8')}>

                {/* Main Content (Left) */}
                <div className={t('flex-1 min-w-0 flex flex-col gap-4', 'flex-1 min-w-0')}>

                    {/* Header */}
                    {!embedded && (
                    <div className="flex flex-wrap items-center gap-3">
                        <Package size={30} className="text-brand-cyan shrink-0" />
                        <div className="min-w-[220px] flex-1">
                            <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Realizar pedido WMS</h1>
                            <p className="text-sm text-zinc-500 mt-1">Catálogo de venta sincronizado con el WMS</p>
                        </div>
                    </div>
                    )}

                    {/* Barra de herramientas: interruptores, buscador y Sincronizar (en el celular se acomodan en dos renglones) */}
                    <div className={t(`${CARD} p-3 flex flex-wrap items-center gap-2`, 'rounded-3xl shadow-sm p-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-zinc-900/60 border border-zinc-700/50')}>
                        <div className={t('contents', 'flex items-center gap-4')}>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={hideOutOfStock}
                                onClick={() => setHideOutOfStock(v => !v)}
                                title={hideOutOfStock ? 'Mostrando solo productos con stock' : 'Mostrando todos los productos'}
                                className={t(`${INTERRUPTOR} ${hideOutOfStock ? INTERRUPTOR_SI : INTERRUPTOR_NO}`, 'flex items-center gap-2.5 px-4 py-3 rounded-2xl font-bold text-sm transition-all bg-zinc-800 hover:bg-zinc-700 text-zinc-300')}
                            >
                                <span className={t(`${PISTA} ${hideOutOfStock ? 'bg-brand-cyan' : 'bg-zinc-300'}`, `relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${hideOutOfStock ? 'bg-blue-600' : 'bg-slate-300'}`)}>
                                    <span className={t(`${PERILLA} ${hideOutOfStock ? 'translate-x-[18px]' : 'translate-x-0.5'}`, `inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${hideOutOfStock ? 'translate-x-6' : 'translate-x-1'}`)} />
                                </span>
                                Ocultar sin stock
                            </button>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={showImages}
                                onClick={() => setShowImages(v => !v)}
                                title={showImages ? 'Mostrando fotos en las cards' : 'Fotos ocultas en las cards'}
                                className={t(`${INTERRUPTOR} ${showImages ? INTERRUPTOR_SI : INTERRUPTOR_NO}`, 'flex items-center gap-2.5 px-4 py-3 rounded-2xl font-bold text-sm transition-all bg-zinc-800 hover:bg-zinc-700 text-zinc-300')}
                            >
                                <span className={t(`${PISTA} ${showImages ? 'bg-brand-cyan' : 'bg-zinc-300'}`, `relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${showImages ? 'bg-blue-600' : 'bg-slate-300'}`)}>
                                    <span className={t(`${PERILLA} ${showImages ? 'translate-x-[18px]' : 'translate-x-0.5'}`, `inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${showImages ? 'translate-x-6' : 'translate-x-1'}`)} />
                                </span>
                                Mostrar fotos
                            </button>
                            <div className={t('relative flex-1 min-w-[180px] sm:min-w-[220px]', 'relative')}>
                                <Search className={`absolute top-1/2 -translate-y-1/2 pointer-events-none ${t('left-3 text-zinc-400', 'left-4 text-zinc-500')}`} size={t(15, 18)} />
                                <input
                                    type="text"
                                    placeholder="Buscar producto..."
                                    aria-label="Buscar producto"
                                    className={t(CAMPO, 'pl-11 pr-4 py-3 border rounded-2xl w-full md:w-72 focus:ring-4 transition-all font-medium bg-zinc-800 border-zinc-700 focus:border-cyan-500 focus:ring-cyan-500/10 text-zinc-200 placeholder-zinc-500')}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleSync}
                                disabled={syncing}
                                className={t(`${BTN_SECUNDARIO} shrink-0`, 'flex items-center gap-2 border px-5 py-3 rounded-2xl font-bold transition-all shadow-sm bg-zinc-800 border-zinc-700 hover:border-zinc-600 hover:bg-zinc-700 text-zinc-300')}
                            >
                                <RefreshCw size={t(15, 18)} className={t(`text-brand-cyan ${syncing ? 'animate-spin' : ''}`, syncing ? 'animate-spin text-blue-600' : 'text-slate-400')} />
                                {syncing ? 'Sincronizando' : 'Sincronizar'}
                            </button>
                        </div>
                    </div>

                    {/* Catalog Grid */}
                    {loading ? (
                        embedded ? (
                            <div className="flex justify-center items-center h-64">
                                <RefreshCw size={40} className="animate-spin text-blue-500" />
                            </div>
                        ) : (
                            <div className={`${CARD} flex flex-col items-center justify-center gap-3 py-20`}>
                                <Loader2 size={32} className="animate-spin text-brand-cyan" />
                                <span className="text-sm text-zinc-400">Cargando catálogo…</span>
                            </div>
                        )
                    ) : !embedded && filteredCatalog.length === 0 ? (
                        <div className={`${CARD} flex flex-col items-center justify-center text-center px-4 py-16`}>
                            <PackageSearch size={40} className="mb-3 text-brand-cyan" />
                            <span className="text-sm font-bold text-zinc-700">
                                {catalog.length === 0 ? 'El catálogo está vacío' : searchTerm ? 'Ningún producto coincide con la búsqueda' : 'No hay productos con stock'}
                            </span>
                            <span className="text-xs text-zinc-400 mt-1">
                                {catalog.length === 0 ? 'Tocá «Sincronizar» para traerlo del WMS.' : hideOutOfStock ? 'Apagá «Ocultar sin stock» para ver también los que no tienen.' : 'Probá con otro nombre.'}
                            </span>
                        </div>
                    ) : (
                        <div className={t('grid grid-cols-2 md:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3', 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6')}>
                            {filteredCatalog.map(product => (
                                <div key={product.ProIdProducto}
                                     onClick={() => openVariantModal(product)}
                                     className={t(`${CARD} overflow-hidden cursor-pointer flex flex-col h-full group relative transition-all hover:border-brand-cyan/40 hover:shadow-md`, 'rounded-[1.5rem] border overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col h-full group relative bg-zinc-900/60 border-zinc-700/50 hover:border-cyan-500/50')}
                                >
                                    {/* Image Placeholder */}
                                    {showImages && (
                                        <div className={t('h-28 sm:h-32 flex flex-col justify-center items-center relative overflow-hidden p-3 bg-zinc-50 border-b border-zinc-100', 'h-32 flex flex-col justify-center items-center relative overflow-hidden p-4 bg-zinc-800/60')}>
                                            {product.imagen ? (
                                                <img src={product.imagen} alt={product.Descripcion} className="w-full h-full object-contain mix-blend-multiply group-hover:scale-105 transition-transform duration-500" />
                                            ) : (
                                                <Package size={embedded ? 48 : 40} strokeWidth={1} className={`group-hover:scale-110 transition-transform duration-500 ${t('text-zinc-300', 'text-zinc-600')}`} />
                                            )}
                                        </div>
                                    )}

                                    <div className={t('p-3 sm:p-4 flex-1 flex flex-col gap-3', 'p-4 flex-1 flex flex-col bg-zinc-900/60')}>
                                        <h3 className={t('text-sm font-bold text-zinc-800 leading-snug line-clamp-2 transition-colors group-hover:text-brand-cyan', 'font-bold text-base mb-2 leading-tight transition-colors line-clamp-2 text-zinc-100 group-hover:text-cyan-400')}>{product.Descripcion}</h3>

                                        <div className={t('mt-auto flex flex-wrap justify-between items-end gap-x-3 gap-y-1 pt-3 border-t border-zinc-100', 'mt-auto flex justify-between items-center pt-3 border-t border-zinc-700/50')}>
                                            <div className="flex flex-col">
                                                <span className={t('text-[10px] font-black uppercase tracking-widest mb-0.5 text-zinc-400', 'text-xs font-bold uppercase tracking-wider mb-0.5 text-zinc-500')}>Precio</span>
                                                <span className={t('font-black text-sm sm:text-base text-zinc-900 tabular-nums whitespace-nowrap', 'font-black text-lg text-zinc-100')}>
                                                    {simbolo(product.moneda)} {fmt(product.precio)}
                                                </span>
                                            </div>

                                            <div className="flex flex-col text-right">
                                                {product.total_stock < 9999 && (
                                                    <>
                                                        <span className={t('text-[10px] font-black uppercase tracking-widest mb-0.5 text-zinc-400', 'text-xs font-bold uppercase tracking-wider mb-0.5 text-zinc-500')}>Stock</span>
                                                        <span className={t(`font-black text-sm sm:text-base tabular-nums ${Number(product.total_stock) === 0 ? 'text-brand-magenta' : 'text-zinc-700'}`, 'font-black text-lg text-zinc-300')}>
                                                            {product.total_stock}
                                                        </span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Celular: el carrito queda abajo del catálogo. Esta barra queda pegada abajo de la pantalla
                    mientras se recorre el catálogo, lleva hasta el carrito y, al llegar, se queda en su lugar
                    (arriba del carrito) sin taparle los botones. */}
                {!embedded && cart.length > 0 && (
                    <div className="lg:hidden sticky bottom-4 z-40">
                        <button
                            type="button"
                            onClick={() => document.getElementById('carrito-wms')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-brand-cyan text-white shadow-xl"
                        >
                            <span className="flex items-center gap-2 text-sm font-bold min-w-0">
                                <ShoppingCart size={18} className="shrink-0" />
                                <span className="truncate">Ver carrito · {cart.length} {cart.length === 1 ? 'ítem' : 'ítems'}</span>
                            </span>
                            <span className="text-sm font-black tabular-nums whitespace-nowrap">{simbolo(orderCurrency)} {fmt(totalCart)}</span>
                        </button>
                    </div>
                )}

                {/* Cart Sidebar (Right) — "chico" en modo embebido: más angosto, sin el
                    h-[100vh] que asume página completa, todo más compacto. Standalone: tarjeta
                    clara, pegada arriba en escritorio; en el celular queda abajo del catálogo. */}
                <div id="carrito-wms" className={`w-full shrink-0 scroll-mt-4 ${t('lg:w-[380px]', 'lg:w-[300px]')}`}>
                    <div className={t(`${CARD} flex flex-col lg:sticky lg:top-4 lg:max-h-[calc(100vh-7.5rem)]`, 'bg-slate-800 shadow-2xl overflow-hidden sticky flex flex-col relative rounded-2xl top-4 max-h-[75vh]')}>

                        {/* Header Cart */}
                        <div className={t('p-4 sm:p-5 border-b border-zinc-100 flex flex-col gap-4', 'p-4 pb-3')}>
                            <div className={t('flex justify-between items-center', 'flex justify-between items-center mb-3')}>
                                <div className="flex items-center gap-2">
                                    <ShoppingCart size={embedded ? 18 : 20} className={t('text-brand-cyan', 'text-blue-400')} />
                                    <h2 className={t('text-lg font-black text-zinc-900', 'font-extrabold text-white text-sm')}>Carrito</h2>
                                </div>
                                <span className={t(`text-[11px] font-bold px-2.5 py-1 rounded-full border tabular-nums ${cart.length > 0 ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20' : 'bg-zinc-50 text-zinc-500 border-zinc-200'}`, 'bg-white/10 text-white font-bold rounded-full text-[10px] px-2 py-1')}>
                                    {cart.length} ítems
                                </span>
                            </div>

                            {/* Client Search / Card */}
                            <div>
                                {embedded && selectedClient ? null : !selectedClient && embedded ? (
                                    // [PRENDAS] Embebido: el cliente lo elige el vendedor arriba, en
                                    // "Datos Generales del Pedido" — acá nunca se busca ni se cambia.
                                    <div className="bg-slate-700/30 border border-dashed border-slate-600 rounded-2xl p-4 text-center">
                                        <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">
                                            Elegí el cliente arriba, en "Datos Generales del Pedido"
                                        </p>
                                    </div>
                                ) : !selectedClient ? (
                                    <div className="relative">
                                        <label className={ETIQUETA}>Cliente</label>
                                        <div className="relative">
                                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" size={15} />
                                            <input
                                                type="text"
                                                className="w-full pl-9 pr-9 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
                                                placeholder="Buscar cliente (RUC, CI, Nombre)..."
                                                value={clientSearchTerm}
                                                onChange={handleClientSearch}
                                            />
                                            {isSearchingClient && (
                                                <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-cyan animate-spin" size={15} />
                                            )}
                                        </div>

                                        {/* Dropdown Results */}
                                        {searchResults.length > 0 && clientSearchTerm.length >= 3 && (
                                            <div className="absolute z-50 mt-1 w-full bg-white rounded-xl shadow-lg border border-zinc-200 overflow-hidden max-h-60 overflow-y-auto custom-scrollbar">
                                                {searchResults.map(client => (
                                                    <div
                                                        key={client.CodCliente || client.ClienteID || client.id}
                                                        className="px-3 py-2.5 hover:bg-zinc-50 cursor-pointer border-b border-zinc-100 last:border-0 transition-colors"
                                                        onClick={() => {
                                                            setSelectedClient(client);
                                                            setSearchResults([]);
                                                            setClientSearchTerm('');
                                                        }}
                                                    >
                                                        <p className="font-bold text-zinc-800 text-sm">{client.Nombre || client.RazonSocial || client.nombre}</p>
                                                        <p className="text-xs text-zinc-400 mt-0.5 tabular-nums">ID: {client.CodCliente || client.ClienteID || client.id} · Doc.: {client.CioRuc || client.RUT || client.RUC || client.CI || 'N/A'}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="bg-zinc-50 rounded-xl border border-zinc-200 p-3.5 relative">
                                        {!initialClient && (
                                        <button
                                            type="button"
                                            onClick={() => setSelectedClient(null)}
                                            className="absolute top-2.5 right-2.5 w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 transition-colors"
                                            title="Cambiar cliente"
                                            aria-label="Cambiar cliente"
                                        >
                                            <X size={16} />
                                        </button>
                                        )}
                                        <div className="flex items-start gap-2.5 pr-9">
                                            <User size={20} className="text-brand-cyan shrink-0 mt-0.5" />
                                            <div className="min-w-0">
                                                <h3 className="font-bold text-sm text-zinc-900 leading-tight">{selectedClient.Nombre || selectedClient.RazonSocial || selectedClient.nombre}</h3>
                                                <p className="text-[11px] text-zinc-400 font-mono mt-1 tracking-wide uppercase">IDCLIENTE: {selectedClient.CodCliente || selectedClient.ClienteID || selectedClient.id}</p>
                                            </div>
                                        </div>
                                        <div className="mt-3 pt-3 border-t border-zinc-200 space-y-1.5 text-xs">
                                            <p className="flex justify-between gap-3"><span className="text-zinc-400 shrink-0">RUC / CI</span> <span className="font-semibold text-zinc-800 text-right truncate">{selectedClient.CioRuc || selectedClient.RUT || selectedClient.RUC || selectedClient.CI || 'N/A'}</span></p>
                                            <p className="flex justify-between gap-3"><span className="text-zinc-400 shrink-0">Email</span> <span className="font-semibold text-zinc-800 text-right truncate">{selectedClient.Email || selectedClient.Correo || 'N/A'}</span></p>
                                            <p className="flex justify-between gap-3"><span className="text-zinc-400 shrink-0">Teléfono</span> <span className="font-semibold text-zinc-800 text-right truncate">{selectedClient.TelefonoTrabajo || selectedClient.Telefono || selectedClient.Celular || 'N/A'}</span></p>
                                            <p className="flex justify-between gap-3"><span className="text-zinc-400 shrink-0">Dirección</span> <span className="font-semibold text-zinc-800 text-right truncate" title={selectedClient.DireccionTrabajo || selectedClient.CliDireccion || selectedClient.Direccion || 'N/A'}>{selectedClient.DireccionTrabajo || selectedClient.CliDireccion || selectedClient.Direccion || 'N/A'}</span></p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Cart Items */}
                        <div className={t('flex-1 min-h-0 lg:overflow-y-auto custom-scrollbar p-4 space-y-2', 'flex-1 overflow-y-auto custom-scrollbar px-3 pb-3 space-y-2')}>
                            {cart.length === 0 ? (
                                embedded ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 opacity-50 pt-4">
                                        <ShoppingCart size={32} strokeWidth={1} className="mb-2" />
                                        <p className="text-xs font-medium">No hay productos seleccionados</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center text-center py-8">
                                        <ShoppingCart size={40} strokeWidth={1.5} className="mb-3 text-brand-cyan" />
                                        <p className="text-sm font-bold text-zinc-700">No hay productos seleccionados</p>
                                        <p className="text-xs text-zinc-400 mt-1">Tocá un producto del catálogo para agregarlo.</p>
                                    </div>
                                )
                            ) : (
                                cart.map(item => (
                                    <div key={item.wms_variante_id} className={t('rounded-xl border border-zinc-200 bg-white p-3 relative group', 'bg-slate-700/30 rounded-xl flex gap-2 relative group p-2.5')}>
                                        <div className="flex-1 min-w-0">
                                            <h4 className={t('text-sm font-bold text-zinc-800 leading-snug pr-7', 'font-bold text-white leading-tight pr-5 text-xs mb-1.5 line-clamp-2')}>{item.nombre}</h4>
                                            <div className={t('flex flex-wrap justify-between items-end gap-2 mt-2.5', 'flex justify-between items-end mt-1.5')}>
                                                <div className={t('inline-flex items-center rounded-lg border border-zinc-200 bg-white overflow-hidden', 'flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-600')}>
                                                    <button type="button" onClick={() => updateQuantity(item.wms_variante_id, -1)} aria-label="Restar uno" className={t(PASO, 'hover:bg-slate-700 rounded-md transition-colors text-white p-1')}>
                                                        <Minus size={embedded ? 10 : 14} />
                                                    </button>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        value={item.cantidad}
                                                        onChange={e => {
                                                            const v = parseInt(e.target.value) || 1;
                                                            setCart(prev => prev.map(ci =>
                                                                ci.wms_variante_id === item.wms_variante_id
                                                                    ? { ...ci, cantidad: Math.min(Math.max(1, v), ci.stock) }
                                                                    : ci
                                                            ));
                                                        }}
                                                        aria-label="Cantidad"
                                                        className={t('w-11 h-8 text-center text-sm font-bold text-zinc-800 tabular-nums bg-transparent border-x border-zinc-200 outline-none', 'text-center font-bold text-white bg-transparent border-none outline-none w-8 text-[11px]')}
                                                    />
                                                    <button type="button" onClick={() => updateQuantity(item.wms_variante_id, 1)} aria-label="Sumar uno" className={t(PASO, 'hover:bg-slate-700 rounded-md transition-colors text-white p-1')}>
                                                        <Plus size={embedded ? 10 : 14} />
                                                    </button>
                                                </div>
                                                <div className="flex flex-col items-end gap-1">
                                                    <p className={t('font-black text-sm text-zinc-900 tabular-nums whitespace-nowrap', 'font-bold text-white text-xs')}>{simbolo(item.moneda)} {fmt(item.precio * item.cantidad)}</p>
                                                    {!embedded && (
                                                    <label className="flex items-center gap-1.5">
                                                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest whitespace-nowrap">Precio {simbolo(item.moneda)}</span>
                                                        <input
                                                            type="number"
                                                            min="0"
                                                            step="0.01"
                                                            value={item.precio}
                                                            onChange={(e) => updatePrice(item.wms_variante_id, parseFloat(e.target.value) || 0)}
                                                            className="w-20 px-2 py-1 bg-white border border-zinc-200 rounded-lg text-xs font-bold text-zinc-800 text-right tabular-nums focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 transition-colors"
                                                        />
                                                    </label>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeItem(item.wms_variante_id)}
                                            aria-label="Quitar del carrito"
                                            title="Quitar del carrito"
                                            className={`absolute transition-colors ${t('top-2 right-2 w-7 h-7 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5', 'text-slate-400 hover:text-red-400 top-2 right-2 p-0.5')}`}
                                        >
                                            <Trash2 size={embedded ? 13 : 15} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* [PRENDAS] Resumen de personalización — sin precio, no es parte de
                            esta venta: son las Órdenes de producción que se van a crear aparte. */}
                        {embedded && personalizacionResumen.length > 0 && (
                            <div className="px-3 pb-2">
                                <div className="bg-slate-900/60 border border-slate-700 rounded-xl p-2.5">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5">Personalización agregada</p>
                                    <div className="space-y-1">
                                        {personalizacionResumen.map((s, idx) => (
                                            <div key={idx} className="flex justify-between text-[11px]">
                                                <span className="text-slate-300 font-medium">{s.label}</span>
                                                <span className="text-slate-400">{s.cantidad || 0} prendas</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Footer / Total */}
                        <div className={t('border-t border-zinc-200 bg-zinc-50 rounded-b-2xl p-4 sm:p-5', 'bg-slate-900 z-10 border-t border-slate-700/50 p-3 pt-3')}>
                            {!embedded && (
                            <div className="flex justify-between items-center gap-3 mb-3">
                                <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-400"><ArrowLeftRight size={13} className="text-brand-cyan" /> Tipo de cambio</span>
                                <span className="text-xs font-bold text-zinc-800 tabular-nums">$ {fmt(exchangeRate)}</span>
                            </div>
                            )}
                            <div className={t('space-y-2 mb-4', 'space-y-1.5 mb-3')}>
                                {!embedded && (
                                <div className="flex justify-between text-sm text-zinc-500">
                                    <span>Subtotal</span>
                                    <span className="font-semibold text-zinc-700 tabular-nums">{simbolo(orderCurrency)} {fmt(totalCart)}</span>
                                </div>
                                )}
                                <div className={`flex justify-between items-end gap-3 ${t('pt-2 border-t border-zinc-200', '')}`}>
                                    <span className={t('text-sm font-black uppercase tracking-wide text-zinc-500', 'text-slate-300 font-bold text-xs')}>Total</span>
                                    <div className="text-right">
                                        <span className={t('text-2xl font-black text-zinc-900 tracking-tight tabular-nums', 'font-black text-white tracking-tight text-lg')}>{simbolo(orderCurrency)} {fmt(totalCart)}</span>
                                    </div>
                                </div>
                                {/* [PRENDAS] La personalización (Bordado/DTF/TPU/Estampado) se cotiza
                                    aparte — este total es solo de lo comprado acá. */}
                                {embedded && personalizacionResumen.length > 0 && (
                                    <p className="text-[10px] text-slate-500 italic">No incluye el costo de la personalización</p>
                                )}
                            </div>
                            {showOwnCheckout && (
                            <div className={t('grid grid-cols-3 gap-2', 'flex gap-2')}>
                                {!embedded && (
                                <button
                                    type="button"
                                    onClick={handleCotizar}
                                    disabled={cart.length === 0}
                                    title="Imprime un ticket de cotización (no registra nada)"
                                    className={`${BTN_SECUNDARIO} h-11`}
                                >
                                    <Printer size={15} className="text-brand-cyan" />
                                    Cotizar
                                </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleCheckout}
                                    disabled={cart.length === 0 || !selectedClient || confirmando}
                                    title={!selectedClient ? 'Debes seleccionar un cliente antes de confirmar' : ''}
                                    className={t(`${BTN_PRINCIPAL} col-span-2 h-11`, `rounded-2xl font-bold text-white transition-all duration-300 flex items-center justify-center gap-2 w-full py-2.5 text-sm ${
                                        cart.length > 0 && selectedClient && !confirmando
                                        ? 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 hover:-translate-y-1'
                                        : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                                    }`)}
                                >
                                    {!selectedClient && cart.length > 0
                                        ? <><UserX size={15} /> Sin cliente</>
                                        : confirmando ? <><Loader2 size={15} className="animate-spin" /> Registrando pedido…</> : <><CheckCircle size={15} /> Confirmar</>
                                    }
                                </button>
                            </div>
                            )}
                            {!showOwnCheckout && (
                                <p className={t('text-[11px] text-zinc-400 text-center', 'text-[11px] text-slate-500 text-center')}>
                                    Se confirma con el botón "Confirmar Pedido" de abajo.
                                </p>
                            )}
                        </div>

                    </div>
                </div>

            </div>
        </div>
    );
});

WmsOrderPage.displayName = 'WmsOrderPage';

export default WmsOrderPage;
