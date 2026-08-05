import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { toast } from 'sonner';
import { Search, ShoppingCart, Package, Plus, Minus, Trash2, CheckCircle, RefreshCw, X, User } from 'lucide-react';
import { wmsService } from '../../../services/api';
import { clientsService } from '../../../services/api';

// [PRENDAS] embedded/initialClient son ADITIVOS: sin props (uso normal en
// /atencion-cliente/pedidos-wms) el comportamiento es idéntico al de siempre.
// Se usan para incrustar este mismo carrito dentro de /ventas/pedido-prenda
// cuando el vendedor elige "Comprar prendas", con el cliente ya elegido arriba.
const WmsOrderPage = forwardRef(({ embedded = false, initialClient = null, onCartChange = null, personalizacionResumen = [], showOwnCheckout = true } = {}, ref) => {
    const [catalog, setCatalog] = useState([]);
    const [loading, setLoading] = useState(false);
    const [syncing, setSyncing] = useState(false);
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
        <div className={embedded ? "relative" : "p-6 bg-slate-50 min-h-screen relative"}>

            {/* Modal Variantes */}
            {variantModalItem && (
                <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col">
                        
                        {/* Modal Header */}
                        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-slate-50">
                            <div>
                                <h3 className="font-bold text-slate-800 text-lg">Opciones: {variantModalItem.Descripcion}</h3>
                                <p className="text-xs text-slate-500 font-medium">Selecciona la variante que deseas añadir</p>
                            </div>
                            <button type="button" onClick={() => setVariantModalItem(null)} className="p-2 bg-white rounded-full text-slate-400 hover:text-slate-700 shadow-sm border border-slate-200 transition-colors">
                                <X size={18} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-6 overflow-y-auto max-h-[60vh] custom-scrollbar">
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
                                    <div className="space-y-6">
                                        {/* Talles */}
                                        <div>
                                            <div className="flex justify-between items-end mb-3">
                                                <label className="text-sm font-bold text-slate-700">Talle</label>
                                                {selectedSize && <span className="text-xs font-bold text-blue-600">{selectedSize}</span>}
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
                                                        className={`min-w-[3rem] px-3 py-2 rounded-xl font-bold text-sm transition-all border-2 ${
                                                            selectedSize === sz 
                                                            ? 'bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-500/30'
                                                            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300'
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
                                                <div className="flex justify-between items-end mb-3">
                                                    <label className="text-sm font-bold text-slate-700">Color</label>
                                                    {selectedColor && <span className="text-xs font-bold text-blue-600">{selectedColor}</span>}
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
                                                            className={`relative px-4 py-3 rounded-xl border-2 text-left flex flex-col transition-all active:scale-95 flex-1 ${
                                                                selectedColor === v.color
                                                                ? 'bg-blue-50 border-blue-500 shadow-md shadow-blue-500/20'
                                                                : v.stock > 0 
                                                                    ? 'bg-white border-slate-200 hover:border-slate-300' 
                                                                    : 'bg-slate-50 border-slate-100 opacity-50 cursor-not-allowed'
                                                            }`}
                                                        >
                                                            <div className="flex items-center justify-between mb-1">
                                                                <div className="flex items-center gap-2">
                                                                    {hexColor !== 'transparent' && (
                                                                        <div 
                                                                            className="w-4 h-4 rounded-full border border-slate-200 shadow-sm shrink-0" 
                                                                            style={{ backgroundColor: hexColor }}
                                                                        ></div>
                                                                    )}
                                                                    <span className={`font-bold text-sm line-clamp-1 ${selectedColor === v.color ? 'text-blue-700' : 'text-slate-700'}`}>
                                                                        {v.color}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            {v.stock < 9999 && (
                                                                <span className={`text-[11px] font-bold ${v.stock > 10 ? 'text-emerald-500' : v.stock > 0 ? 'text-amber-500' : 'text-red-500'}`}>
                                                                    Stock: {v.stock}
                                                                </span>
                                                            )}
                                                            <span className="text-[11px] font-black text-blue-700 mt-0.5">
                                                                {v.precio_excepcion != null
                                                                    ? `${v.moneda_excepcion === 'USD' ? 'U$S' : '$'} ${Number(v.precio_excepcion).toFixed(2)}`
                                                                    : `${variantModalItem.moneda === 'USD' ? 'U$S' : '$'} ${Number(variantModalItem.precio || 0).toFixed(2)}`
                                                                }
                                                                {v.precio_excepcion != null && (
                                                                    <span className="text-[9px] text-slate-400 ml-1 font-normal">(precio propio)</span>
                                                                )}
                                                            </span>
                                                            {selectedColor === v.color && (
                                                                <div className="absolute top-2 right-2 w-4 h-4 bg-blue-500 rounded-full flex items-center justify-center">
                                                                    <CheckCircle size={10} className="text-white" />
                                                                </div>
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
                        <div className="p-6 border-t border-slate-100 bg-white">
                            <div className="flex items-center gap-4">
                                <div className="flex items-center bg-slate-100 rounded-xl border border-slate-200 h-12">
                                    <button
                                        type="button"
                                        onClick={() => setVariantQty(Math.max(1, variantQty - 1))}
                                        className="px-4 h-full hover:bg-slate-200 rounded-l-xl transition-colors text-slate-600 font-bold"
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
                                        className="w-16 text-center text-sm font-bold text-slate-800 bg-transparent border-none outline-none"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const variant = variantModalItem.variantes.find(v => v.wms_variante_id === selectedVariantId);
                                            if (variant && variantQty < variant.stock) setVariantQty(variantQty + 1);
                                        }}
                                        className="px-4 h-full hover:bg-slate-200 rounded-r-xl transition-colors text-slate-600 font-bold"
                                        disabled={!selectedVariantId}
                                    >
                                        <Plus size={16} />
                                    </button>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleAddToCart}
                                    disabled={!selectedVariantId}
                                    className={`flex-1 h-12 rounded-xl font-bold text-white shadow-lg transition-all flex items-center justify-center gap-2 ${
                                        selectedVariantId 
                                        ? 'bg-blue-600 hover:bg-blue-700 hover:shadow-blue-600/30' 
                                        : 'bg-slate-300 cursor-not-allowed shadow-none'
                                    }`}
                                >
                                    Añadir al Carrito
                                </button>
                            </div>
                        </div>

                    </div>
                </div>
            )}

            {/* Success Modal */}
            {orderState.successCode && (
                <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-2xl transform transition-all text-center">
                        <div className="mx-auto flex items-center justify-center h-20 w-20 rounded-full bg-emerald-100 mb-6">
                            <CheckCircle className="h-10 w-10 text-emerald-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-800 mb-2">¡Pedido Exitoso!</h2>
                        <p className="text-slate-500 mb-6">El pedido ha sido enviado a Logística para su preparación.</p>
                        <div className="bg-slate-100 rounded-xl py-4 mb-8 border border-slate-200">
                            <p className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-1">CÓDIGO DE PEDIDO</p>
                            <p className="text-3xl font-mono font-black text-blue-600">{orderState.successCode}</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setOrderState(prev => ({ ...prev, successCode: null }))}
                            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-4 rounded-xl shadow-lg shadow-blue-500/30 transition-all"
                        >
                            Crear Nuevo Pedido
                        </button>
                    </div>
                </div>
            )}

            <div className="max-w-[1400px] mx-auto flex flex-col lg:flex-row gap-8">
                
                {/* Main Content (Left) */}
                <div className="flex-1 min-w-0">
                    
                    {/* Header */}
                    <div className={`rounded-3xl shadow-sm p-6 mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4 ${t('bg-white border border-slate-200', 'bg-zinc-900/60 border border-zinc-700/50')}`}>
                        {!embedded && (
                        <div className="flex items-center gap-4">
                            <div className="bg-gradient-to-tr from-blue-600 to-cyan-400 p-4 rounded-2xl text-white shadow-lg shadow-blue-200">
                                <Package size={28} strokeWidth={2.5} />
                            </div>
                            <div>
                                <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">Realizar Pedido WMS</h1>
                                <p className="text-slate-500 font-medium mt-1">Catálogo de Venta Sincronizado</p>
                            </div>
                        </div>
                        )}

                        <div className="flex items-center gap-4">
                            <button
                                type="button"
                                onClick={() => setHideOutOfStock(v => !v)}
                                title={hideOutOfStock ? 'Mostrando solo productos con stock' : 'Mostrando todos los productos'}
                                className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl font-bold text-sm transition-all ${t('bg-slate-100 hover:bg-slate-200 text-slate-700', 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300')}`}
                            >
                                <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${hideOutOfStock ? 'bg-blue-600' : 'bg-slate-300'}`}>
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${hideOutOfStock ? 'translate-x-6' : 'translate-x-1'}`} />
                                </span>
                                Ocultar sin stock
                            </button>
                            <button
                                type="button"
                                onClick={() => setShowImages(v => !v)}
                                title={showImages ? 'Mostrando fotos en las cards' : 'Fotos ocultas en las cards'}
                                className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl font-bold text-sm transition-all ${t('bg-slate-100 hover:bg-slate-200 text-slate-700', 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300')}`}
                            >
                                <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${showImages ? 'bg-blue-600' : 'bg-slate-300'}`}>
                                    <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${showImages ? 'translate-x-6' : 'translate-x-1'}`} />
                                </span>
                                Mostrar fotos
                            </button>
                            <div className="relative">
                                <Search className={`absolute left-4 top-1/2 -translate-y-1/2 ${t('text-slate-400', 'text-zinc-500')}`} size={18} />
                                <input
                                    type="text"
                                    placeholder="Buscar producto..."
                                    className={`pl-11 pr-4 py-3 border rounded-2xl w-full md:w-72 focus:ring-4 transition-all font-medium ${t('bg-slate-100 border-transparent focus:border-blue-500 focus:bg-white focus:ring-blue-500/10 text-slate-700', 'bg-zinc-800 border-zinc-700 focus:border-cyan-500 focus:ring-cyan-500/10 text-zinc-200 placeholder-zinc-500')}`}
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <button
                                type="button"
                                onClick={handleSync}
                                disabled={syncing}
                                className={`flex items-center gap-2 border px-5 py-3 rounded-2xl font-bold transition-all shadow-sm ${t('bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-slate-700', 'bg-zinc-800 border-zinc-700 hover:border-zinc-600 hover:bg-zinc-700 text-zinc-300')}`}
                            >
                                <RefreshCw size={18} className={syncing ? 'animate-spin text-blue-600' : 'text-slate-400'} />
                                {syncing ? 'Sincronizando' : 'Sincronizar'}
                            </button>
                        </div>
                    </div>

                    {/* Catalog Grid */}
                    {loading ? (
                        <div className="flex justify-center items-center h-64">
                            <RefreshCw size={40} className="animate-spin text-blue-500" />
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                            {filteredCatalog.map(product => (
                                <div key={product.ProIdProducto}
                                     onClick={() => openVariantModal(product)}
                                     className={`rounded-[1.5rem] border overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col h-full group relative ${t('bg-white border-slate-200 hover:border-blue-200', 'bg-zinc-900/60 border-zinc-700/50 hover:border-cyan-500/50')}`}
                                >
                                    {/* Image Placeholder */}
                                    {showImages && (
                                        <div className={`h-32 flex flex-col justify-center items-center relative overflow-hidden p-4 ${t('bg-slate-50', 'bg-zinc-800/60')}`}>
                                            {product.imagen ? (
                                                <img src={product.imagen} alt={product.Descripcion} className="w-full h-full object-contain mix-blend-multiply group-hover:scale-105 transition-transform duration-500" />
                                            ) : (
                                                <Package size={48} strokeWidth={1} className={`group-hover:scale-110 transition-transform duration-500 ${t('text-slate-300', 'text-zinc-600')}`} />
                                            )}
                                        </div>
                                    )}

                                    <div className={`p-4 flex-1 flex flex-col ${t('bg-white', 'bg-zinc-900/60')}`}>
                                        <h3 className={`font-bold text-base mb-2 leading-tight transition-colors line-clamp-2 ${t('text-slate-800 group-hover:text-blue-600', 'text-zinc-100 group-hover:text-cyan-400')}`}>{product.Descripcion}</h3>

                                        <div className={`mt-auto flex justify-between items-center pt-3 border-t ${t('border-slate-100', 'border-zinc-700/50')}`}>
                                            <div className="flex flex-col">
                                                <span className={`text-xs font-bold uppercase tracking-wider mb-0.5 ${t('text-slate-400', 'text-zinc-500')}`}>Precio</span>
                                                <span className={`font-black text-lg ${t('text-slate-800', 'text-zinc-100')}`}>
                                                    {product.moneda === 'USD' ? 'U$S' : '$'} {Number(product.precio || 0).toFixed(2)}
                                                </span>
                                            </div>

                                            <div className="flex flex-col text-right">
                                                {product.total_stock < 9999 && (
                                                    <>
                                                        <span className={`text-xs font-bold uppercase tracking-wider mb-0.5 ${t('text-slate-400', 'text-zinc-500')}`}>Stock</span>
                                                        <span className={`font-black text-lg ${t('text-slate-700', 'text-zinc-300')}`}>
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

                {/* Cart Sidebar (Right) — "chico" en modo embebido: más angosto, sin el
                    h-[100vh] que asume página completa, todo más compacto. */}
                <div className={`w-full shrink-0 ${t('lg:w-[400px]', 'lg:w-[300px]')}`}>
                    <div className={`bg-slate-800 shadow-2xl overflow-hidden sticky flex flex-col relative ${t('rounded-[2.5rem] top-6 h-[calc(100vh-3rem)]', 'rounded-2xl top-4 max-h-[75vh]')}`}>

                        {/* Header Cart */}
                        <div className={t('p-8 pb-6', 'p-4 pb-3')}>
                            <div className={`flex justify-between items-center ${t('mb-8', 'mb-3')}`}>
                                <div className="flex items-center gap-2">
                                    <ShoppingCart size={embedded ? 18 : 24} className="text-blue-400" />
                                    <h2 className={`font-extrabold text-white ${t('text-xl', 'text-sm')}`}>Carrito</h2>
                                </div>
                                <span className={`bg-white/10 text-white font-bold rounded-full ${t('text-xs px-3 py-1.5', 'text-[10px] px-2 py-1')}`}>
                                    {cart.length} items
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
                                        <label className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-2 block">Cliente</label>
                                        <div className="relative">
                                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                            <input 
                                                type="text" 
                                                className="w-full bg-slate-700/50 border border-slate-600 rounded-2xl pl-11 pr-4 py-3 text-sm text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                                                placeholder="Buscar cliente (RUC, CI, Nombre)..."
                                                value={clientSearchTerm}
                                                onChange={handleClientSearch}
                                            />
                                            {isSearchingClient && (
                                                <RefreshCw className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 animate-spin" size={16} />
                                            )}
                                        </div>
                                        
                                        {/* Dropdown Results */}
                                        {searchResults.length > 0 && clientSearchTerm.length >= 3 && (
                                            <div className="absolute z-50 mt-2 w-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden max-h-60 overflow-y-auto custom-scrollbar">
                                                {searchResults.map(client => (
                                                    <div 
                                                        key={client.CodCliente || client.ClienteID || client.id} 
                                                        className="p-3 hover:bg-blue-50 cursor-pointer border-b border-slate-100 last:border-0 transition-colors"
                                                        onClick={() => {
                                                            setSelectedClient(client);
                                                            setSearchResults([]);
                                                            setClientSearchTerm('');
                                                        }}
                                                    >
                                                        <p className="font-bold text-slate-800 text-sm">{client.Nombre || client.RazonSocial || client.nombre}</p>
                                                        <p className="text-xs text-slate-500 mt-0.5">ID: {client.CodCliente || client.ClienteID || client.id} | DOC: {client.CioRuc || client.RUT || client.RUC || client.CI || 'N/A'}</p>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="bg-white rounded-2xl p-5 shadow-lg border border-slate-200 relative">
                                        {!initialClient && (
                                        <button
                                            type="button"
                                            onClick={() => setSelectedClient(null)}
                                            className="absolute top-4 right-4 p-2 bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-500 rounded-xl transition-colors"
                                            title="Cambiar cliente"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                        )}
                                        <div className="flex items-center gap-4 mb-4 border-b border-slate-100 pb-4">
                                            <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                                                <User size={24} />
                                            </div>
                                            <div className="pr-10">
                                                <h3 className="font-bold text-slate-800 leading-tight">{selectedClient.Nombre || selectedClient.RazonSocial || selectedClient.nombre}</h3>
                                                <p className="text-xs text-slate-500 font-mono mt-1 tracking-wide uppercase">IDCLIENTE: {selectedClient.CodCliente || selectedClient.ClienteID || selectedClient.id}</p>
                                            </div>
                                        </div>
                                        <div className="space-y-2.5 text-xs text-slate-600">
                                            <p className="flex justify-between"><span className="text-slate-400 font-medium">RUC / CI:</span> <span className="font-bold text-slate-800">{selectedClient.CioRuc || selectedClient.RUT || selectedClient.RUC || selectedClient.CI || 'N/A'}</span></p>
                                            <p className="flex justify-between"><span className="text-slate-400 font-medium">Email:</span> <span className="font-medium text-slate-800">{selectedClient.Email || selectedClient.Correo || 'N/A'}</span></p>
                                            <p className="flex justify-between"><span className="text-slate-400 font-medium">Teléfono:</span> <span className="font-medium text-slate-800">{selectedClient.TelefonoTrabajo || selectedClient.Telefono || selectedClient.Celular || 'N/A'}</span></p>
                                            <p className="flex justify-between"><span className="text-slate-400 font-medium">Dirección:</span> <span className="font-medium text-slate-800 text-right w-2/3 truncate" title={selectedClient.DireccionTrabajo || selectedClient.CliDireccion || selectedClient.Direccion || 'N/A'}>{selectedClient.DireccionTrabajo || selectedClient.CliDireccion || selectedClient.Direccion || 'N/A'}</span></p>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Cart Items */}
                        <div className={`flex-1 overflow-y-auto custom-scrollbar ${t('px-6 pb-6 space-y-3', 'px-3 pb-3 space-y-2')}`}>
                            {cart.length === 0 ? (
                                <div className={`h-full flex flex-col items-center justify-center text-slate-400 opacity-50 ${t('pt-10', 'pt-4')}`}>
                                    <ShoppingCart size={embedded ? 32 : 64} strokeWidth={1} className="mb-2" />
                                    <p className={t('font-medium', 'text-xs font-medium')}>No hay productos seleccionados</p>
                                </div>
                            ) : (
                                cart.map(item => (
                                    <div key={item.wms_variante_id} className={`bg-slate-700/30 rounded-xl flex gap-2 relative group ${t('p-4 rounded-2xl gap-4', 'p-2.5')}`}>
                                        <div className="flex-1 min-w-0">
                                            <h4 className={`font-bold text-white leading-tight pr-5 ${t('text-sm mb-1', 'text-xs mb-1.5 line-clamp-2')}`}>{item.nombre}</h4>
                                            <div className={`flex justify-between items-end ${t('mt-3', 'mt-1.5')}`}>
                                                <div className="flex items-center bg-slate-800 rounded-lg p-0.5 border border-slate-600">
                                                    <button type="button" onClick={() => updateQuantity(item.wms_variante_id, -1)} className={`hover:bg-slate-700 rounded-md transition-colors text-white ${t('p-1.5', 'p-1')}`}>
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
                                                        className={`text-center font-bold text-white bg-transparent border-none outline-none ${t('w-12 text-xs', 'w-8 text-[11px]')}`}
                                                    />
                                                    <button type="button" onClick={() => updateQuantity(item.wms_variante_id, 1)} className={`hover:bg-slate-700 rounded-md transition-colors text-white ${t('p-1.5', 'p-1')}`}>
                                                        <Plus size={embedded ? 10 : 14} />
                                                    </button>
                                                </div>
                                                <div className={`flex flex-col items-end ${t('gap-1.5', 'gap-1')}`}>
                                                    <p className={`font-bold text-white ${t('text-sm', 'text-xs')}`}>{item.moneda === 'USD' ? 'U$S' : '$'} {(item.precio * item.cantidad).toFixed(2)}</p>
                                                    {!embedded && (
                                                    <div className="flex items-center gap-1.5">
                                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-wider">PRECIO:</span>
                                                        <div className="relative w-16">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                step="0.01"
                                                                value={item.precio}
                                                                onChange={(e) => updatePrice(item.wms_variante_id, parseFloat(e.target.value) || 0)}
                                                                className="w-full bg-slate-800 border border-slate-600 rounded-md text-[10px] font-bold text-white px-2 py-0.5 focus:outline-none focus:border-blue-500 transition-colors text-center"
                                                            />
                                                        </div>
                                                    </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeItem(item.wms_variante_id)}
                                            className={`absolute text-slate-400 hover:text-red-400 transition-colors ${t('top-4 right-4 p-1', 'top-2 right-2 p-0.5')}`}
                                        >
                                            <Trash2 size={embedded ? 13 : 16} />
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
                        <div className={`bg-slate-900 z-10 border-t border-slate-700/50 ${t('p-8 pt-6', 'p-3 pt-3')}`}>
                            {!embedded && (
                            <div className="flex justify-between items-center mb-4 text-xs font-bold text-slate-400 bg-slate-800/50 px-4 py-2 rounded-xl border border-slate-700">
                                <span className="flex items-center gap-2"><RefreshCw size={12} className="text-blue-400"/> TIPO DE CAMBIO</span>
                                <span className="text-blue-400">${exchangeRate.toFixed(2)}</span>
                            </div>
                            )}
                            <div className={t('space-y-3 mb-6', 'space-y-1.5 mb-3')}>
                                {!embedded && (
                                <div className="flex justify-between text-sm text-slate-400">
                                    <span>Subtotal:</span>
                                    <span>{orderCurrency === 'USD' ? 'U$S' : '$'} {totalCart.toFixed(2)}</span>
                                </div>
                                )}
                                <div className={`flex justify-between items-end ${t('pt-3 border-t border-slate-700', '')}`}>
                                    <span className={`text-slate-300 font-bold ${t('text-lg', 'text-xs')}`}>Total:</span>
                                    <div className="text-right">
                                        <span className={`font-black text-white tracking-tight ${t('text-3xl', 'text-lg')}`}>{orderCurrency === 'USD' ? 'U$S' : '$'} {totalCart.toFixed(2)}</span>
                                    </div>
                                </div>
                                {/* [PRENDAS] La personalización (Bordado/DTF/TPU/Estampado) se cotiza
                                    aparte — este total es solo de lo comprado acá. */}
                                {embedded && personalizacionResumen.length > 0 && (
                                    <p className="text-[10px] text-slate-500 italic">No incluye el costo de la personalización</p>
                                )}
                            </div>
                            {showOwnCheckout && (
                            <div className={t('flex gap-3', 'flex gap-2')}>
                                {!embedded && (
                                <button
                                    type="button"
                                    onClick={handleCotizar}
                                    disabled={cart.length === 0}
                                    className={`w-1/3 py-4 rounded-2xl font-bold text-white text-sm transition-all duration-300 flex items-center justify-center ${
                                        cart.length > 0
                                        ? 'bg-slate-700 hover:bg-slate-600 shadow-lg border border-slate-600'
                                        : 'bg-slate-800 text-slate-600 cursor-not-allowed border border-transparent'
                                    }`}
                                >
                                    Cotizar
                                </button>
                                )}
                                <button
                                    type="button"
                                    onClick={handleCheckout}
                                    disabled={cart.length === 0 || !selectedClient}
                                    title={!selectedClient ? 'Debes seleccionar un cliente antes de confirmar' : ''}
                                    className={`rounded-2xl font-bold text-white transition-all duration-300 flex items-center justify-center gap-2 ${t('w-2/3 py-4 text-lg', 'w-full py-2.5 text-sm')} ${
                                        cart.length > 0 && selectedClient
                                        ? 'bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-600/30 hover:-translate-y-1'
                                        : 'bg-slate-800 text-slate-600 cursor-not-allowed'
                                    }`}
                                >
                                    {!selectedClient && cart.length > 0
                                        ? <><i className="fa-solid fa-user-slash text-sm"></i> Sin cliente</>
                                        : 'Confirmar'
                                    }
                                </button>
                            </div>
                            )}
                            {!showOwnCheckout && (
                                <p className="text-[11px] text-slate-500 text-center">
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
