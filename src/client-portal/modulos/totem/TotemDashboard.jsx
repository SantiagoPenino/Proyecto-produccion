import React, { useState, useEffect, useRef } from 'react';
import { Package, RefreshCw, CheckCircle, Search, ArrowLeft, Delete, Check, Bell, Megaphone, QrCode, CreditCard, Loader2, XCircle, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Logo } from '../../../components/Logo';
import Swal from 'sweetalert2';
import Lottie from 'lottie-react';
import confettiAnim from '../../../assets/animations/confetti.json';
import { totemHeaders, totemPosHeaders } from './totemAuth';
import { QRCodeSVG } from 'qrcode.react';
import handyLogo from '../../../assets/images/pasarelas/handy.svg';
import mpLogo from '../../../assets/images/pasarelas/mercadopago.svg';
import { imprimirTicketCfe } from './ticketCfe';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const BASE_PREFIXES = ['SB', 'SUB', 'DF', 'DTF', 'UVDF', 'ECOUV', 'EUV', 'TWC', 'COR', 'EMB', 'TP', 'TPU', 'IMD', 'DIR', 'PRO', 'VEN', 'DEV'];

// Print ticket (80mm thermal - same technique as PrintStationPage)
const printTotemTicket = ({ ordenRetiro, client, orders, title = 'COMPROBANTE DE RETIRO' }) => {
    const fecha = new Date().toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
    const ordenesHTML = orders.map(o =>
        `<tr><td style="padding:2px 0;font-size:11px">${o.id || '-'}</td></tr>`
    ).join('');
    const ticketBody = `
    <div class="center header">USER</div>
    <div class="center" style="font-size:11px;margin-bottom:4px;font-weight:bold;">${title}</div>
    <div class="line"></div>
    <div class="center retiro-id">${ordenRetiro || 'N/A'}</div>
    <div class="line"></div>
    <table>
        <tr><td>Cliente:</td><td>${client?.company || client?.name || '-'}</td></tr>
        <tr><td>Fecha:</td><td>${fecha}</td></tr>
    </table>
    <div class="line"></div>
    ${orders.length > 0 ? `
    <div style="margin:3px 0;font-size:13px;">ÓRDENES:</div>
    <table>${ordenesHTML}</table>
    <div class="line"></div>` : ''}`;

    const html = `<!DOCTYPE html>
<html><head><style>
    @page { margin: 0; size: 80mm auto; }
    * { margin: 0; padding: 0; box-sizing: border-box; font-weight: bold; }
    body { font-family: 'Courier New', monospace; width: 80mm; padding: 4mm; font-size: 14px; font-weight: bold; }
    .center { text-align: center; }
    .line { border-top: 2px dashed #000; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; font-weight: bold; padding: 2px 0; }
    .header { font-size: 18px; font-weight: 900; letter-spacing: 2px; }
    .retiro-id { font-size: 22px; font-weight: 900; margin: 6px 0; }
</style></head><body>
  ${ticketBody}
</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.top = '-9999px';
    iframe.style.left = '-9999px';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    iframe.contentWindow.focus();
    iframe.contentWindow.print();

    // Limpiar iframe después de imprimir
    setTimeout(() => document.body.removeChild(iframe), 3000);
};

// Cobro con tarjeta (POSLink): estados en los que se cobró, en los que no, y en los que no se sabe.
// Botón «Tarjeta» (POS de Resonet) APAGADO hasta tener las credenciales de producción (16/10/2026): el
// código del cobro con tarjeta se deploya igual. Para prenderlo, poner true y hacer el build.
const TARJETA_EN_TOTEM = false;
// Botón «Mercado Pago» (QR) APAGADO hasta probarlo de punta a punta con un pago real (16/10/2026). Para
// prenderlo, poner true y hacer el build.
const MP_EN_TOTEM = false;

const POS_SIN_COBRO = ['RECHAZADA', 'CANCELADA', 'ERROR_VALIDACION', 'REVERSADA'];
// REVERSA_PENDIENTE: el POS tomó la tarjeta y no respondió; la reversa puede tardar hasta 24 h y mientras
// tanto el retiro sigue bloqueado para otro cobro. Para el cliente es "no vuelvas a pagar, andá a la caja".
const POS_EN_DUDA = ['INDETERMINADA', 'APROBADA_SIN_REGISTRAR', 'PENDIENTE_BILLETERA', 'PEDIR_AUTORIZACION', 'REVERSA_PENDIENTE'];
const terminoParaElTotem = (c) => !!c && (c.final || POS_EN_DUDA.includes(c.estado));
const monedaDe = (c) => (/US|U\$|USD/i.test(String(c || '')) ? 'USD' : 'UYU');
const fmtImporte = (moneda, n) => `${moneda === 'USD' ? 'US$' : '$'} ${Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// e-Ticket con QR (INF-SIS-2026-18): después del pago el backend lo manda solo a DGI y el tótem
// pregunta cada 2 s si ya tiene CAE. Pasado este tiempo no se imprime: no hay papel fiscal sin CAE.
const ESPERA_ETICKET_MS = 20000;

const AvisoETicket = ({ estado }) => {
    if (estado === 'esperando') return <p className="text-lg text-white/50 flex items-center gap-2"><Loader2 size={18} className="animate-spin" /> Imprimiendo tu e-Ticket…</p>;
    if (estado === 'impreso') return <p className="text-lg text-white/60">Llevate también tu e-Ticket.</p>;
    if (estado === 'no_listo') return <p className="text-lg text-white/60 max-w-2xl">Tu e-Ticket todavía no está listo. Si lo necesitás, pedilo en la caja.</p>;
    return null;
};

export const TotemDashboard = ({ onLogout, onOcupado }) => {
    // Search state
    const [externalMode, setExternalMode] = useState(''); // '' | 'X' | 'R'
    const [prefix, setPrefix] = useState('');
    const [number, setNumber] = useState('');
    const [searching, setSearching] = useState(false);

    const Toast = Swal.mixin({
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 3000,
        timerProgressBar: true,
        background: '#212121',
        color: '#f4f4f5',
        customClass: { popup: 'border border-[#00bcd4]/40 !rounded-xl', title: 'uppercase' },
        showClass: { popup: 'swal2-noanimation', backdrop: 'swal2-noanimation' },
        hideClass: { popup: '', backdrop: '' },
    });

    // Announce mode state
    const [announceMode, setAnnounceMode] = useState(false);
    const [announceNumber, setAnnounceNumber] = useState('');
    const [announcing, setAnnouncing] = useState(false);
    const [announceSuccess, setAnnounceSuccess] = useState(null); // { client, ordenRetiro }

    // Results state
    const [client, setClient] = useState(null);
    const [orders, setOrders] = useState([]);
    const [selectedOrders, setSelectedOrders] = useState([]);
    const [creating, setCreating] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState('');

    // ── Cobro con tarjeta en el POS de este tótem ─────────────────────────────
    // posInfo: { terminal } si este equipo tiene POS habilitado (clave activada con /totem?pos=…).
    const [posInfo, setPosInfo] = useState(null);
    const [cobro, setCobro] = useState(null);          // estado del cobro que devuelve el backend
    const [retiroPos, setRetiroPos] = useState(null);  // { id, codigo } del retiro que se está cobrando
    const [pagando, setPagando] = useState(false);     // pedido en curso (iniciar / reintentar / cancelar)
    const [sinPosMotivo, setSinPosMotivo] = useState(''); // no se pudo cobrar acá → pagar en la caja
    const ordenesCobroRef = useRef([]);                // órdenes del retiro, para el ticket

    useEffect(() => {
        if (!TARJETA_EN_TOTEM) return;
        fetch(`${API_BASE}/totem-pos/estado`, { headers: totemPosHeaders() })
            .then(r => r.json())
            .then(d => setPosInfo(d?.pos ? { terminal: d.terminal } : null))
            .catch(e => { console.warn('[TÓTEM] No se pudo saber si hay POS:', e?.message); setPosInfo(null); });
    }, []);

    // ── Pago con MercadoPago: el tótem muestra un QR con el link de pago y el cliente paga con el celular ──
    const [mpDisponible, setMpDisponible] = useState(false);
    const [pagoMp, setPagoMp] = useState(null);   // { url, transactionId, retiro, moneda, monto, expiraEnMinutos, estado, desde, aprobadoDesde }
    useEffect(() => {
        if (!MP_EN_TOTEM) return;
        fetch(`${API_BASE}/totem-mp/estado`, { headers: totemHeaders() })
            .then(r => r.json())
            .then(d => setMpDisponible(!!d?.mp))
            .catch(e => { console.warn('[TÓTEM] No se pudo saber si hay MercadoPago:', e?.message); setMpDisponible(false); });
    }, []);
    const mpTermino = !!pagoMp && ['REGISTRADO', 'EN_DUDA'].includes(pagoMp.estado);

    // e-Ticket del pago: null | 'esperando' | 'impreso' | 'no_listo'
    const [eTicket, setETicket] = useState(null);
    const montadoRef = useRef(true);
    useEffect(() => () => { montadoRef.current = false; }, []);

    // Mientras hay un cobro abierto, la sesión no se cierra por inactividad (ver TotemApp).
    const cobroAbierto = (!!cobro && !terminoParaElTotem(cobro)) || (!!pagoMp && !mpTermino);
    const ocupado = cobroAbierto || pagando || eTicket === 'esperando';
    useEffect(() => { onOcupado?.(ocupado); }, [ocupado, onOcupado]);
    useEffect(() => () => onOcupado?.(false), [onOcupado]);

    // Espera el e-Ticket del pago y lo imprime en cuanto DGI lo aceptó. La impresión va diferida y
    // blindada (incidente 03/07): si la impresora falla, el tótem sigue. Devuelve 'impreso' | 'no_listo'.
    const seguirETicket = async (url, headers) => {
        setETicket('esperando');
        const hasta = Date.now() + ESPERA_ETICKET_MS;
        while (montadoRef.current && Date.now() < hasta) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                const d = await (await fetch(url, { headers })).json();
                if (d?.data?.listo && montadoRef.current) {
                    setETicket('impreso');
                    setTimeout(() => {
                        imprimirTicketCfe(d.data.doc, d.data.detalles)
                            .catch(e => console.warn('No se pudo imprimir el e-Ticket del tótem:', e));
                    }, 150);
                    return 'impreso';
                }
                if (d?.data?.sinComprobante) break;
            } catch (e) {
                console.warn('[TÓTEM] Falló la consulta del e-Ticket:', e?.message);
            }
        }
        if (montadoRef.current) setETicket('no_listo');
        return 'no_listo';
    };
    // Después del pago: «RETIRO PAGADO» enseguida, el e-Ticket cuando llegue y recién ahí la salida.
    const cerrarPagado = (urlETicket, headers) => {
        imprimirRetiro('RETIRO PAGADO');
        seguirETicket(urlETicket, headers).then(r => setTimeout(() => {
            if (montadoRef.current) onLogout();
        }, r === 'impreso' ? 8000 : 10000));
    };

    // Poleo cada 2,5 s (entre 2 y 3 s según Resonet) hasta que el cobro termine.
    useEffect(() => {
        if (!cobro?.uuid || terminoParaElTotem(cobro)) return; // lo que quede abierto lo sigue el barrido
        let vivo = true;
        const t = setTimeout(async () => {
            try {
                const r = await fetch(`${API_BASE}/totem-pos/cobros/${cobro.uuid}`, { headers: totemPosHeaders() });
                const d = await r.json();
                if (vivo && d?.data) setCobro(d.data);
                else if (vivo) setCobro(prev => (prev ? { ...prev, reintento: (prev.reintento || 0) + 1 } : prev));
            } catch (e) {
                console.warn('[TÓTEM] Falló la consulta del cobro:', e?.message);
                if (vivo) setCobro(prev => (prev ? { ...prev, reintento: (prev.reintento || 0) + 1 } : prev));
            }
        }, 2500);
        return () => { vivo = false; clearTimeout(t); };
    }, [cobro]);

    // Ticket y salida: una sola vez por resultado.
    const cierreRef = useRef(null);
    const imprimirRetiro = (titulo) => setTimeout(() => {
        try {
            printTotemTicket({ ordenRetiro: retiroPos?.codigo || 'N/A', client, orders: ordenesCobroRef.current, title: titulo });
        } catch (e) { console.warn('No se pudo imprimir el ticket del tótem:', e); }
    }, 150);
    useEffect(() => {
        if (!terminoParaElTotem(cobro) || cierreRef.current === cobro.uuid) return;
        if (cobro.estado === 'REGISTRADA') {
            cierreRef.current = cobro.uuid;
            cerrarPagado(`${API_BASE}/totem-pos/cobros/${cobro.uuid}/cfe`, totemPosHeaders());
        } else if (POS_EN_DUDA.includes(cobro.estado)) {
            cierreRef.current = cobro.uuid;
            imprimirRetiro('RETIRO - CONSULTAR PAGO EN CAJA');
            setTimeout(() => onLogout(), 20000);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cobro]);

    const pagarConTarjeta = async () => {
        if (!selectedOrders.length || pagando) return;
        setPagando(true);
        setError('');
        ordenesCobroRef.current = orders.filter(o => selectedOrders.includes(o.id));
        try {
            const res = await fetch(`${API_BASE}/totem-pos/cobros`, {
                method: 'POST',
                headers: totemPosHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ clientId: client.idCliente, orders: selectedOrders }),
            });
            const data = await res.json();
            if (data?.retiro) setRetiroPos(data.retiro);
            if (data?.success) {
                setCobro(data.data);
            } else if (data?.retiro) {
                // El retiro se creó pero no se pudo cobrar acá: ticket y a la caja, como sin POS.
                setSinPosMotivo(data.error || 'No se pudo cobrar con tarjeta.');
                imprimirRetiroCon(data.retiro, 'COMPROBANTE DE RETIRO');
                setTimeout(() => onLogout(), 12000);
            } else {
                setError(data?.error || 'No se pudo cobrar con tarjeta');
            }
        } catch (e) {
            setError('Error de conexión');
        } finally {
            setPagando(false);
        }
    };
    const imprimirRetiroCon = (retiro, titulo) => setTimeout(() => {
        try {
            printTotemTicket({ ordenRetiro: retiro?.codigo || 'N/A', client, orders: ordenesCobroRef.current, title: titulo });
        } catch (e) { console.warn('No se pudo imprimir el ticket del tótem:', e); }
    }, 150);

    const cancelarCobro = async () => {
        if (!cobro?.uuid) return;
        setPagando(true);
        try {
            const r = await fetch(`${API_BASE}/totem-pos/cobros/${cobro.uuid}/cancelar`, { method: 'POST', headers: totemPosHeaders() });
            const d = await r.json();
            if (d?.data) setCobro(d.data);
        } catch (e) {
            console.warn('[TÓTEM] No se pudo cancelar:', e?.message);
        } finally {
            setPagando(false);
        }
    };

    const reintentarCobro = async () => {
        if (!cobro?.uuid) return;
        setPagando(true);
        try {
            const r = await fetch(`${API_BASE}/totem-pos/cobros/${cobro.uuid}/reintentar`, { method: 'POST', headers: totemPosHeaders() });
            const d = await r.json();
            if (d?.success) setCobro(d.data);
            else setCobro(prev => ({ ...prev, detalle: d?.error || 'No se pudo reintentar.' }));
        } catch (e) {
            setCobro(prev => ({ ...prev, detalle: 'Error de conexión.' }));
        } finally {
            setPagando(false);
        }
    };

    const pagarEnCaja = () => {
        imprimirRetiro('COMPROBANTE DE RETIRO');
        setSinPosMotivo('Pagá en la caja con tu número de retiro.');
        setCobro(null);
        setPagoMp(null);
        setTimeout(() => onLogout(), 10000);
    };

    const pagarConMp = async () => {
        if (!selectedOrders.length || pagando) return;
        setPagando(true);
        setError('');
        ordenesCobroRef.current = orders.filter(o => selectedOrders.includes(o.id));
        try {
            const res = await fetch(`${API_BASE}/totem-mp/pagos`, {
                method: 'POST',
                headers: totemHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ clientId: client.idCliente, orders: selectedOrders }),
            });
            const data = await res.json();
            const retiro = data?.data?.retiro || data?.retiro;
            if (retiro) setRetiroPos(retiro);
            if (data?.success) {
                setPagoMp({ ...data.data, estado: 'PENDIENTE', desde: Date.now(), aprobadoDesde: null });
            } else if (retiro) {
                setSinPosMotivo(data.error || 'No se pudo generar el pago con MercadoPago.');
                imprimirRetiroCon(retiro, 'COMPROBANTE DE RETIRO');
                setTimeout(() => onLogout(), 12000);
            } else {
                setError(data?.error || 'No se pudo generar el pago con MercadoPago');
            }
        } catch (e) {
            setError('Error de conexión');
        } finally {
            setPagando(false);
        }
    };

    // Consulta cada 3 s si MercadoPago avisó el pago y si ya quedó asentado en el retiro.
    useEffect(() => {
        if (!pagoMp?.transactionId || mpTermino) return;
        let vivo = true;
        const t = setTimeout(async () => {
            // Venció el link sin pagar: el retiro queda para la caja, con su ticket.
            if (Date.now() - pagoMp.desde > (pagoMp.expiraEnMinutos || 15) * 60000 && pagoMp.estado !== 'APROBADO') {
                if (vivo) pagarEnCaja();
                return;
            }
            try {
                const r = await fetch(`${API_BASE}/totem-mp/pagos/${pagoMp.transactionId}`, { headers: totemHeaders() });
                const d = await r.json();
                if (!vivo) return;
                const est = d?.data?.estado || pagoMp.estado;
                setPagoMp(prev => {
                    if (!prev) return prev;
                    const aprobadoDesde = est === 'APROBADO' ? (prev.aprobadoDesde || Date.now()) : prev.aprobadoDesde;
                    // Aprobado pero sin asentar al minuto (¿el aviso de MP no llegó?): a la caja, sin volver a pagar.
                    const estado = est === 'APROBADO' && aprobadoDesde && Date.now() - aprobadoDesde > 60000 ? 'EN_DUDA' : est;
                    return { ...prev, estado, aprobadoDesde };
                });
            } catch (e) {
                console.warn('[TÓTEM] Falló la consulta del pago con MercadoPago:', e?.message);
                if (vivo) setPagoMp(prev => (prev ? { ...prev, reintento: (prev.reintento || 0) + 1 } : prev));
            }
        }, 3000);
        return () => { vivo = false; clearTimeout(t); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pagoMp]);

    // Resultado de MercadoPago: ticket y salida, una sola vez.
    const cierreMpRef = useRef(null);
    useEffect(() => {
        if (!pagoMp || !mpTermino || cierreMpRef.current === pagoMp.transactionId) return;
        cierreMpRef.current = pagoMp.transactionId;
        if (pagoMp.estado === 'REGISTRADO') {
            cerrarPagado(`${API_BASE}/totem-mp/pagos/${pagoMp.transactionId}/cfe`, totemHeaders());
        } else {
            imprimirRetiro('RETIRO - CONSULTAR PAGO EN CAJA');
            setTimeout(() => onLogout(), 20000);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pagoMp]);

    const NON_EXTERNAL_PREFIXES = ['PRO', 'VEN', 'DEV'];
    const fullCode = prefix ? `${externalMode && !NON_EXTERNAL_PREFIXES.includes(prefix) ? externalMode : ''}${prefix}-${number}` : number;

    const handlePrefix = (p) => {
        if (NON_EXTERNAL_PREFIXES.includes(p)) setExternalMode('');
        setPrefix(p);

    };

    const handleKey = (key) => {

        if (key === 'DEL') {
            setNumber(prev => prev.slice(0, -1));
        } else if (key === 'CLEAR') {
            setNumber('');
            setPrefix('');
            setExternalMode('');
        } else if (number.length < 10) {
            setNumber(prev => prev + key);
        }
    };

    const handleSearch = async () => {
        if (!prefix || !number) {
            Toast.fire({ icon: 'warning', title: 'Seleccioná un prefijo e ingresá el número' });
            return;
        }
        setSearching(true);

        try {
            const res = await fetch(`${API_BASE}/web-orders/totem-lookup`, {
                method: 'POST',
                headers: totemHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ orderCode: fullCode })
            });
            const data = await res.json();
            if (data.success) {
                setClient(data.client);
                setOrders(data.orders || []);
                setSelectedOrders([]);
            } else {
                Toast.fire({ icon: 'error', title: data.message || 'Orden no encontrada' });
            }
        } catch (err) {
            Toast.fire({ icon: 'error', title: 'Error de conexión' });
        } finally {
            setSearching(false);
        }
    };

    // ── Escaneo del QR del cliente (lector IR del tótem = teclado + Enter) ──────────
    // El QR codifica `${IDCliente}totem`. Al escanear, resolvemos el cliente y mostramos
    // sus órdenes directo (misma pantalla que la búsqueda por N° de orden).
    const handleQrScan = async (raw) => {
        setSearching(true);
        try {
            const res = await fetch(`${API_BASE}/web-orders/totem-lookup-by-client`, {
                method: 'POST',
                headers: totemHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ qr: raw })
            });
            const data = await res.json();
            if (data.success) {
                setClient(data.client);
                setOrders(data.orders || []);
                setSelectedOrders([]);
            } else {
                Toast.fire({ icon: 'error', title: data.message || 'QR no reconocido' });
            }
        } catch (err) {
            Toast.fire({ icon: 'error', title: 'Error de conexión' });
        } finally {
            setSearching(false);
        }
    };

    // Ref al handler (el listener se monta una sola vez y usa siempre la última versión) y
    // un flag "ocupado" para no disparar un escaneo encima de otra acción.
    const scanRef = useRef(handleQrScan);
    scanRef.current = handleQrScan;
    const blockScanRef = useRef(false);
    useEffect(() => {
        // Durante el cobro con tarjeta no se lee otro QR: abriría otra búsqueda encima del cobro.
        blockScanRef.current = searching || creating || announcing || success || !!announceSuccess || !!cobro || pagando || !!sinPosMotivo || !!pagoMp;
    }, [searching, creating, announcing, success, announceSuccess, cobro, pagando, sinPosMotivo, pagoMp]);

    // Lector IR = teclado: teclea el contenido del QR muy rápido y cierra con Enter.
    // Acumulamos ráfagas de teclas físicas (el teclado en pantalla usa clicks, no keydown,
    // así que esto NO interfiere con el ingreso manual).
    useEffect(() => {
        let buffer = '';
        let lastTs = 0;
        const onKeyDown = (e) => {
            const now = e.timeStamp || 0;
            if (now - lastTs > 120) buffer = ''; // gap grande → arranca ráfaga nueva
            lastTs = now;
            if (e.key === 'Enter') {
                const scanned = buffer.trim();
                buffer = '';
                if (scanned.length >= 3 && !blockScanRef.current) scanRef.current(scanned);
                return;
            }
            if (e.key && e.key.length === 1) buffer += e.key;
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);

    // Escape del kiosco (staff): combo secreto → prefijo SUB + "0" en el input, y mantener
    // presionada la caja del número 3 segundos → sale de pantalla completa. Sin PIN, sin UI visible.
    const escPressRef = useRef(null);
    const startEscapePress = () => {
        if (prefix !== 'SUB' || number !== '0') return;
        escPressRef.current = setTimeout(() => {
            if (document.fullscreenElement && document.exitFullscreen) {
                document.exitFullscreen().catch(() => {});
            }
            try { window.close(); } catch { /* solo cierra si la abrió un script */ }
        }, 3000);
    };
    const cancelEscapePress = () => {
        if (escPressRef.current) { clearTimeout(escPressRef.current); escPressRef.current = null; }
    };

    const handleBack = () => {
        setClient(null);
        setOrders([]);
        setSelectedOrders([]);
        setError('');
        setNumber('');
        setPrefix('');
        setExternalMode('');
    };

    // Hermanas multitela: 'SUB-5936 (1/2)' y 'SUB-5936 (2/2)' comparten el código base →
    // tocar una selecciona/deselecciona el pedido completo, para que se retire junto.
    const baseDe = (id) => String(id || '').replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();

    const toggleOrder = (id) => {
        const grupo = orders.filter(o => baseDe(o.id) === baseDe(id)).map(o => o.id);
        setSelectedOrders(prev => {
            const todasSel = grupo.every(g => prev.includes(g));
            return todasSel
                ? prev.filter(x => !grupo.includes(x))
                : [...new Set([...prev, ...grupo])];
        });
    };

    const selectAll = () => {
        setSelectedOrders(
            selectedOrders.length === orders.length ? [] : orders.map(o => o.id)
        );
    };

    const createPickup = async () => {
        if (selectedOrders.length === 0) return;
        setCreating(true);
        setError('');
        try {
            const selected = orders.filter(o => selectedOrders.includes(o.id));
            const totalCost = selected.reduce((sum, o) => sum + (o.amount || 0), 0);

            const res = await fetch(`${API_BASE}/web-orders/totem-create-pickup`, {
                method: 'POST',
                headers: totemHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({
                    orders: selectedOrders,
                    totalCost: totalCost.toFixed(2),
                    lugarRetiro: 5,
                    formaRetiro: 'RT',
                    clientId: client.idCliente
                })
            });
            const data = await res.json();
            if (data.success) {
                const selectedOrdObjects = orders.filter(o => selectedOrders.includes(o.id));
                // Éxito PRIMERO, impresión DESPUÉS (diferida): window.print() es bloqueante —
                // con la impresora offline o el diálogo de impresión abierto, congelaba la UI
                // en "Creando..." con el retiro YA creado en el sistema.
                setSuccess(true);
                setSelectedOrders([]);
                setTimeout(() => { setSuccess(false); onLogout(); }, 8000);
                setTimeout(() => {
                    try {
                        printTotemTicket({
                            ordenRetiro: data.ordIdGenerada || data.ordenRetiro || 'R-' + Date.now(),
                            client,
                            orders: selectedOrdObjects
                        });
                    } catch (e) { console.warn('No se pudo imprimir el ticket del tótem:', e); }
                }, 150);
            } else {
                setError(data.error || 'Error al crear retiro');
            }
        } catch (err) {
            setError('Error de conexión');
        } finally {
            setCreating(false);
        }
    };

    // Announce handlers
    const handleAnnounceKey = (key) => {
        if (key === 'DEL') {
            setAnnounceNumber(prev => prev.slice(0, -1));
        } else if (key === 'CLEAR') {
            setAnnounceNumber('');
        } else if (announceNumber.length < 10) {
            setAnnounceNumber(prev => prev + key);
        }
    };

    const handleAnnounce = async () => {
        if (!announceNumber) {
            Toast.fire({ icon: 'warning', title: 'Ingresá el número de retiro' });
            return;
        }
        setAnnouncing(true);
        try {
            const res = await fetch(`${API_BASE}/web-orders/totem-announce`, {
                method: 'POST',
                headers: totemHeaders({ 'Content-Type': 'application/json' }),
                body: JSON.stringify({ ordenRetiroNum: announceNumber })
            });
            const data = await res.json();
            if (data.success) {
                setAnnounceSuccess({ client: data.client, ordenRetiro: data.ordenRetiro });
                setTimeout(() => { setAnnounceSuccess(null); setAnnounceMode(false); setAnnounceNumber(''); onLogout(); }, 8000);
                // Impresión diferida y blindada (window.print es bloqueante — ver createPickup)
                setTimeout(() => {
                    try {
                        printTotemTicket({
                            ordenRetiro: `R-${data.ordenRetiro}`,
                            client: { name: data.client },
                            orders: [],
                            title: 'ANUNCIO DE RETIRO'
                        });
                    } catch (e) { console.warn('No se pudo imprimir el ticket del tótem:', e); }
                }, 150);
            } else {
                Toast.fire({ icon: 'error', title: data.message || 'Retiro no encontrado' });
            }
        } catch (err) {
            Toast.fire({ icon: 'error', title: 'Error de conexión' });
        } finally {
            setAnnouncing(false);
        }
    };

    // ── Cobro con tarjeta: no se pudo cobrar acá → ticket y a la caja ──
    if (sinPosMotivo) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen text-center gap-4 uppercase relative px-8">
                <Package size={80} strokeWidth={1.5} className="text-custom-cyan" />
                <h2 className="text-4xl font-extrabold text-custom-cyan">¡Retiro creado!</h2>
                {retiroPos?.codigo && <p className="text-3xl font-black text-white">{retiroPos.codigo}</p>}
                <p className="text-xl text-white/70 mt-2 normal-case">{sinPosMotivo}</p>
                <p className="text-base text-white/40 normal-case">Llevate el ticket y pagá en la caja.</p>
            </div>
        );
    }

    // ── Pago con MercadoPago: QR en pantalla ──
    if (pagoMp) {
        const pagado = pagoMp.estado === 'REGISTRADO';
        const enDuda = pagoMp.estado === 'EN_DUDA';
        const aprobado = pagoMp.estado === 'APROBADO';
        const rechazado = pagoMp.estado === 'RECHAZADO';
        return (
            <div className="flex flex-col items-center justify-center min-h-screen text-center gap-5 relative px-8">
                {pagado && (
                    <div className="absolute inset-0 pointer-events-none">
                        <Lottie animationData={confettiAnim} loop={2} style={{ width: '100%', height: '100%' }} />
                    </div>
                )}
                <h2 className={`text-4xl font-extrabold uppercase ${pagado ? 'text-emerald-400' : enDuda ? 'text-amber-400' : 'text-white'}`}>
                    {pagado ? '¡Pago aprobado!' : enDuda ? 'No pudimos confirmar el pago' : aprobado ? 'Pago aprobado, confirmando…' : 'Pagá con Mercado Pago'}
                </h2>
                <p className="text-5xl font-black text-white">{fmtImporte(pagoMp.moneda, pagoMp.monto)}</p>
                {retiroPos?.codigo && <p className="text-lg text-white/50 uppercase">Retiro {retiroPos.codigo}</p>}

                {!pagado && !enDuda && !aprobado && (
                    <>
                        <div className="bg-white p-5 rounded-2xl">
                            <QRCodeSVG value={pagoMp.url} size={300} level="M" />
                        </div>
                        <p className="text-xl text-white/80 max-w-2xl">Escaneá el código con la cámara del celular y pagá desde Mercado Pago.</p>
                        {rechazado
                            ? <p className="text-lg text-red-400 max-w-2xl">El pago fue rechazado. Podés intentar de nuevo desde el celular o pagar en la caja.</p>
                            : <p className="text-sm text-white/30 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Esperando el pago · el código vence en {pagoMp.expiraEnMinutos || 15} minutos</p>}
                        <button onClick={pagarEnCaja}
                            className="mt-2 px-10 py-4 rounded-xl text-lg font-bold bg-white/[0.06] border border-white/15 text-white/70 transition-all active:scale-[0.97] uppercase">
                            Pagar en la caja
                        </button>
                    </>
                )}
                {aprobado && <Loader2 size={64} strokeWidth={1.5} className="text-custom-cyan animate-spin" />}
                {pagado && <p className="text-xl text-white/70">Ya podés retirar: llevate el ticket.</p>}
                {pagado && <AvisoETicket estado={eTicket} />}
                {enDuda && (
                    <p className="text-xl text-white/80 max-w-2xl">
                        Mercado Pago aprobó el pago pero todavía no nos llegó la confirmación. <b>No vuelvas a pagar.</b> Acercate a la caja con el ticket.
                    </p>
                )}
            </div>
        );
    }

    // ── Cobro con tarjeta en curso o con resultado ──
    if (cobro) {
        const sinCobro = POS_SIN_COBRO.includes(cobro.estado);
        const enDuda = POS_EN_DUDA.includes(cobro.estado);
        const pagado = cobro.estado === 'REGISTRADA';
        const cancelable = ['CREADA', 'ENVIADA', 'ESPERANDO_POS'].includes(cobro.estado);
        const titulo = pagado ? '¡Pago aprobado!'
            : enDuda ? 'Hubo un problema con el pago'
            : sinCobro ? 'No se pudo cobrar'
            : cobro.estado === 'CAPTURADA' ? 'Pasá o acercá tu tarjeta al POS'
            : cobro.estado === 'APROBADA' ? 'Aprobado, registrando…'
            : 'Preparando el POS…';
        return (
            <div className="flex flex-col items-center justify-center min-h-screen text-center gap-5 relative px-8">
                {pagado && (
                    <div className="absolute inset-0 pointer-events-none">
                        <Lottie animationData={confettiAnim} loop={2} style={{ width: '100%', height: '100%' }} />
                    </div>
                )}
                {pagado ? <CheckCircle size={88} strokeWidth={1.5} className="text-emerald-400" />
                    : enDuda ? <AlertTriangle size={88} strokeWidth={1.5} className="text-amber-400" />
                    : sinCobro ? <XCircle size={88} strokeWidth={1.5} className="text-red-400" />
                    : cobro.estado === 'CAPTURADA' ? <CreditCard size={88} strokeWidth={1.5} className="text-custom-cyan animate-pulse" />
                    : <Loader2 size={88} strokeWidth={1.5} className="text-custom-cyan animate-spin" />}

                <h2 className={`text-4xl font-extrabold uppercase ${pagado ? 'text-emerald-400' : enDuda ? 'text-amber-400' : sinCobro ? 'text-red-400' : 'text-white'}`}>{titulo}</h2>
                <p className="text-5xl font-black text-white">{fmtImporte(cobro.moneda, cobro.monto)}</p>
                {retiroPos?.codigo && <p className="text-lg text-white/50 uppercase">Retiro {retiroPos.codigo}</p>}

                {pagado && (
                    <p className="text-xl text-white/70">Ya podés retirar: llevate el ticket.{cobro.rebajaIva ? ` Se te descontaron ${fmtImporte(cobro.moneda, cobro.rebajaIva)} de IVA.` : ''}</p>
                )}
                {pagado && <AvisoETicket estado={eTicket} />}
                {enDuda && (
                    <p className="text-xl text-white/80 max-w-2xl">
                        {cobro.estado === 'REVERSA_PENDIENTE'
                            ? 'El POS no respondió a tiempo: si se te debitó, se devuelve solo. '
                            : 'No sabemos si el pago se completó. '}
                        <b>No vuelvas a pagar.</b> Acercate a la caja con el ticket y lo resolvemos.
                    </p>
                )}
                {sinCobro && (
                    <p className="text-lg text-white/60 max-w-2xl">{cobro.estado === 'REVERSADA' ? 'El POS no respondió a tiempo y el pago se anuló. Si se te llegó a debitar, se te devuelve solo (puede tardar hasta 24 h).' : 'No se te cobró nada.'}{cobro.detalle && cobro.estado === 'RECHAZADA' ? ` (${cobro.detalle})` : ''}</p>
                )}
                {!terminoParaElTotem(cobro) && cobro.segundosRestantes > 0 && cobro.estado !== 'APROBADA' && (
                    <p className="text-sm text-white/30">Quedan {cobro.segundosRestantes} s</p>
                )}

                {cancelable && (
                    <button onClick={cancelarCobro} disabled={pagando}
                        className="mt-4 px-10 py-4 rounded-xl text-lg font-bold bg-white/[0.06] border border-white/15 text-white/70 transition-all active:scale-[0.97] disabled:opacity-40 uppercase">
                        {pagando ? 'Cancelando…' : 'Cancelar'}
                    </button>
                )}
                {cobro.estado === 'CAPTURADA' && (
                    <p className="text-sm text-white/30">Para cancelar, usá la tecla roja del POS.</p>
                )}
                {sinCobro && (
                    <div className="mt-6 flex gap-4">
                        <button onClick={reintentarCobro} disabled={pagando}
                            className="px-10 py-4 rounded-xl text-xl font-bold bg-brand-cyan text-white transition-all active:scale-[0.97] disabled:opacity-40 flex items-center gap-3 uppercase">
                            <CreditCard size={24} /> {pagando ? 'Preparando…' : 'Probar de nuevo'}
                        </button>
                        <button onClick={pagarEnCaja} disabled={pagando}
                            className="px-10 py-4 rounded-xl text-xl font-bold bg-white/[0.08] border border-white/15 text-white transition-all active:scale-[0.97] disabled:opacity-40 uppercase">
                            Pagar en la caja
                        </button>
                    </div>
                )}
            </div>
        );
    }

    // Announce success screen
    if (announceSuccess) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen text-center gap-4 uppercase relative">
                <div className="absolute inset-0 pointer-events-none">
                    <Lottie animationData={confettiAnim} loop={2} style={{ width: '100%', height: '100%' }} />
                </div>
                <Megaphone size={80} strokeWidth={1.5} className="text-emerald-400" />
                <h2 className="text-4xl font-extrabold text-emerald-400">¡Te anunciaste!</h2>
                <p className="text-2xl text-white/80 mt-2 font-bold">{announceSuccess.client}</p>
                <p className="text-lg text-white/50">Retiro #{announceSuccess.ordenRetiro}</p>
                <p className="text-base text-white/40 mt-4">Nuestro equipo ya fue notificado.<br />Te atenderán a la brevedad.</p>
            </div>
        );
    }

    // Success screen
    if (success) {
        return (
            <div className="flex flex-col items-center justify-center min-h-screen text-center gap-4 uppercase relative">
                <div className="absolute inset-0 pointer-events-none">
                    <Lottie animationData={confettiAnim} loop={2} style={{ width: '100%', height: '100%' }} />
                </div>
                <CheckCircle size={80} strokeWidth={1.5} className="text-custom-cyan" />
                <h2 className="text-4xl font-extrabold text-custom-cyan">¡Retiro creado!</h2>
                <p className="text-xl text-white/70 mt-2">Nuestro equipo te atenderá a la brevedad.</p>
                <p className="text-sm text-white/30 -mt-2">¡Gracias por tu preferencia!</p>
            </div>
        );
    }

    // Results screen
    if (client) {
        // Sort: searched order first
        const sortedOrders = [...orders].sort((a, b) => {
            if (a.id === fullCode) return -1;
            if (b.id === fullCode) return 1;
            return 0;
        });

        // Lo que falta pagar de lo elegido (el importe que se cobra lo recalcula el servidor).
        const aPagar = orders.filter(o => selectedOrders.includes(o.id) && !o.isPaid && Number(o.amount) > 0);
        const monedasAPagar = [...new Set(aPagar.map(o => monedaDe(o.currency)))];
        const totalAPagar = aPagar.reduce((s, o) => s + Number(o.amount), 0);
        const puedePagarConTarjeta = TARJETA_EN_TOTEM && !!posInfo && aPagar.length > 0 && monedasAPagar.length === 1;
        const puedePagarConMp = MP_EN_TOTEM && mpDisponible && aPagar.length > 0 && monedasAPagar.length === 1;
        const hayPagoEnTotem = puedePagarConTarjeta || puedePagarConMp;

        return (
            <div className="min-h-screen flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between px-8 py-6 border-b border-white/10">
                    <h2 className="text-2xl md:text-3xl font-bold">
                        Hola, {client.company || client.name}
                    </h2>
                    <Logo className="h-10 w-auto text-white mt-2" />
                </div>

                {/* Error */}
                {error && (
                    <div className="mx-auto w-[80%] mt-4 bg-red-500/15 border border-red-500/30 text-red-300 rounded-xl px-4 py-3 text-center text-[15px]">
                        {error}
                    </div>
                )}

                {/* Orders list */}
                <div className="flex-1 overflow-y-auto py-6">
                    {orders.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-white/40 text-lg gap-4">
                            <Package size={48} strokeWidth={1} />
                            <p>No hay órdenes listas para retirar</p>
                            <button
                                className="mt-4 px-8 py-3 rounded-xl text-base font-semibold bg-white/[0.08] border border-white/15 text-white/70 transition-all active:bg-white/[0.15]"
                                onClick={handleBack}
                            >
                                <ArrowLeft size={18} className="inline mr-2" /> Buscar otra orden
                            </button>
                        </div>
                    ) : (
                        <div className="w-[80%] mx-auto flex flex-col gap-2">
                            {/* Select all */}
                            <div
                                className="flex items-center gap-3 px-5 py-3 mb-1 cursor-pointer transition-all border-b border-white/[0.06] hover:text-white/70"
                                onClick={selectAll}
                            >
                                <div className="flex-shrink-0 text-blue-400">
                                    {selectedOrders.length === orders.length && orders.length > 0 ? (
                                        <CheckCircle size={22} />
                                    ) : (
                                        <div className="w-[22px] h-[22px] rounded-full border-2 border-white/20" />
                                    )}
                                </div>
                                <span className="text-sm font-bold text-white/50 uppercase tracking-wider">
                                    Seleccionar todas ({orders.length})
                                </span>
                            </div>

                            <div className="max-h-[50vh] overflow-y-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                            {/* Column headers */}
                            <div className="flex items-center gap-4 px-5 py-2 text-xs font-semibold text-white/30 uppercase tracking-wider">
                                <div className="w-[26px] flex-shrink-0" />
                                <div className="w-36 flex-shrink-0">Orden</div>
                                <div className="flex-1">Descripción</div>
                                <div className="w-24 flex-shrink-0 text-center">Cantidad</div>
                                <div className="w-28 flex-shrink-0 text-right">Importe</div>
                            </div>
                            {sortedOrders.map(order => (
                                <div
                                    key={order.id}
                                    className={`flex items-center gap-4 rounded-xl px-5 py-4 cursor-pointer transition-all active:scale-[0.99] border-2 ${selectedOrders.includes(order.id)
                                        ? 'bg-blue-500/10 border-blue-500/40'
                                        : 'bg-white/[0.05] border-white/[0.08]'
                                        }`}
                                    onClick={() => toggleOrder(order.id)}
                                >
                                    {/* Checkbox */}
                                    <div className="flex-shrink-0 text-blue-400">
                                        {selectedOrders.includes(order.id) ? (
                                            <CheckCircle size={26} />
                                        ) : (
                                            <div className="w-[26px] h-[26px] rounded-full border-2 border-white/20" />
                                        )}
                                    </div>

                                    {/* Order number */}
                                    <div className="w-36 flex-shrink-0">
                                        <span className="text-base font-bold">{order.id}</span>
                                    </div>

                                    {/* Description */}
                                    <div className="flex-1 min-w-0">
                                        <span className="text-sm text-white/60 truncate block">{order.desc}</span>
                                    </div>

                                    {/* Quantity */}
                                    <div className="w-24 flex-shrink-0 text-center">
                                        <span className="text-sm text-white/50">{order.quantity}</span>
                                    </div>

                                    {/* Cost */}
                                    <div className="w-28 flex-shrink-0 text-right">
                                        {order.facturada ? (
                                            // Ya tiene comprobante: no se cobra en el tótem (INF-SIS-2026-14)
                                            <span className="text-sm font-bold text-white/60" title={order.facturada.deudaPendiente ? 'La factura tiene saldo: se paga en caja.' : 'Ya está facturada y paga.'}>
                                                Facturada
                                                {order.facturada.deudaPendiente && <span className="block text-[11px] font-medium text-white/40">Se paga en caja</span>}
                                            </span>
                                        ) : (
                                            <span className="text-base font-bold text-blue-400">
                                                {order.currency} {order.amount.toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            ))}
                            </div>

                            {/* Search another */}
                            <button
                                className="mt-4 self-start flex items-center gap-2 text-sm text-white/30 hover:text-white/50 transition-colors"
                                onClick={handleBack}
                            >
                                <ArrowLeft size={16} /> Buscar otra orden
                            </button>

                            {/* Pagar acá (tarjeta en el POS de este tótem y/o MercadoPago con QR) + Retirar (paga en la caja, como siempre) */}
                            {hayPagoEnTotem && (
                                <div className="mt-6 w-[80%] mx-auto flex gap-4">
                                    {puedePagarConTarjeta && (
                                        <button
                                            className="flex-1 flex items-center justify-center gap-3 px-6 py-4 rounded-xl text-xl font-bold bg-[#722efa] text-white transition-all active:scale-[0.97] disabled:opacity-30 uppercase"
                                            onClick={pagarConTarjeta}
                                            disabled={pagando || creating}
                                        >
                                            {/* Mismos colores y logos que los botones de pago de la tienda del portal */}
                                            <img src={handyLogo} alt="" className="h-7 object-contain" />
                                            {pagando ? 'Preparando…' : `Tarjeta ${fmtImporte(monedasAPagar[0], totalAPagar)}`}
                                        </button>
                                    )}
                                    {puedePagarConMp && (
                                        <button
                                            className="flex-1 flex items-center justify-center gap-3 px-6 py-4 rounded-xl text-xl font-bold bg-[#ffe600] text-[#1a1a1a] transition-all active:scale-[0.97] disabled:opacity-30 uppercase"
                                            onClick={pagarConMp}
                                            disabled={pagando || creating}
                                        >
                                            <img src={mpLogo} alt="" className="h-7 object-contain" />
                                            {pagando ? 'Preparando…' : `Mercado Pago ${fmtImporte(monedasAPagar[0], totalAPagar)}`}
                                        </button>
                                    )}
                                </div>
                            )}
                            <div className={`${hayPagoEnTotem ? 'mt-3 w-[80%]' : 'mt-6 w-1/2'} mx-auto flex`}>
                                <button
                                    className={`flex-1 flex items-center justify-center gap-3 px-8 py-4 rounded-xl text-xl font-bold transition-all active:scale-[0.97] disabled:opacity-30 uppercase ${hayPagoEnTotem
                                        ? 'bg-white/[0.08] border border-white/15 text-white'
                                        : 'bg-brand-cyan text-white'}`}
                                    onClick={createPickup}
                                    disabled={creating || pagando || selectedOrders.length === 0}
                                >
                                    <Package size={24} />
                                    {creating
                                        ? 'Creando...'
                                        : selectedOrders.length > 0
                                            ? (hayPagoEnTotem ? `Retirar y pagar en caja` : `Retirar (${selectedOrders.length})`)
                                            : 'Seleccioná órdenes para retirar'
                                    }
                                </button>
                            </div>
                            {((TARJETA_EN_TOTEM && posInfo) || (MP_EN_TOTEM && mpDisponible)) && aPagar.length > 0 && monedasAPagar.length > 1 && (
                                <p className="mt-3 text-center text-sm text-white/40">Hay órdenes en pesos y en dólares: para pagar acá, elegí las de una sola moneda.</p>
                            )}
                        </div>
                    )}
                </div>
            </div>
        );
    }
    // Search / Announce screen (combined with AnimatePresence for transitions)
    return (
        <div className="flex items-center justify-center min-h-screen p-3">
            {/* Escape del kiosco (staff): zona invisible en la esquina sup-izq. Long-press 3s
                SOLO con el combo secreto (prefijo SUB + "0") → sale de pantalla completa. */}
            <div
                aria-hidden="true"
                className="fixed top-0 left-0 w-16 h-16 z-[9999]"
                onMouseDown={startEscapePress}
                onMouseUp={cancelEscapePress}
                onMouseLeave={cancelEscapePress}
                onTouchStart={startEscapePress}
                onTouchEnd={cancelEscapePress}
                onTouchCancel={cancelEscapePress}
            />
            <AnimatePresence mode="wait">
                {announceMode ? (
                    <motion.div
                        key="announce"
                        initial={{ opacity: 0, y: 30, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.97 }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        className="bg-white/[0.06] border border-white/10 rounded-3xl p-7 w-full max-w-[620px] shadow-2xl"
                    >
                        <div className="text-center mb-6">
                            <Logo className="h-16 w-auto text-white mx-auto mb-3" />
                            <h2 className="text-xl font-bold text-white uppercase">Anunciate con tu número de retiro</h2>
                            <p className="text-white/40 text-xs mt-0.5 uppercase">Ingresá el número que figura en tu comprobante</p>
                        </div>

                        <div className="border-t border-white/10 my-2" />

                        <div className="mb-5 flex items-center gap-2">
                            <div className="text-xl font-bold text-custom-magenta whitespace-nowrap">RW/RT/RL-</div>
                            <div className="flex-1 bg-black/30 border border-custom-magenta/30 rounded-xl px-4 py-2.5 text-center text-xl font-bold tracking-[4px] min-h-[36px] text-white">
                                {announceNumber || <span className="text-white/20 text-lg tracking-tight uppercase">Número...</span>}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mb-5">
                            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLEAR', '0', 'DEL'].map(key => (
                                <button
                                    key={key}
                                    className={`rounded-xl py-2 text-2xl font-semibold border transition-all active:scale-95 flex items-center justify-center ${key === 'CLEAR' || key === 'DEL'
                                        ? 'bg-white/[0.04] border-white/10 text-white/60 text-xl'
                                        : 'bg-white/[0.08] border-white/10 text-white hover:bg-white/[0.12] active:bg-custom-magenta/15 active:border-custom-magenta active:shadow-[0_0_15px_rgba(236,0,140,0.5)]'
                                        }`}
                                    onClick={() => handleAnnounceKey(key)}
                                    disabled={announcing}
                                    style={{ touchAction: 'manipulation' }}
                                >
                                    {key === 'DEL' ? <Delete size={28} /> : key === 'CLEAR' ? 'C' : key}
                                </button>
                            ))}
                        </div>

                        <button
                            className="w-full py-3 rounded-xl text-lg font-bold bg-brand-magenta text-white transition-all active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-2 uppercase"
                            onClick={handleAnnounce}
                            disabled={announcing || !announceNumber}
                        >
                            <Megaphone size={22} />
                            {announcing ? 'Anunciando...' : 'Anunciarme'}
                        </button>

                        <button
                            className="w-full mt-3 py-2.5 rounded-xl text-sm font-bold bg-white/[0.04] border border-white/10 text-white/50 transition-all active:scale-[0.97] hover:bg-white/[0.08] flex items-center justify-center gap-2 uppercase"
                            onClick={() => { setAnnounceMode(false); setAnnounceNumber(''); }}
                        >
                            <ArrowLeft size={16} />
                            Volver a buscar orden
                        </button>
                    </motion.div>
                ) : (
                    <motion.div
                        key="search"
                        initial={{ opacity: 0, y: 30, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -20, scale: 0.97 }}
                        transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
                        className="bg-white/[0.06] border border-white/10 rounded-3xl p-7 w-full max-w-[620px] shadow-2xl"
                    >
                        <div className="text-center mb-6">
                            <h2 className="text-xl font-bold text-white uppercase">Ingresá tu número de orden</h2>
                            <p className="text-white/40 text-xs mt-0.5 uppercase">Seleccioná el prefijo y escribí el número</p>
                            <div className="mt-2 inline-flex items-center gap-2 text-custom-cyan/90 text-xs font-bold uppercase tracking-wide">
                                <QrCode size={16} /> o escaneá tu QR de cliente en el lector
                            </div>
                        </div>

                        <div className="border-t border-white/10 my-2" />
                        <div className="flex items-center gap-4 py-3">
                            <button
                                className={`w-10 py-1.5 rounded-lg text-sm font-bold border-2 transition-all text-center ${externalMode === 'X'
                                    ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                                    : 'bg-white/[0.04] border-white/10 text-white/40'
                                    }`}
                                onClick={() => setExternalMode(externalMode === 'X' ? '' : 'X')}
                            >
                                X
                            </button>
                            <button
                                className={`w-10 py-1.5 rounded-lg text-sm font-bold border-2 transition-all text-center ${externalMode === 'R'
                                    ? 'bg-orange-500/20 border-orange-500/50 text-orange-400'
                                    : 'bg-white/[0.04] border-white/10 text-white/40'
                                    }`}
                                onClick={() => setExternalMode(externalMode === 'R' ? '' : 'R')}
                            >
                                R
                            </button>
                            <button
                                className={`w-10 py-1.5 rounded-lg text-sm font-bold border-2 transition-all text-center ${externalMode === 'RX'
                                    ? 'bg-green-500/20 border-green-500/50 text-green-400'
                                    : 'bg-white/[0.04] border-white/10 text-white/40'
                                    }`}
                                onClick={() => setExternalMode(externalMode === 'RX' ? '' : 'RX')}
                            >
                                RX
                            </button>
                            <span className="text-white/30 text-xs uppercase tracking-tight">Prefijo externo</span>
                            <div className="flex-1" />
                            <Logo className="h-10 w-auto text-white mt-2" />
                            <div className="flex-1" />
                        </div>
                        <div className="border-t border-white/10 my-2" />

                        <div className="grid grid-cols-6 gap-2 mb-5">
                            {BASE_PREFIXES.map(p => (
                                <button
                                    key={p}
                                    className={`py-3 rounded-lg text-sm font-bold border transition-all active:scale-95 ${prefix === p
                                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                                        : 'bg-custom-dark border-white/10 text-white/70 hover:bg-white/[0.1]'
                                        }`}
                                    onClick={() => handlePrefix(p)}
                                >
                                    {externalMode && !NON_EXTERNAL_PREFIXES.includes(p) ? `${externalMode}${p}` : p}
                                </button>
                            ))}
                        </div>

                        <div className="mb-5 flex items-center gap-2">
                            {prefix && (
                                <div className="text-xl font-bold text-blue-400 whitespace-nowrap">
                                    {externalMode && !NON_EXTERNAL_PREFIXES.includes(prefix) ? `${externalMode}${prefix}` : prefix}-
                                </div>
                            )}
                            <div className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2.5 text-center text-xl font-bold tracking-[4px] min-h-[36px] text-white">
                                {number || <span className="text-white/20 text-lg tracking-tight uppercase">{prefix ? 'Ingresá el número...' : 'Seleccioná un prefijo...'}</span>}
                            </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 mb-5">
                            {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'CLEAR', '0', 'DEL'].map(key => (
                                <button
                                    key={key}
                                    className={`rounded-xl py-2 text-2xl font-semibold border transition-all active:scale-95 flex items-center justify-center ${key === 'CLEAR' || key === 'DEL'
                                        ? 'bg-white/[0.04] border-white/10 text-white/60 text-xl'
                                        : 'bg-white/[0.08] border-white/10 text-white hover:bg-white/[0.12] active:bg-custom-cyan/15 active:border-custom-cyan active:shadow-[0_0_15px_rgba(0,188,212,0.5)]'
                                        }`}
                                    onClick={() => handleKey(key)}
                                    disabled={searching}
                                    style={{ touchAction: 'manipulation' }}
                                >
                                    {key === 'DEL' ? <Delete size={28} /> : key === 'CLEAR' ? 'C' : key}
                                </button>
                            ))}
                        </div>

                        <button
                            className="w-full py-2.5 rounded-xl text-lg font-bold bg-brand-cyan text-white transition-all active:scale-[0.97] disabled:opacity-40 flex items-center justify-center gap-2 uppercase"
                            onClick={handleSearch}
                            disabled={searching || !prefix || !number}
                        >
                            <Search size={22} />
                            {searching ? 'Buscando...' : 'Buscar'}
                        </button>

                        <div className="border-t border-white/10 my-4" />

                        <button
                            className="w-full py-3 rounded-xl text-base font-bold bg-custom-magenta/15 border-2 border-custom-magenta/40 text-custom-magenta transition-all active:scale-[0.97] hover:bg-custom-magenta/25 flex items-center justify-center gap-3 uppercase tracking-wide"
                            onClick={() => { setAnnounceMode(true); setAnnounceNumber(''); }}
                        >
                            <Bell size={22} />
                            ¿Tenés orden de retiro? Anunciate aquí
                        </button>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};


