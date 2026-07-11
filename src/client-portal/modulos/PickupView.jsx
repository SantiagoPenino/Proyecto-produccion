import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { jsPDF } from 'jspdf';
import logoSrc from '../../assets/images/logo/logo.webp';
import pagadoStampSrc from '../../assets/images/general/pagado-stamp.png';
import handyLogo from '../../assets/images/pasarelas/handy.svg';
import mpLogo from '../../assets/images/pasarelas/mercadopago.svg';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import Lottie from 'lottie-react';
import loadingAnim from '../../assets/animations/Loading.json';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/apiClient'; // Assuming user comes from here
import { CheckCircle, AlertCircle, ChevronRight, Truck, CreditCard, Download, MapPin, MapPinCheck, Package, PackageCheck, PackageOpen, Trash2, Plus, ArrowLeft, X, ShieldX } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

import { CustomButton } from '../pautas/CustomButton';
import { CustomSelect } from '../pautas/CustomSelect';
import { FormInput } from '../pautas/FormInput';

export const PickupView = () => {
    const { user } = useAuth();
    const isBloqueado = user?.estado === 'BLOQUEADO';
    const [selectedOrders, setSelectedOrders] = useState(() => {
        try {
            const saved = sessionStorage.getItem('pickup_selected');
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });
    const [readyOrders, setReadyOrders] = useState([]);
    const [pickupCode, setPickupCode] = useState(() => {
        return sessionStorage.getItem('pickup_code') || null;
    });
    const [searchParams, setSearchParams] = useSearchParams();
    const step = searchParams.get('step') || 'selection';
    const setStep = (newStep) => {
        if (newStep === 'selection') {
            searchParams.delete('step');
        } else {
            searchParams.set('step', newStep);
        }
        setSearchParams(searchParams, { replace: true });
    };
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);
    const [confirmedWithoutPayment, setConfirmedWithoutPayment] = useState(false);
    const [showPayModal, setShowPayModal] = useState(false);

    // Shipping/confirmation state
    const [shippingData, setShippingData] = useState(null);
    const [selectedFormaEnvio, setSelectedFormaEnvio] = useState(null);
    const [selectedAgencia, setSelectedAgencia] = useState(null);
    const [customAgencia, setCustomAgencia] = useState('');
    const [defaultDepto, setDefaultDepto] = useState('');
    const [defaultLocalidad, setDefaultLocalidad] = useState('');
    const [selectedDireccion, setSelectedDireccion] = useState('');
    const [receiverFirstName, setReceiverFirstName] = useState('');
    const [receiverLastName, setReceiverLastName] = useState('');
    const [showAddAddress, setShowAddAddress] = useState(false);
    const [newAlias, setNewAlias] = useState('');
    const [newDireccion, setNewDireccion] = useState('');
    const [newCiudad, setNewCiudad] = useState('');
    const [newLocalidad, setNewLocalidad] = useState('');
    const [loadingShipping, setLoadingShipping] = useState(false);
    const addAddressRef = useRef(null);
    const encomiendaRef = useRef(null);
    const creatingRef = useRef(false);
    const isFirstMount = useRef(true);

    // Estados del nuevo flujo Handy (polling post-pago)
    const [pollingTxId, setPollingTxId] = useState(null);
    const [paymentStatus, setPaymentStatus] = useState(null);
    const [paymentData, setPaymentData] = useState(null);
    const pollingRef = useRef(null);

    useEffect(() => {
        if (step !== 'selection' && readyOrders.length > 0) {
            setFetching(false);
            return;
        }

        const loadPickupOrders = async () => {
            // Si es el primer mount y no viene de un pago externo (txId), limpiar selección stale
            if (isFirstMount.current) {
                isFirstMount.current = false;
                const txId = searchParams.get('txId');
                if (!txId && step === 'selection') {
                    sessionStorage.removeItem('pickup_selected');
                    sessionStorage.removeItem('pickup_code');
                    setSelectedOrders([]);
                    setPickupCode(null);
                }
            }
            setFetching(true);
            try {
                const res = await apiClient.get('/web-orders/pickup-orders');
                if (res.success) {
                    setReadyOrders(res.data);
                    // Limpiar seleccionadas que ya no existen
                    const validIds = new Set(res.data.map(o => o.id));
                    setSelectedOrders(prev => {
                        const filtered = prev.filter(id => validIds.has(id));
                        if (filtered.length !== prev.length) {
                            sessionStorage.setItem('pickup_selected', JSON.stringify(filtered));
                        }
                        // Si estamos en confirmation y no hay selecciones validas (ej. recarga), volver
                        if (step !== 'selection' && filtered.length === 0) {
                            setStep('selection');
                        }
                        return filtered;
                    });
                }
            } catch (error) {
                console.error("Error loading pickup orders:", error);
            } finally {
                setFetching(false);
            }
        };
        loadPickupOrders();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [step]);

    // Persist selected orders in sessionStorage
    useEffect(() => {
        sessionStorage.setItem('pickup_selected', JSON.stringify(selectedOrders));
    }, [selectedOrders]);

    // Auto-load shipping data when on confirmation step (e.g. after refresh)
    useEffect(() => {
        if (step === 'confirmation' && !shippingData) {
            (async () => {
                setLoadingShipping(true);
                try {
                    const res = await apiClient.get('/web-orders/shipping-data');
                    if (res.success) {
                        setShippingData(res.data);
                        setSelectedFormaEnvio(res.data.defaultFormaEnvioID || res.data.formasEnvio[0]?.ID);
                        setSelectedAgencia(res.data.defaultAgenciaID || res.data.agencias[0]?.ID);
                        setSelectedDireccion(res.data.defaultDireccion || '');
                    }
                } catch (e) { console.error('Error cargando datos de envío:', e); }
                setLoadingShipping(false);
            })();
        }
    }, [step]);

    // Hermanas multitela: 'SUB-5936 (1/2)' y '(2/2)' comparten el código base → tocar una
    // selecciona/deselecciona el pedido completo, para que se retire junto.
    const baseDe = (id) => String(id || '').replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();

    const handleToggleOrder = (orderId) => {
        const grupo = readyOrders.filter(o => baseDe(o.id) === baseDe(orderId)).map(o => o.id);
        const todasSel = grupo.every(g => selectedOrders.includes(g));

        if (todasSel) {
            setSelectedOrders(selectedOrders.filter(id => !grupo.includes(id)));
        } else {
            // Verificar que no se mezclen monedas (contra lo ya seleccionado de otros pedidos)
            const orderToAdd = readyOrders.find(o => o.id === orderId);
            const yaSeleccionadas = selectedOrders.filter(id => !grupo.includes(id));
            if (orderToAdd && yaSeleccionadas.length > 0) {
                const firstSelected = readyOrders.find(o => o.id === yaSeleccionadas[0]);
                if (firstSelected && orderToAdd.currency !== firstSelected.currency) {
                    Swal.fire({ icon: 'warning', title: 'Monedas diferentes', text: 'No es posible mezclar pagos en Dólares y Pesos Uruguayos en una misma transacción. Seleccioná únicamente órdenes que compartan la misma moneda.', background: '#212121', color: '#e4e4e7', confirmButtonColor: '#006E97', customClass: { popup: 'rounded-xl border border-zinc-700' } });
                    return; // Bloquea la selección mixta
                }
            }
            setSelectedOrders([...new Set([...selectedOrders, ...grupo])]);
        }
    };

    const totalAmount = readyOrders
        .filter(o => selectedOrders.includes(o.id))
        .reduce((sum, o) => sum + (o.isPaid ? 0 : o.amount), 0);

    const activeCurrency = selectedOrders.length > 0
        ? readyOrders.find(o => o.id === selectedOrders[0])?.currency || '$'
        : '$';

    const downloadReceipt = async (code) => {
        try {
            const token = localStorage.getItem('auth_token');
            const ordersToPrint = readyOrders.filter(o => selectedOrders.includes(o.id));
            const total = ordersToPrint.reduce((sum, o) => sum + o.amount, 0).toFixed(2);

            const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

            const response = await fetch(`${API_URL}/web-orders/pickup-orders/pdf`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    receiptId: code || pickupCode,
                    orders: ordersToPrint,
                    clientName: user?.name,
                    total: total
                })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `retiro-${code || pickupCode}.pdf`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
            } else {
                console.error("Error generating PDF");
            }
        } catch (error) {
            console.error("Download error:", error);
        }
    };

    const handleCreatePickup = async (shippingOverrides = {}) => {
        if (isBloqueado) {
            Swal.fire({ icon: 'error', title: 'Cuenta bloqueada', text: 'Tu cuenta está bloqueada. No podés crear retiros. Contactanos para regularizar tu situación.', confirmButtonColor: '#06b6d4' });
            return null;
        }
        if (creatingRef.current) return null;
        creatingRef.current = true;
        setLoading(true);
        try {
            const ordersPayload = selectedOrders.map(selId => {
                const order = readyOrders.find(o => o.id === selId);
                if (!order) return null;
                const orderNum = order.id.replace('#', '');
                return {
                    OrdIdOrden: order.rawId,
                    orderNumber: orderNum,
                    ordNombreTrabajo: order.desc.split(' - ').pop() || order.desc,
                    meters: String(order.quantityStr || ""),
                    MonSimbolo: order.currency === 'USD' ? 'USD' : '$',
                    costo: Number(Number(order.amount || 0).toFixed(2)),
                    estado: order.originalStatus,
                    tipodecliente: order.clientType || "Comun",
                    pago: order.isPaid ? 'Pagado' : 'No realizado',
                    checked: true,
                    clientId: order.clientId || 'N/A',
                    contact: order.contact || '',
                    costWithCurrency: `${order.currency === 'USD' ? 'USD' : '$'} ${typeof order.amount === 'number' ? order.amount.toFixed(2) : '0.00'}`
                };
            }).filter(Boolean);

            const formaEnvioId = shippingOverrides.formaEnvioId || selectedFormaEnvio || shippingData?.defaultFormaEnvioID || 5;
            const esEncomienda = shippingData?.formasEnvio?.find(f => f.ID === formaEnvioId)?.Nombre?.toLowerCase().includes('encomienda');

            // Resolver departamento y localidad desde la dirección seleccionada
            let dir = selectedDireccion || '';
            let depto = '';
            let loc = '';
            const savedDir = shippingData?.direccionesGuardadas?.find(d => d.Direccion === selectedDireccion);
            if (savedDir) {
                depto = savedDir.Ciudad || '';
                loc = savedDir.Localidad || '';
            } else if (dir === shippingData?.defaultDireccion) {
                // Default address — use manually selected dept/loc
                depto = defaultDepto || '';
                loc = defaultLocalidad || '';
            }

            const payload = {
                orders: ordersPayload,
                totalCost: Number((totalAmount || 0).toFixed(2)),
                lugarRetiro: esEncomienda ? 2 : 1,
                direccion: esEncomienda ? dir : null,
                departamento: esEncomienda ? depto : null,
                localidad: esEncomienda ? loc : null,
                agenciaId: esEncomienda ? (selectedAgencia === -1 ? null : selectedAgencia) : null,
                customAgencia: esEncomienda && selectedAgencia === -1 ? customAgencia : null,
                receptorNombre: esEncomienda ? `${receiverFirstName.trim()} ${receiverLastName.trim()}` : null
            };

            const res = await apiClient.post('/web-orders/pickup-orders/create', payload);

            if (res.success) {
                const code = res.data?.OReIdOrdenRetiro || res.data?.codigoRetiro || `RET-${Math.floor(Math.random() * 9000) + 1000}`;
                setPickupCode(code);
                sessionStorage.setItem('pickup_code', String(code));
                return code;
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: res.error || 'Error al crear retiro', background: '#212121', color: '#e4e4e7', confirmButtonColor: '#006E97', customClass: { popup: 'rounded-xl border border-zinc-700' } });
                return null;
            }
        } catch (error) {
            console.error(error);
            Swal.fire({ icon: 'error', title: 'Error de conexión', text: 'Error al conectar con el servidor: ' + error.message, background: '#212121', color: '#e4e4e7', confirmButtonColor: '#006E97', customClass: { popup: 'rounded-xl border border-zinc-700' } });
            return null;
        } finally {
            creatingRef.current = false;
            setLoading(false);
        }
    };

    // Detectar ?txId al volver de Handy
    useEffect(() => {
        const txId = searchParams.get('txId');
        if (txId) {
            setPollingTxId(txId);
            setPaymentStatus('Creado');
            sessionStorage.removeItem('pickup_selected');
            sessionStorage.removeItem('pickup_code');
            setSelectedOrders([]);
            setPickupCode(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Polling del estado del pago
    useEffect(() => {
        if (!pollingTxId) return;
        const poll = async () => {
            try {
                const API_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');
                const token = localStorage.getItem('auth_token');
                const res = await fetch(`${API_URL}/web-orders/payment-status/${pollingTxId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setPaymentStatus(data.status);
                    if (data.status === 'Pagado' || data.status === 'Fallido') {
                        setPaymentData(data);
                        clearInterval(pollingRef.current);
                    }
                }
            } catch (e) { /* silencioso */ }
        };
        poll();
        pollingRef.current = setInterval(poll, 4000);
        return () => clearInterval(pollingRef.current);
    }, [pollingTxId]);

    // NUEVO FLUJO: genera link MercadoPago sin crear retiro, con redireccion directa
    const handleInitMpPayment = async () => {
        setLoading(true);
        try {
            const formaEnvioId = selectedFormaEnvio || shippingData?.defaultFormaEnvioID || 5;
            const esEncomienda = shippingData?.formasEnvio?.find(f => f.ID === formaEnvioId)?.Nombre?.toLowerCase().includes('encomienda');
            let dir = selectedDireccion || '';
            let depto = '';
            let loc = '';
            const savedDir = shippingData?.direccionesGuardadas?.find(d => d.Direccion === selectedDireccion);
            if (savedDir) { depto = savedDir.Ciudad || ''; loc = savedDir.Localidad || ''; }
            else if (dir === shippingData?.defaultDireccion) { depto = defaultDepto || ''; loc = defaultLocalidad || ''; }
            const ordersPayload = selectedOrders.map(selId => {
                const order = readyOrders.find(o => o.id === selId);
                if (!order) return null;
                return { OrdIdOrden: order.rawId, orderNumber: order.id.replace('#', ''), desc: order.desc, amount: order.amount, currency: order.currency };
            }).filter(Boolean);
            const payload = {
                orders: ordersPayload,
                totalAmount: Number((totalAmount || 0).toFixed(2)),
                activeCurrency: activeCurrency,
                lugarRetiro: esEncomienda ? 2 : 1,
                direccion: esEncomienda ? dir : null,
                departamento: esEncomienda ? depto : null,
                localidad: esEncomienda ? loc : null,
                agenciaId: esEncomienda ? (selectedAgencia === -1 ? null : selectedAgencia) : null,
                customAgencia: esEncomienda && selectedAgencia === -1 ? customAgencia : null,
                receptorNombre: esEncomienda ? (receiverFirstName.trim() + ' ' + receiverLastName.trim()) : null
            };
            const res = await apiClient.post('/web-orders/pickup-orders/mp-payment', payload);
            if (res.success && res.url) {
                // MercadoPago no necesita ventana separada — redireccion directa
                window.location.href = res.url;
            } else {
                Swal.fire({ icon: 'error', title: 'Error de pago', text: 'No se pudo generar el link de MercadoPago' + (res.error ? ': ' + res.error : ''), background: '#212121', color: '#e4e4e7', confirmButtonColor: '#009ee3', customClass: { popup: 'rounded-xl border border-zinc-700' } });
            }
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrió un error al contactar MercadoPago.', background: '#212121', color: '#e4e4e7', confirmButtonColor: '#009ee3', customClass: { popup: 'rounded-xl border border-zinc-700' } });
        } finally { setLoading(false); }
    };

    // NUEVO FLUJO: genera link Handy sin crear retiro, pero con anti-popup blocker y redireccion
    const handleInitPayment = async () => {
        // Anti-popup blocker: Abrir pestaña en blanco síncronamente en el momento del click
        const payWindow = window.open('about:blank', '_blank');

        setLoading(true);
        try {
            const formaEnvioId = selectedFormaEnvio || shippingData?.defaultFormaEnvioID || 5;
            const esEncomienda = shippingData?.formasEnvio?.find(f => f.ID === formaEnvioId)?.Nombre?.toLowerCase().includes('encomienda');
            let dir = selectedDireccion || '';
            let depto = '';
            let loc = '';
            const savedDir = shippingData?.direccionesGuardadas?.find(d => d.Direccion === selectedDireccion);
            if (savedDir) { depto = savedDir.Ciudad || ''; loc = savedDir.Localidad || ''; }
            else if (dir === shippingData?.defaultDireccion) { depto = defaultDepto || ''; loc = defaultLocalidad || ''; }
            const ordersPayload = selectedOrders.map(selId => {
                const order = readyOrders.find(o => o.id === selId);
                if (!order) return null;
                return { OrdIdOrden: order.rawId, orderNumber: order.id.replace('#', ''), desc: order.desc, amount: order.amount, currency: order.currency };
            }).filter(Boolean);
            const payload = {
                orders: ordersPayload,
                totalAmount: Number((totalAmount || 0).toFixed(2)),
                activeCurrency: activeCurrency,
                lugarRetiro: esEncomienda ? 2 : 1,
                direccion: esEncomienda ? dir : null,
                departamento: esEncomienda ? depto : null,
                localidad: esEncomienda ? loc : null,
                agenciaId: esEncomienda ? (selectedAgencia === -1 ? null : selectedAgencia) : null,
                customAgencia: esEncomienda && selectedAgencia === -1 ? customAgencia : null,
                receptorNombre: esEncomienda ? (receiverFirstName.trim() + ' ' + receiverLastName.trim()) : null
            };
            const res = await apiClient.post('/web-orders/pickup-orders/init-payment', payload);

            if (res.success && res.url) {
                // Navegar URL popup a Handy
                if (payWindow) payWindow.location.href = res.url;

                // Limpiar state y navegar la pestaña origin a status de pago
                if (res.transactionId) {
                    window.location.href = `/portal/payment-status?txId=${res.transactionId}`;
                }
            } else {
                if (payWindow) payWindow.close();
                Swal.fire({ icon: 'error', title: 'Error de pago', text: 'No se pudo generar el link de pago' + (res.error ? ': ' + res.error : ''), background: '#212121', color: '#e4e4e7', confirmButtonColor: '#006E97', customClass: { popup: 'rounded-xl border border-zinc-700' } });
            }
        } catch (err) {
            if (payWindow) payWindow.close();
            Swal.fire({ icon: 'error', title: 'Error', text: 'Ocurrio un error al contactar la pasarela de pagos.', background: '#212121', color: '#e4e4e7', confirmButtonColor: '#006E97', customClass: { popup: 'rounded-xl border border-zinc-700' } });
        } finally { setLoading(false); }
    };

    const generateReceipt = async (data) => {
        const doc = new jsPDF();
        const pageW = doc.internal.pageSize.getWidth();
        const toBase64 = (src) => new Promise((resolve) => {
            const img = new Image(); img.crossOrigin = 'anonymous';
            img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); resolve({ dataUrl: c.toDataURL('image/png'), width: img.naturalWidth, height: img.naturalHeight }); };
            img.onerror = () => resolve(null); img.src = src;
        });
        try { const ld = await toBase64(logoSrc); if (ld) { const r = ld.width / ld.height; const h = 12; doc.addImage(ld.dataUrl, 'PNG', 20, 14, h * r, h); } } catch (e) { }
        let stampDataUrl = null, stampRatio = 1;
        if (data.status === 'Pagado') { try { const sd = await toBase64(pagadoStampSrc); if (sd) { stampDataUrl = sd.dataUrl; stampRatio = sd.width / sd.height; } } catch (e) { } }
        let gatewayDataUrl = null, gatewayRatio = 1, gatewayColor = null;
        if (data.paymentMethod) {
            const method = data.paymentMethod.toLowerCase();
            const gwLogo = method.includes('handy') ? handyLogo : (method.includes('mercadopago') || method.includes('mp') ? mpLogo : null);
            gatewayColor = method.includes('handy') ? '#722efa' : ((method.includes('mercadopago') || method.includes('mp')) ? '#ffe600' : null);
            if (gwLogo) { try { const gd = await toBase64(gwLogo); if (gd) { gatewayDataUrl = gd.dataUrl; gatewayRatio = gd.width / gd.height; } } catch (e) { } }
        }
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(140);
        doc.text(data.transactionId || '', pageW - 20, 25, { align: 'right' });
        doc.setDrawColor(200); doc.line(20, 32, pageW - 20, 32);
        let y = 40;
        doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(25, 24, 27);
        doc.text('COMPROBANTE DE PAGO', 20, y);
        const dt = data.paidAt ? new Date(data.paidAt).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(120);
        doc.text(dt, pageW - 20, y, { align: 'right' }); y += 20;
        const retiroCode = data.ordenRetiro ? String(data.ordenRetiro) : '-';
        const clientCode = String(user?.codCliente || '-');
        const cw = pageW - 40; const hw = (cw - 6) / 2;
        const drawCard = (x, w, label, val) => { doc.setFillColor(25, 24, 27); doc.roundedRect(x, y, w, 7, 2, 2, 'F'); doc.rect(x, y + 5, w, 2, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255); doc.text(label, x + w / 2, y + 5, { align: 'center' }); doc.setFillColor(255, 255, 255); doc.setDrawColor(200); doc.rect(x, y + 7, w, 11, 'FD'); doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(25, 24, 27); doc.text(val, x + w / 2, y + 14.5, { align: 'center' }); };
        drawCard(20, hw, 'CODIGO DE RETIRO', retiroCode); drawCard(20 + hw + 6, hw, 'CODIGO DE CLIENTE', clientCode); y += 28;
        doc.setFont('helvetica', 'normal'); doc.setTextColor(120); doc.setFontSize(10);
        doc.text('MEDIO DE PAGO', 20, y);
        if (gatewayDataUrl) {
            const gh = 7;
            const gw = gh * gatewayRatio;
            const px = 4, py = 2;
            if (gatewayColor) {
                doc.setFillColor(gatewayColor);
                doc.roundedRect(pageW - 20 - gw - px * 2, y - 6 - py, gw + px * 2, gh + py * 2, 2, 2, 'F');
            }
            doc.addImage(gatewayDataUrl, 'PNG', pageW - 20 - gw - px, y - 6, gw, gh);
        } else {
            doc.setFont('helvetica', 'bold'); doc.setTextColor(40);
            doc.text(String(data.paymentMethod || '-').toUpperCase(), pageW - 20, y, { align: 'right' });
        }
        y += 12;
        if (data.orders?.length > 0) { const rh = 8; doc.setFillColor(25, 24, 27); doc.rect(20, y, pageW - 40, rh, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(255, 255, 255); doc.text('PEDIDO', 24, y + 5.5); doc.text('IMPORTE', pageW - 24, y + 5.5, { align: 'right' }); y += rh; data.orders.forEach((o, i) => { i % 2 === 0 ? doc.setFillColor(244, 244, 245) : doc.setFillColor(212, 212, 216); doc.rect(20, y, pageW - 40, rh, 'F'); doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(40); doc.text(String(o.id || o.desc), 24, y + 5.5); doc.setFont('helvetica', 'bold'); doc.text(String(data.currencySymbol) + ' ' + Number(o.amount || 0).toFixed(2), pageW - 24, y + 5.5, { align: 'right' }); y += rh; }); y += 6; }
        doc.setDrawColor(200); doc.line(20, y, pageW - 20, y); y += 10;
        doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(25, 24, 27);
        const totalStr = String(data.currencySymbol) + ' ' + Number(data.totalAmount).toFixed(2);
        doc.text('TOTAL: ', pageW - 20 - doc.getTextWidth(totalStr), y, { align: 'right' }); doc.setTextColor(5, 150, 105); doc.text(totalStr, pageW - 20, y, { align: 'right' });
        if (stampDataUrl) { const sw = 35, sh = sw / stampRatio; doc.saveGraphicsState(); doc.setGState(new doc.GState({ opacity: 0.5 })); doc.addImage(stampDataUrl, 'PNG', pageW / 3 - sw / 2, y - sh / 2 + 2, sw, sh); doc.restoreGraphicsState(); }
        doc.setFontSize(8); doc.setTextColor(160); doc.text('ESTE COMPROBANTE FUE GENERADO AUTOMATICAMENTE.', pageW / 2, 280, { align: 'center' });
        doc.save('comprobante-' + retiroCode + '.pdf');
    };

    // Pantalla: polling / resultado del pago Handy
    if (pollingTxId) {
        if (paymentStatus === 'Pagado' && paymentData) {
            return (
                <div className="animate-fade-in flex flex-col min-h-[80vh]">
                    <div className="flex items-center gap-3 mb-6">
                        <CheckCircle size={48} strokeWidth={1} className="text-green-400" />
                        <div>
                            <h2 className="text-lg font-bold text-zinc-300 uppercase">Pago <span className="text-custom-cyan">Confirmado</span></h2>
                            <p className="text-zinc-500 uppercase text-xs">Tu retiro fue creado y el pago fue procesado.</p>
                        </div>
                    </div>
                    <div className="flex-1 flex flex-col items-center justify-center gap-4">
                        <div className="max-w-xs w-full rounded-xl bg-brand-dark border border-zinc-700 pt-5 pb-7 px-6 flex flex-col items-center gap-4">
                            <p className="text-[10px] uppercase text-zinc-500 font-bold tracking-wider">Codigo de retiro</p>
                            <p className="text-5xl font-mono font-black text-custom-cyan tracking-wider text-center">{paymentData.ordenRetiro || '—'}</p>
                            {paymentData.ordenRetiro && (
                                <div className="bg-white rounded-xl p-3">
                                    <QRCodeSVG value={paymentData.ordenRetiro} size={160} fgColor="#18181b" bgColor="#ffffff" />
                                </div>
                            )}
                            {paymentData.paymentMethod && (
                                <p className="text-xs text-zinc-500">Pagado con <span className="text-zinc-300 font-bold">{paymentData.paymentMethod}</span></p>
                            )}
                        </div>
                    </div>
                    <div className="flex justify-between items-stretch gap-3 mt-auto">
                        <CustomButton onClick={() => generateReceipt(paymentData)} variant="secondary" icon={Download} className="w-1/2 md:w-auto !bg-transparent !text-zinc-400 hover:!text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5" whileHover={{ scale: 1 }} whileTap={{ scale: 1 }}>Comprobante</CustomButton>
                        <CustomButton onClick={() => { setPollingTxId(null); setPaymentStatus(null); setPaymentData(null); setStep('selection'); }} variant="secondary" icon={ArrowLeft} className="w-1/2 md:w-auto !bg-transparent !text-zinc-400 hover:!text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5" whileHover={{ scale: 1 }} whileTap={{ scale: 1 }}>Volver</CustomButton>
                    </div>
                </div>
            );
        }
        if (paymentStatus === 'Fallido') {
            return (
                <div className="animate-fade-in flex flex-col items-center justify-center min-h-[60vh] gap-6">
                    <AlertCircle size={64} strokeWidth={1} className="text-brand-magenta" />
                    <div className="text-center">
                        <h2 className="text-lg font-bold text-zinc-300 uppercase">Pago <span className="text-brand-magenta">Fallido</span></h2>
                        <p className="text-zinc-500 text-sm mt-1">No se pudo procesar el pago. Podes intentarlo de nuevo.</p>
                    </div>
                    <CustomButton onClick={() => { setPollingTxId(null); setPaymentStatus(null); setPaymentData(null); setStep('confirmation'); }} variant="primary" icon={CreditCard} className="!bg-custom-dark !text-zinc-400 hover:!text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5" whileHover={{ scale: 1 }} whileTap={{ scale: 1 }}>Reintentar</CustomButton>
                </div>
            );
        }
        return (
            <div className="flex flex-col justify-center items-center min-h-[70vh] gap-6">
                <Lottie animationData={loadingAnim} loop style={{ width: 220, height: 220 }} />
                <div className="text-center -mt-16">
                    <p className="font-bold uppercase animate-pulse text-zinc-300">Verificando pago...</p>
                    <p className="text-xs text-zinc-600 mt-1">Por favor espera, esto puede tardar unos segundos.</p>
                </div>
            </div>
        );
    }

    if (step === 'success') {
        return (
            <div className="animate-fade-in flex flex-col min-h-[80vh]">
                {/* Header */}
                <div className="flex items-center gap-3 mb-2">
                    <CheckCircle size={48} strokeWidth={1} className="text-green-400" />
                    <div>
                        <h2 className="text-lg font-bold text-zinc-300 uppercase">
                            Retiro <span className="text-custom-cyan">RW-{pickupCode}</span>
                        </h2>
                        <p className="text-zinc-500 uppercase text-xs">
                            {confirmedWithoutPayment ? 'Creado — Pendiente de pago' : 'Habilitado'}
                        </p>
                    </div>
                </div>

                {/* Código de retiro — centrado */}
                <div className="flex-1 flex flex-col items-center justify-center gap-4">
                    <p className="text-zinc-500 text-xs text-center max-w-sm uppercase">
                        Para retirar podés abonar desde <span className="text-custom-cyan font-bold">Pagos Pendientes</span>.
                    </p>

                    <div className="max-w-xs w-full rounded-xl bg-brand-dark border border-zinc-700 pt-5 pb-7 px-6 flex flex-col items-center gap-4">
                        <p className="text-5xl font-mono font-black text-custom-cyan tracking-wider text-center">RW-{pickupCode}</p>
                        <div className="bg-white rounded-xl p-3">
                            <QRCodeSVG
                                value={`RW-${pickupCode}`}
                                size={160}
                                fgColor="#18181b"
                                bgColor="#ffffff"
                            />
                        </div>
                    </div>

                    <p className="text-zinc-500 text-xs text-center max-w-sm uppercase">
                        O acercarte a nuestro local y abonar en <span className="text-custom-cyan font-bold">caja</span>.
                    </p>
                </div>

                {/* Botones */}
                <div className="flex justify-between items-stretch gap-3 mt-auto">
                    <CustomButton
                        onClick={() => downloadReceipt(pickupCode)}
                        variant="secondary"
                        icon={Download}
                        className="w-1/2 md:w-auto !bg-transparent !text-zinc-400 hover:!text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5"
                        whileHover={{ scale: 1 }}
                        whileTap={{ scale: 1 }}
                    >
                        Comprobante
                    </CustomButton>

                    <CustomButton
                        onClick={() => { setStep('selection'); setSelectedOrders([]); setConfirmedWithoutPayment(false); }}
                        variant="secondary"
                        icon={ArrowLeft}
                        className="w-1/2 md:w-auto !bg-transparent !text-zinc-400 hover:!text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5"
                        whileHover={{ scale: 1 }}
                        whileTap={{ scale: 1 }}
                    >
                        Volver
                    </CustomButton>
                </div>
            </div>
        );
    }

    if (fetching) {
        return (
            <div className="flex flex-col justify-center items-center min-h-[60vh]">
                <Lottie animationData={loadingAnim} loop style={{ width: 250, height: 250 }} />
                <span className="font-bold uppercase -mt-20 animate-pulse">Buscando órdenes listas...</span>
            </div>
        );
    }

    // ========================
    // STEP: CONFIRMATION
    // ========================
    const selectedOrdersData = readyOrders.filter(o => selectedOrders.includes(o.id));
    const isEncomienda = shippingData?.formasEnvio?.find(f => f.ID === selectedFormaEnvio)?.Nombre?.toLowerCase().includes('encomienda');
    const isDefaultAddress = selectedDireccion && selectedDireccion === shippingData?.defaultDireccion;
    const selectedSavedDir = shippingData?.direccionesGuardadas?.find(d => d.Direccion === selectedDireccion);
    const needsDeptLoc = isEncomienda && isDefaultAddress && (!defaultDepto || !defaultLocalidad);
    const needsAddress = isEncomienda && (!selectedDireccion?.trim() || needsDeptLoc);
    const needsReceiverName = isEncomienda && (!receiverFirstName.trim() || !receiverLastName.trim());

    const handleAddAddress = async () => {
        if (!newDireccion.trim()) return;
        try {
            const res = await apiClient.post('/web-orders/saved-addresses', {
                alias: newAlias.trim(),
                direccion: newDireccion.trim(),
                agenciaID: selectedAgencia,
                ciudad: newCiudad.trim(),
                localidad: newLocalidad.trim()
            });
            if (res.success) {
                setShippingData(prev => ({
                    ...prev,
                    direccionesGuardadas: [...(prev.direccionesGuardadas || []), res.data]
                }));
                setSelectedDireccion(res.data.Direccion);
                setNewAlias('');
                setNewDireccion('');
                setNewCiudad('');
                setNewLocalidad('');
                setShowAddAddress(false);
            } else {
                Swal.fire({ icon: 'error', title: 'Error', text: res.error || 'Error al guardar', background: '#212121', color: '#e4e4e7', confirmButtonColor: '#006E97', customClass: { popup: 'rounded-xl border border-zinc-700' } });
            }
        } catch (e) { Swal.fire({ icon: 'error', title: 'Error', text: 'Error al guardar dirección', background: '#212121', color: '#e4e4e7', confirmButtonColor: '#006E97', customClass: { popup: 'rounded-xl border border-zinc-700' } }); }
    };

    const handleDeleteAddress = async (id) => {
        const result = await Swal.fire({
            title: '¿Eliminar dirección?',
            text: 'Se quitará de tu lista. Podés volver a agregarla más tarde.',
            background: '#212121',
            color: '#e4e4e7',
            showCancelButton: true,
            confirmButtonColor: '#DC2626',
            cancelButtonColor: '#3f3f46',
            confirmButtonText: 'Eliminar',
            cancelButtonText: 'Cancelar',
            customClass: {
                popup: 'rounded-xl border border-zinc-700',
                title: '!text-lg !font-bold',
                htmlContainer: '!text-sm !text-zinc-400',
            }
        });
        if (!result.isConfirmed) return;
        try {
            const res = await apiClient.delete(`/web-orders/saved-addresses/${id}`);
            if (res.success) {
                setShippingData(prev => ({
                    ...prev,
                    direccionesGuardadas: prev.direccionesGuardadas.filter(d => d.ID !== id)
                }));
            }
        } catch (e) { console.error(e); }
    };

    if (step === 'confirmation') {
        // Guard: si no hay órdenes seleccionadas (ej: volvió con back-button después de pagar), redirigir
        if (selectedOrdersData.length === 0) {
            setStep('selection');
            return null;
        }
        return (
            <div className="animate-fade-in space-y-6">

                {/* Header */}
                <div className="flex items-center gap-3 mb-2">
                    <PackageCheck size={48} strokeWidth={1} className="text-brand-gold" />
                    <div>
                        <h2 className="text-lg font-bold text-zinc-300 uppercase">Nuevo <span className="text-custom-cyan">Retiro</span></h2>
                        <p className="text-zinc-500 uppercase text-xs">Revisá los datos y elegí forma de envío para confirmar.</p>
                    </div>
                </div>

                {/* Resumen de órdenes */}
                <div className="overflow-hidden rounded-xl bg-brand-dark border border-zinc-800">
                    <div className="p-4 border-b border-zinc-800">
                        <h3 className="font-bold text-zinc-100 uppercase text-xs tracking-wider">Órdenes Seleccionadas</h3>
                    </div>
                    <div className="p-3 space-y-1.5">
                        {selectedOrdersData.map(o => (
                            <div key={o.id} className="flex justify-between items-center py-1.5 px-3 rounded-lg bg-custom-dark">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-custom-cyan truncate">{o.id}</p>
                                    <p className="text-xs text-zinc-500 truncate">{o.desc}</p>
                                </div>
                                <span className="font-bold text-custom-cyan shrink-0 ml-3">
                                    <span className="text-xs text-zinc-500 mr-0.5">{o.currency === 'USD' ? 'US$' : '$'}</span>{(o.amount || 0).toFixed(2)}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="flex items-center justify-between p-4 border-t border-zinc-800">
                        <p className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Total</p>
                        <p className="text-lg font-black text-zinc-100">
                            <span className="text-xs text-zinc-500 mr-1">{activeCurrency === 'USD' ? 'US$' : '$'}</span>{(totalAmount || 0).toFixed(2)}
                        </p>
                    </div>
                </div>

                {/* Forma de envío */}
                {shippingData && (
                    <div className="space-y-5 p-6 rounded-xl bg-custom-dark shadow-lg shadow-black/20">
                        <h3 className="font-bold text-zinc-100 flex items-center gap-2 uppercase text-xs tracking-wider">
                            <Truck size={24} strokeWidth={2} className="text-brand-gold" /> Forma de Envío
                        </h3>

                        <div className="flex flex-col md:flex-row gap-3">
                            {shippingData.formasEnvio.map(f => (
                                <label
                                    key={f.ID}
                                    className={`flex-1 flex items-center justify-center gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all text-sm font-bold uppercase tracking-wide ${selectedFormaEnvio === f.ID
                                        ? 'border-brand-cyan bg-brand-cyan/10 text-zinc-100'
                                        : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
                                        }`}
                                >
                                    <input
                                        type="radio"
                                        name="formaEnvio"
                                        value={f.ID}
                                        checked={selectedFormaEnvio === f.ID}
                                        onChange={() => {
                                            setSelectedFormaEnvio(f.ID);
                                            if (f.Nombre?.toLowerCase().includes('encomienda')) {
                                                setTimeout(() => encomiendaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 150);
                                            }
                                        }}
                                        className="sr-only"
                                    />
                                    {f.Nombre}
                                </label>
                            ))}
                        </div>

                        {/* Si es encomienda: agencia + dirección */}
                        {isEncomienda && (
                            <div ref={encomiendaRef} className="space-y-4 pt-2">
                                {/* Quien recibe */}
                                <div>
                                    <label className="block text-sm font-bold text-zinc-500 mb-2 uppercase">¿Quién va a recibir? *</label>
                                    <div className="grid grid-cols-2 gap-3">
                                        <input
                                            type="text"
                                            value={receiverFirstName}
                                            onChange={(e) => setReceiverFirstName(e.target.value)}
                                            placeholder="Nombre"
                                            className="w-full bg-brand-dark border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan outline-none transition-all"
                                        />
                                        <input
                                            type="text"
                                            value={receiverLastName}
                                            onChange={(e) => setReceiverLastName(e.target.value)}
                                            placeholder="Apellido"
                                            className="w-full bg-brand-dark border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan outline-none transition-all"
                                        />
                                    </div>
                                </div>
                                {/* Agencia */}
                                <div>
                                    <label className="block text-sm font-bold text-zinc-500 mb-2 uppercase">Agencia</label>
                                    <CustomSelect
                                        value={selectedAgencia}
                                        onChange={(val) => { setSelectedAgencia(Number(val)); if (Number(val) !== -1) setCustomAgencia(''); }}
                                        options={[
                                            ...shippingData.agencias.map(a => ({ value: a.ID, label: a.Nombre })),
                                            { value: -1, label: 'Otra...' }
                                        ]}
                                        placeholder="Seleccionar agencia..."
                                    />
                                    {selectedAgencia === -1 && (
                                        <input
                                            type="text"
                                            value={customAgencia}
                                            onChange={(e) => setCustomAgencia(e.target.value)}
                                            placeholder="Especifique la agencia..."
                                            className="mt-2 w-full bg-brand-dark border border-zinc-700 rounded-xl px-4 py-3 text-sm text-zinc-100 placeholder-zinc-600 focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan outline-none transition-all"
                                        />
                                    )}
                                </div>

                                {/* Dirección */}
                                <div>
                                    <label className="block text-sm font-bold text-zinc-500 mb-2 uppercase">Dirección de Envío <span className="text-zinc-600 font-normal">({(shippingData.direccionesGuardadas?.length || 0) + (shippingData.defaultDireccion ? 1 : 0)}/3)</span></label>
                                    {(shippingData.defaultDireccion || shippingData.direccionesGuardadas?.length > 0) ? (
                                        <div className="space-y-2">
                                            {/* Dirección principal */}
                                            {shippingData.defaultDireccion && (
                                                <label
                                                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${selectedDireccion === shippingData.defaultDireccion ? 'border-brand-cyan/40 bg-brand-cyan/5' : 'border-zinc-700 hover:border-zinc-500'}`}
                                                    onClick={() => setSelectedDireccion(shippingData.defaultDireccion)}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {selectedDireccion === shippingData.defaultDireccion
                                                            ? <MapPinCheck size={24} strokeWidth={1.5} className="flex-shrink-0 text-custom-cyan" />
                                                            : <MapPin size={24} strokeWidth={1.5} className="flex-shrink-0 text-zinc-500" />
                                                        }
                                                        <div className="flex flex-col justify-center">
                                                            <span className="text-sm font-bold text-zinc-200">Principal</span>
                                                            <p className="text-sm text-zinc-400">{shippingData.defaultDireccion}</p>
                                                        </div>
                                                    </div>
                                                </label>
                                            )}

                                            {/* Dept/Loc pickers for default address */}
                                            {isDefaultAddress && (
                                                <div className="grid grid-cols-2 gap-3 mt-2">
                                                    <CustomSelect
                                                        value={defaultDepto}
                                                        onChange={(val) => {
                                                            setDefaultDepto(val);
                                                            const dept = shippingData.departamentos?.find(d => d.Nombre === val);
                                                            const locs = dept ? shippingData.localidades?.filter(l => l.DepartamentoID === dept.ID) : [];
                                                            setDefaultLocalidad(locs?.length === 1 ? locs[0].Nombre : '');
                                                        }}
                                                        options={[
                                                            { value: '', label: 'Departamento...' },
                                                            ...(shippingData.departamentos?.map(d => ({ value: d.Nombre, label: d.Nombre })) || [])
                                                        ]}
                                                        placeholder="Departamento..."
                                                        size="small"
                                                    />
                                                    <CustomSelect
                                                        value={defaultLocalidad}
                                                        onChange={(val) => setDefaultLocalidad(val)}
                                                        options={[
                                                            { value: '', label: 'Localidad...' },
                                                            ...(() => {
                                                                const dept = shippingData.departamentos?.find(d => d.Nombre === defaultDepto);
                                                                if (!dept) return [];
                                                                return shippingData.localidades?.filter(l => l.DepartamentoID === dept.ID).map(l => ({ value: l.Nombre, label: l.Nombre })) || [];
                                                            })()
                                                        ]}
                                                        placeholder="Localidad..."
                                                        size="small"
                                                        disabled={!defaultDepto}
                                                    />
                                                </div>
                                            )}

                                            {/* Direcciones guardadas */}
                                            {shippingData.direccionesGuardadas?.map((d, idx) => (
                                                <div
                                                    key={d.ID}
                                                    className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${selectedDireccion === d.Direccion ? 'border-brand-cyan/40 bg-brand-cyan/5' : 'border-zinc-700 hover:border-zinc-500'}`}
                                                    onClick={() => setSelectedDireccion(d.Direccion)}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        {selectedDireccion === d.Direccion
                                                            ? <MapPinCheck size={24} strokeWidth={1.5} className="flex-shrink-0 text-custom-cyan" />
                                                            : <MapPin size={24} strokeWidth={1.5} className="flex-shrink-0 text-zinc-500" />
                                                        }
                                                        <div className="flex flex-col justify-center">
                                                            <span className="text-sm font-bold text-zinc-200">{d.Alias || 'Dirección guardada'}</span>
                                                            <p className="text-sm text-zinc-400">
                                                                {d.Direccion}
                                                                {d.Ciudad ? `, ${d.Ciudad}` : ''}
                                                                {d.Localidad ? ` (${d.Localidad})` : ''}
                                                            </p>
                                                        </div>
                                                    </div>
                                                    {(idx > 0 || shippingData.defaultDireccion) && (
                                                        <button
                                                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteAddress(d.ID); }}
                                                            className="text-zinc-600 hover:text-brand-magenta transition-colors p-1"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p className="text-sm text-zinc-500 italic">No tenés direcciones guardadas. Agregá una abajo.</p>
                                    )}
                                </div>

                                {/* Agregar nueva dirección */}
                                {((shippingData.direccionesGuardadas?.length || 0) + (shippingData.defaultDireccion ? 1 : 0)) < 3 && (
                                    <div>
                                        {!showAddAddress ? (
                                            <button
                                                onClick={() => { setShowAddAddress(true); setTimeout(() => addAddressRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100); }}
                                                className="flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-zinc-300 transition-colors"
                                            >
                                                <Plus size={16} /> Agregar nueva dirección
                                            </button>
                                        ) : (
                                            <div ref={addAddressRef} className="space-y-3 p-4 bg-custom-dark rounded-xl border border-zinc-700">
                                                <input
                                                    type="text"
                                                    placeholder='Alias (ej: "Oficina")'
                                                    value={newAlias}
                                                    onChange={e => setNewAlias(e.target.value)}
                                                    className="w-full p-2.5 border border-zinc-700 rounded-lg text-sm bg-brand-dark text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
                                                />
                                                <input
                                                    type="text"
                                                    placeholder="Dirección completa"
                                                    value={newDireccion}
                                                    onChange={e => setNewDireccion(e.target.value)}
                                                    className="w-full p-2.5 border border-zinc-700 rounded-lg text-sm bg-brand-dark text-zinc-200 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-brand-cyan/30"
                                                />
                                                <div className="grid grid-cols-2 gap-3">
                                                    <CustomSelect
                                                        value={newCiudad}
                                                        onChange={(val) => {
                                                            setNewCiudad(val);
                                                            // Auto-seleccionar si hay una sola localidad
                                                            const dept = shippingData.departamentos?.find(d => d.Nombre === val);
                                                            const locs = dept ? shippingData.localidades?.filter(l => l.DepartamentoID === dept.ID) : [];
                                                            setNewLocalidad(locs?.length === 1 ? locs[0].Nombre : '');
                                                        }}
                                                        options={[
                                                            { value: '', label: 'Departamento...' },
                                                            ...(shippingData.departamentos?.map(d => ({ value: d.Nombre, label: d.Nombre })) || [])
                                                        ]}
                                                        placeholder="Departamento..."
                                                        size="small"
                                                        direction="up"
                                                    />
                                                    <CustomSelect
                                                        value={newLocalidad}
                                                        onChange={(val) => setNewLocalidad(val)}
                                                        options={[
                                                            { value: '', label: 'Localidad...' },
                                                            ...(() => {
                                                                const dept = shippingData.departamentos?.find(d => d.Nombre === newCiudad);
                                                                if (!dept) return [];
                                                                return shippingData.localidades?.filter(l => l.DepartamentoID === dept.ID).map(l => ({ value: l.Nombre, label: l.Nombre })) || [];
                                                            })()
                                                        ]}
                                                        placeholder="Localidad..."
                                                        size="small"
                                                        direction="up"
                                                        disabled={!newCiudad}
                                                    />
                                                </div>
                                                <div className="flex gap-2">
                                                    <CustomButton onClick={handleAddAddress} variant="primary" className="text-sm py-2 px-4 !bg-transparent !text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5" whileHover={{ scale: 1 }} whileTap={{ scale: 1 }}>
                                                        Guardar
                                                    </CustomButton>
                                                    <button onClick={() => { setShowAddAddress(false); setNewAlias(''); setNewDireccion(''); setNewCiudad(''); setNewLocalidad(''); }} className="text-sm text-zinc-500 hover:text-zinc-300">
                                                        Cancelar
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Aviso de dirección requerida */}
                {needsAddress && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-brand-gold/10 border border-brand-gold/30 text-brand-gold text-sm font-semibold">
                        <AlertCircle size={16} />
                        {needsDeptLoc
                            ? 'Seleccioná departamento y localidad para la dirección principal.'
                            : 'Seleccioná o agregá una dirección de envío para continuar.'
                        }
                    </div>
                )}

                {/* Botones finales */}
                <div className={`flex ${(user?.tipoClienteId === 1 && totalAmount > 0) ? 'justify-end' : 'justify-between'} items-stretch gap-3`}>
                    {/* "Pagar después" — solo para cuentas corrientes (tipo 2 y 3) */}
                    {(user?.tipoClienteId === 2 || user?.tipoClienteId === 3) && (
                        <CustomButton
                            onClick={async () => {
                                const code = await handleCreatePickup();
                                if (!code) return;
                                setConfirmedWithoutPayment(true);
                                setStep('success');
                                sessionStorage.removeItem('pickup_selected');
                                sessionStorage.removeItem('pickup_code');
                            }}
                            isLoading={loading}
                            disabled={loading || !selectedFormaEnvio || needsAddress || needsReceiverName || (isEncomienda && user?.tipoClienteId !== 2)}
                            variant="secondary"
                            icon={PackageCheck}
                            className="w-1/2 md:w-auto !bg-custom-dark !text-zinc-400 hover:!text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5"
                            whileHover={{ scale: 1 }}
                            whileTap={{ scale: 1 }}
                        >
                            Pagar después
                        </CustomButton>
                    )}

                    {/* "Confirmar Retiro" — para tipo 1 cuando totalAmount === 0 (órdenes ya pagadas) */}
                    {user?.tipoClienteId === 1 && totalAmount === 0 && (
                        <CustomButton
                            onClick={async () => {
                                const code = await handleCreatePickup();
                                if (!code) return;
                                setConfirmedWithoutPayment(false);
                                setStep('success');
                                sessionStorage.removeItem('pickup_selected');
                                sessionStorage.removeItem('pickup_code');
                            }}
                            isLoading={loading}
                            disabled={loading || !selectedFormaEnvio || needsAddress || needsReceiverName}
                            variant="primary"
                            icon={PackageCheck}
                            className="w-full md:w-auto !bg-custom-dark !text-zinc-400 hover:!text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5"
                            whileHover={{ scale: 1 }}
                            whileTap={{ scale: 1 }}
                        >
                            Confirmar Retiro
                        </CustomButton>
                    )}

                    {totalAmount > 0 && (
                        <CustomButton
                            onClick={() => setShowPayModal(true)}
                            isLoading={loading}
                            disabled={loading || !selectedFormaEnvio || needsAddress || needsReceiverName}
                            variant="primary"
                            icon={CreditCard}
                            className={`${user?.tipoClienteId === 1 ? 'w-full' : 'w-1/2'} md:w-auto !bg-custom-dark !text-zinc-400 hover:!text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5`}
                            whileHover={{ scale: 1 }}
                            whileTap={{ scale: 1 }}
                        >
                            Pagar ahora
                        </CustomButton>
                    )}

                    {/* ── Modal selector de pasarela de pago ── */}
                    {showPayModal && createPortal(
                        <>
                            <style>{`
                            @keyframes slideUp {
                                from { transform: translateY(40px); opacity: 0; }
                                to   { transform: translateY(0);    opacity: 1; }
                            }
                            @keyframes fadeInModal {
                                from { opacity: 0; transform: scale(0.96); }
                                to   { opacity: 1; transform: scale(1); }
                            }
                            .pay-modal-overlay {
                                position: fixed; inset: 0; z-index: 9999;
                                background: rgba(0,0,0,0.88);
                                display: flex; align-items: stretch;
                                height: 100dvh; height: 100vh;
                            }
                            .pay-modal-box {
                                background: linear-gradient(160deg, #1c1c1e, #141414);
                                border: none;
                                border-radius: 0;
                                padding: 28px 24px 40px;
                                width: 100%; height: 100%;
                                display: flex; flex-direction: column;
                                animation: slideUp 0.3s cubic-bezier(0.32, 0.72, 0, 1) both;
                            }
                            .pay-modal-btns {
                                display: flex;
                                flex-direction: column;
                                align-items: center;
                                justify-content: center;
                                gap: 14px;
                                flex: 1;
                                margin-top: 8px;
                            }
                            .pay-modal-btns button { height: 30svh; aspect-ratio: 1; flex: unset; }
                            @media (min-width: 600px) {
                                .pay-modal-overlay {
                                    align-items: center;
                                    justify-content: center;
                                    padding: 16px;
                                    background: rgba(0,0,0,0.72);
                                }
                                .pay-modal-box {
                                    border-radius: 20px;
                                    max-width: 420px;
                                    height: auto;
                                    padding: 32px 28px;
                                    display: block;
                                    box-shadow: 0 8px 32px rgba(0,0,0,0.35);
                                    animation: fadeInModal 0.22s ease both;
                                }
                                .pay-modal-btns {
                                    display: flex;
                                    flex-direction: row;
                                    justify-content: center;
                                    gap: 14px;
                                    flex: unset; margin-top: 0;
                                }
                                .pay-modal-btns button { flex: 1; height: 140px; aspect-ratio: unset; }
                            }
                        `}</style>
                            <div
                                className="pay-modal-overlay"
                                onClick={() => setShowPayModal(false)}
                            >
                                <div
                                    className="pay-modal-box"
                                    onClick={e => e.stopPropagation()}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                                        <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>
                                            Elegí cómo pagar
                                        </p>
                                        <button
                                            onClick={() => setShowPayModal(false)}
                                            style={{
                                                background: 'rgba(255,255,255,0.08)',
                                                border: '1px solid rgba(255,255,255,0.15)',
                                                borderRadius: 10, padding: '8px 10px',
                                                cursor: 'pointer', display: 'flex',
                                                alignItems: 'center', color: 'rgba(255,255,255,0.7)',
                                                transition: 'background 0.2s, color 0.2s',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.18)'; e.currentTarget.style.color = '#fff'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; e.currentTarget.style.color = 'rgba(255,255,255,0.7)'; }}
                                        >
                                            <X size={20} />
                                        </button>
                                    </div>
                                    <h2 style={{ color: '#fff', fontWeight: 800, fontSize: 20, margin: '0 0 10px 0' }}>
                                        Método de pago
                                    </h2>

                                    <div className="pay-modal-btns">
                                        {/* ── Botón Handy ── */}
                                        <button
                                            onClick={() => { setShowPayModal(false); handleInitPayment(); }}
                                            disabled={loading}
                                            style={{
                                                display: 'flex', flexDirection: 'column',
                                                alignItems: 'center', justifyContent: 'center',
                                                gap: 12, padding: '24px 16px',
                                                background: '#722efa',
                                                border: '1px solid rgba(114,46,250,0.6)',
                                                borderRadius: 16, cursor: 'pointer',
                                                transition: 'background 0.2s, transform 0.15s',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = '#5e1fe8'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = '#722efa'; e.currentTarget.style.transform = 'scale(1)'; }}
                                        >
                                            <img src={handyLogo} alt="Handy" style={{ height: 40, objectFit: 'contain', maxWidth: '100%' }} />
                                            <div style={{ textAlign: 'center' }}>
                                                <p style={{ color: '#fff', fontWeight: 700, fontSize: 14, margin: '0 0 2px' }}>Handy</p>
                                                <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, margin: 0, lineHeight: 1.4 }}>Tarjeta crédito / débito</p>
                                            </div>
                                        </button>

                                        {/* ── Botón MercadoPago ── */}
                                        <button
                                            onClick={() => { setShowPayModal(false); handleInitMpPayment(); }}
                                            disabled={loading}
                                            style={{
                                                display: 'flex', flexDirection: 'column',
                                                alignItems: 'center', justifyContent: 'center',
                                                gap: 12, padding: '24px 16px',
                                                background: '#ffe600',
                                                border: '1px solid rgba(255,230,0,0.6)',
                                                borderRadius: 16, cursor: 'pointer',
                                                transition: 'background 0.2s, transform 0.15s',
                                            }}
                                            onMouseEnter={e => { e.currentTarget.style.background = '#e6cf00'; e.currentTarget.style.transform = 'scale(1.02)'; }}
                                            onMouseLeave={e => { e.currentTarget.style.background = '#ffe600'; e.currentTarget.style.transform = 'scale(1)'; }}
                                        >
                                            <img src={mpLogo} alt="MercadoPago" style={{ height: 40, objectFit: 'contain', maxWidth: '100%' }} />
                                            <div style={{ textAlign: 'center' }}>
                                                <p style={{ color: '#1a1a1a', fontWeight: 700, fontSize: 14, margin: '0 0 2px' }}>MercadoPago</p>
                                                <p style={{ color: 'rgba(0,0,0,0.55)', fontSize: 11, margin: 0, lineHeight: 1.4 }}>Saldo, tarjeta o cuotas</p>
                                            </div>
                                        </button>
                                    </div>

                                    {/* Nota de seguridad */}
                                    <div style={{
                                        marginTop: 20,
                                        padding: '10px 14px',
                                        borderRadius: 10,
                                        background: 'rgba(255,255,255,0.04)',
                                        border: '1px solid rgba(255,255,255,0.08)',
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: 8,
                                    }}>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>
                                        <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11, margin: 0, lineHeight: 1.5 }}>
                                            Tus datos de tarjeta son procesados directamente por Handy o MercadoPago. USER no almacena ni accede a información financiera de ningún tipo.
                                        </p>
                                    </div>

                                </div>
                            </div>
                        </>
                        , document.body)}
                </div>
            </div>
        );
    }

    // ========================
    // STEP: SELECTION (default)
    // ========================
    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex items-center gap-3 mb-2">
                <Package size={48} strokeWidth={1} className="text-brand-gold" />
                <div>
                    <h2 className="text-lg font-bold text-zinc-300 uppercase">Gestión de <span className="text-custom-cyan">Retiros</span></h2>
                    <p className="text-zinc-500 uppercase text-xs">Selecciona las órdenes que deseas retirar.</p>
                </div>
            </div>

            {isBloqueado && (
                <div className="flex items-start gap-4 bg-red-950/40 border border-red-700/60 rounded-2xl px-5 py-4">
                    <ShieldX size={36} strokeWidth={1.5} className="text-red-400 shrink-0 mt-0.5" />
                    <div>
                        <p className="text-red-300 font-bold text-sm uppercase tracking-wide">Cuenta bloqueada</p>
                        <p className="text-red-400/80 text-xs mt-1 leading-relaxed">
                            Tu cuenta está actualmente bloqueada y no podés crear retiros.
                            Por favor, contactanos para regularizar tu situación.
                        </p>
                    </div>
                </div>
            )}

            {readyOrders.length === 0 ? (
                <div className="p-8 text-center text-zinc-500">
                    <PackageOpen size={48} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm font-medium">No hay órdenes disponibles para retiro</p>
                    <p className="text-xs text-zinc-600 mt-1">Cuando tus órdenes estén listas, aparecerán aquí.</p>
                </div>
            ) : (
                <>
                    <div className="overflow-hidden rounded-xl shadow-lg shadow-black/20">
                        {/* Desktop: Tabla */}
                        <div className="hidden md:block">
                            <table className="w-full text-left border-collapse">
                                <thead className="bg-custom-dark border-b border-zinc-700">
                                    <tr>
                                        <th className="py-4 px-4 w-14 text-center">
                                            <div
                                                className="flex items-center justify-center cursor-pointer text-blue-400"
                                                onClick={() => {
                                                    if (selectedOrders.length === readyOrders.length) {
                                                        setSelectedOrders([]);
                                                    } else {
                                                        const firstCurrency = readyOrders[0]?.currency;
                                                        const allSameCurrency = readyOrders.every(o => o.currency === firstCurrency);
                                                        if (allSameCurrency) {
                                                            setSelectedOrders(readyOrders.map(o => o.id));
                                                        } else {
                                                            Swal.fire({ toast: true, position: 'top', icon: 'warning', title: 'Hay órdenes en distintas monedas. Seleccionalas manualmente.', showConfirmButton: false, timer: 3000, background: '#212121', color: '#e4e4e7', customClass: { popup: 'rounded-xl border border-zinc-700' } });
                                                        }
                                                    }
                                                }}
                                            >
                                                {readyOrders.length > 0 && selectedOrders.length === readyOrders.length ? (
                                                    <CheckCircle size={22} />
                                                ) : (
                                                    <div className="w-[22px] h-[22px] rounded-full border-2 border-white/20" />
                                                )}
                                            </div>
                                        </th>
                                        <th className="p-4 text-xs font-bold text-zinc-100 uppercase tracking-wider text-center">Orden ID</th>
                                        <th className="p-4 text-xs font-bold text-zinc-100 uppercase tracking-wider">Descripción</th>
                                        <th className="p-4 text-xs font-bold text-zinc-100 uppercase tracking-wider text-center">Producto</th>
                                        <th className="p-4 text-xs font-bold text-zinc-100 uppercase tracking-wider text-center">Cantidad</th>
                                        <th className="p-4 text-xs font-bold text-zinc-100 uppercase tracking-wider text-center">Fecha</th>
                                        <th className="p-4 pr-6 text-xs font-bold text-zinc-100 text-right uppercase tracking-wider">Importe</th>
                                        {/* <th className="p-4 text-sm font-bold text-zinc-100 text-center">Estado</th> */}
                                    </tr>
                                </thead>
                                <tbody>
                                    {readyOrders.map((order, idx) => (
                                        <tr
                                            key={`${order.id}-${idx}`}
                                            onClick={() => handleToggleOrder(order.id)}
                                            className={`border-b border-zinc-800 transition-all cursor-pointer ${selectedOrders.includes(order.id) ? 'bg-[#1a2c30] shadow-[inset_3px_0_0_#006E97]' : 'bg-brand-dark hover:bg-[#1a1a1a]'}`}
                                        >
                                            <td className="py-4 px-4 border-r border-zinc-800">
                                                <div className="flex items-center justify-center h-full text-blue-400">
                                                    {selectedOrders.includes(order.id) ? (
                                                        <CheckCircle size={22} />
                                                    ) : (
                                                        <div className="w-[22px] h-[22px] rounded-full border-2 border-white/20" />
                                                    )}
                                                </div>
                                            </td>
                                            <td className="p-4 font-black text-base text-custom-cyan border-r border-zinc-800 text-center">{order.id}</td>
                                            <td className="p-4 text-sm text-zinc-300 border-r border-zinc-800">{order.desc}</td>
                                            <td className="p-4 text-sm text-zinc-400 border-r border-zinc-800 text-center">{order.article || '-'}</td>
                                            <td className="p-4 text-sm text-zinc-400 border-r border-zinc-800 text-center">{order.quantityStr || order.quantity || '-'}</td>
                                            <td className="p-4 text-sm text-zinc-400 border-r border-zinc-800 text-center">{order.date}</td>
                                            <td className="p-4 pr-6 text-right font-medium">
                                                {order.isPaid ? (
                                                    <span className="text-green-400 flex items-center justify-end gap-1">
                                                        <CheckCircle size={14} /> Pagado
                                                    </span>
                                                ) : (
                                                    <span className="text-custom-cyan">{`${order.currency === 'USD' ? 'US$' : '$'} ${(order.amount || 0).toFixed(2)}`}</span>
                                                )}
                                            </td>
                                            {/* <td className="p-4 text-center">
                                        <span className={`text-xs px-3 py-1 rounded-full font-bold ${order.isPaid ? 'text-green-400' : 'text-custom-cyan'}`}>
                                            {order.status}
                                        </span>
                                    </td> */}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Mobile: Cards */}
                        <div className="md:hidden space-y-3">
                            {readyOrders.map((order, idx) => (
                                <div
                                    key={`mobile-${order.id}-${idx}`}
                                    onClick={() => handleToggleOrder(order.id)}
                                    className={`overflow-hidden rounded-xl border transition-all pt-3 px-4 pb-4 space-y-3 cursor-pointer ${selectedOrders.includes(order.id) ? 'bg-[#1a2c30] border-brand-cyan/30' : 'bg-brand-dark border-zinc-800 hover:border-zinc-700'}`}
                                >
                                    {/* Header row */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-base font-black text-custom-cyan uppercase tracking-tight">{order.id}</span>
                                        {order.isPaid ? (
                                            <span className="px-2 py-0.5 bg-green-900/30 text-green-400 text-[10px] font-bold uppercase tracking-wider rounded-full border border-green-700/40">
                                                Pagado
                                            </span>
                                        ) : (
                                            <span className="px-2 py-0.5 bg-cyan-900/30 text-cyan-400 text-[10px] font-bold uppercase tracking-wider rounded-full border border-cyan-700/40">
                                                Disponible para retiro
                                            </span>
                                        )}
                                        <span className="text-xs text-zinc-500">{order.date}</span>
                                    </div>

                                    {/* Description full width */}
                                    <div className="bg-custom-dark p-3 rounded-lg border border-zinc-800">
                                        <div className="flex justify-between text-sm">
                                            <span className="text-zinc-400 truncate mr-3">{order.desc}</span>
                                            <span className="font-bold text-custom-cyan shrink-0">
                                                {order.currency === 'USD' ? 'US$' : '$'} {(order.amount || 0).toFixed(2)}
                                            </span>
                                        </div>
                                    </div>

                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="mt-3 border-t border-zinc-800">
                        <p className="text-sm text-zinc-500 px-4 pt-3">
                            <span className="font-bold text-zinc-200">{selectedOrders.length}</span> órdenes seleccionadas
                        </p>
                        <div className="flex items-center justify-between gap-3 p-4">
                            <div>
                                <p className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Total</p>
                                <p className="text-lg font-black text-zinc-100">
                                    <span className="text-xs text-zinc-500 mr-1">{activeCurrency === 'USD' ? 'US$' : '$'}</span>
                                    {(totalAmount || 0).toFixed(2)}
                                </p>
                            </div>

                            <CustomButton
                                onClick={async () => {
                                    setLoadingShipping(true);
                                    try {
                                        const res = await apiClient.get('/web-orders/shipping-data');
                                        if (res.success) {
                                            setShippingData(res.data);
                                            setSelectedFormaEnvio(null);
                                            setSelectedAgencia(res.data.defaultAgenciaID || res.data.agencias[0]?.ID);
                                            setSelectedDireccion(res.data.defaultDireccion || '');
                                        }
                                    } catch (e) {
                                        console.error('Error cargando datos de envío:', e);
                                    }
                                    setLoadingShipping(false);
                                    setStep('confirmation');
                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                }}
                                disabled={selectedOrders.length === 0}
                                isLoading={loading || loadingShipping}
                                variant="primary"
                                icon={ChevronRight}
                                className="w-1/2 md:w-auto !bg-transparent !text-zinc-400 hover:!text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5"
                                whileHover={{ scale: 1 }}
                                whileTap={{ scale: 1 }}
                            >
                                Crear Retiro
                            </CustomButton>
                        </div>
                    </div>

                </>
            )}

            {user?.hasCredit && (
                <div className="flex items-center gap-3 p-4 bg-green-50 text-green-800 rounded-lg border border-green-200">
                    <CheckCircle size={20} />
                    <p className="text-sm">Tu cuenta corriente está habilitada. Puedes retirar sin pago inmediato.</p>
                </div>
            )}
        </div>
    );
};
