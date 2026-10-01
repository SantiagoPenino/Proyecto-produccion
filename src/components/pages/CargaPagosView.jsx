import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import api, { SOCKET_URL } from '../../services/apiClient';
import { io } from 'socket.io-client';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import {
    DollarSign, CreditCard, Search, X, CheckCircle, AlertTriangle,
    RefreshCw, Loader2, User, Phone, Package, FileText, Filter, ShieldCheck, PackageCheck
} from 'lucide-react';
import { CustomSelect } from '../../client-portal/pautas/CustomSelect';
import { toast } from 'sonner';
import Swal from 'sweetalert2';

const Toast = Swal.mixin({
    toast: true,
    position: 'top-end',
    showConfirmButton: false,
    timer: 3000,
    showClass: { popup: '' },
    hideClass: { popup: '' }
});

export const CargaGestionPagosView = () => {
    const { user } = useAuth();
    const [retiros, setRetiros] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedRetiro, setSelectedRetiro] = useState(null);
    const [formaPago, setFormaPago] = useState('');
    const [moneda, setMoneda] = useState('USD');
    const [monto, setMonto] = useState('');
    const [fileComprobante, setFileComprobante] = useState(null);
    const [metodosPago, setMetodosPago] = useState([]);

    // Cotización
    const [cotizacion, setCotizacion] = useState(null);
    const [cotizacionFecha, setCotizacionFecha] = useState(null);
    const [loadingCotizacion, setLoadingCotizacion] = useState(false);
    const [cotFlash, setCotFlash] = useState(false);
    const [cotSpin, setCotSpin] = useState(0);
    const [isManualCotizacion, setIsManualCotizacion] = useState(false);
    const [manualCotizacion, setManualCotizacion] = useState('');

    // Buscador + Modal
    const [searchTerm, setSearchTerm] = useState('');
    const [searchModal, setSearchModal] = useState(null);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchInput, setSearchInput] = useState('');

    // Filtros
    const [filtroTipoCliente, setFiltroTipoCliente] = useState('1');
    const [incluirSemanales, setIncluirSemanales] = useState(false);
    const [autorizando, setAutorizando] = useState(false);
    const [observacionAutorizo, setObservacionAutorizo] = useState('');
    const [modalAutorizar, setModalAutorizar] = useState(false);

    const [socketInstance, setSocketInstance] = useState(null);

    // Refs to avoid stale closures in socket handlers
    const filtroTipoClienteRef = React.useRef(filtroTipoCliente);
    const incluirSemanalesRef = React.useRef(incluirSemanales);
    React.useEffect(() => { filtroTipoClienteRef.current = filtroTipoCliente; }, [filtroTipoCliente]);
    React.useEffect(() => { incluirSemanalesRef.current = incluirSemanales; }, [incluirSemanales]);

    // ─── SOCKET ───────────────────────────────────────────
    useEffect(() => {
        const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });
        socket.on("connect", () => console.log("Caja conectada a Sockets:", socket.id));
        // Con freno: el server manda los dos avisos juntos y en ráfagas, y /caja es de las consultas más caras.
        socket.on("retiros:update", avisarOrders);
        socket.on("actualizado", avisarOrders);
        setSocketInstance(socket);
        fetchData();
        return () => {
            socket.disconnect();
            if (selectedRetiro) unlockOrder(selectedRetiro.ordenDeRetiro);
        };
    }, []);

    // ─── FETCH ────────────────────────────────────────────
    const fetchOrders = async () => {
        try {
            let url = '/apiordenesRetiro/caja';
            const params = new URLSearchParams();
            const tipo = filtroTipoClienteRef.current;
            const semanales = incluirSemanalesRef.current;
            if (tipo && tipo !== 'todos') params.append('tipoCliente', tipo);
            if (semanales) params.append('incluirSemanales', 'true');
            if (params.toString()) url += '?' + params.toString();

            const resRetiros = await api.get(url);
            const dataRetiros = Array.isArray(resRetiros.data) ? resRetiros.data : (Array.isArray(resRetiros) ? resRetiros : []);
            setRetiros(dataRetiros);
        } catch (e) {
            console.error("Error fetching orders:", e);
        }
    };
    const avisarOrders = useRecargaConFreno(fetchOrders);

    // Refetch cuando cambian filtros
    useEffect(() => { fetchOrders(); }, [filtroTipoCliente, incluirSemanales]);

    const fetchData = async () => {
        setLoading(true);
        try {
            await fetchOrders();
            const [resMetodos, resCotiz] = await Promise.allSettled([
                api.get('/apipagos/metodos'),
                api.get('/apicotizaciones/hoy')
            ]);
            if (resMetodos.status === 'fulfilled') {
                setMetodosPago(Array.isArray(resMetodos.value.data) ? resMetodos.value.data : []);
            }
            if (resCotiz.status === 'fulfilled' && resCotiz.value.data?.cotizaciones?.length > 0) {
                setCotizacion(resCotiz.value.data.cotizaciones[0].CotDolar);
                setCotizacionFecha(new Date());
            } else {
                setCotizacion(null);
            }
        } catch (error) {
            console.error("Error fetching data:", error);
        } finally {
            setLoading(false);
        }
    };

    // ─── COTIZACIÓN: Buscar del banco ─────────────────────
    const handleBuscarCotizacion = async () => {
        if (loadingCotizacion) return;
        setLoadingCotizacion(true);
        try {
            const res = await api.get('/apicotizaciones/bcu');
            if (res.data?.cotizacion) {
                setCotizacion(res.data.cotizacion);
                setCotizacionFecha(new Date());
                setIsManualCotizacion(false);
                setCotFlash(true);
                setTimeout(() => setCotFlash(false), 300);
            } else {
                alert('No se encontró cotización. Ingrese manualmente.');
                setIsManualCotizacion(true);
            }
        } catch {
            alert('Error al consultar BCU. Ingrese manualmente.');
            setIsManualCotizacion(true);
        } finally {
            setLoadingCotizacion(false);
        }
    };

    const handleSetManualCotizacion = async () => {
        if (!manualCotizacion || isNaN(manualCotizacion)) {
            return alert('Ingrese un valor válido para la cotización.');
        }
        if (window.confirm(`¿Establecer la cotización del dólar en ${manualCotizacion} UYU?`)) {
            try {
                await api.post('/apicotizaciones/insertar', { cotizacion: parseFloat(manualCotizacion) });
                setCotizacion(parseFloat(manualCotizacion));
                setCotizacionFecha(new Date());
                setIsManualCotizacion(false);
            } catch (error) {
                console.error('Error insertando cotización:', error);
                alert('Error al guardar la cotización. Puede que ya exista una para hoy.');
            }
        }
    };

    // ─── MONEDA / MONTO ───────────────────────────────────
    const handleCurrencyChange = (e) => {
        const newCurrency = e.target.value;
        let payment = parseFloat(monto);
        if (isNaN(payment) || payment <= 0) payment = 0;
        if (moneda === 'USD' && newCurrency === 'UYU' && cotizacion) payment = payment * cotizacion;
        else if (moneda === 'UYU' && newCurrency === 'USD' && cotizacion) payment = payment / cotizacion;
        setMoneda(newCurrency);
        if (payment > 0) setMonto(payment.toFixed(2));
    };

    // ─── LOCK / UNLOCK ────────────────────────────────────
    const lockOrder = async (orderId) => {
        try { await api.post('/apiordenesRetiro/marcarpasarporcaja/1', { ordenDeRetiro: orderId }); }
        catch (e) { console.error("Error locking:", e); }
    };
    const unlockOrder = async (orderId) => {
        try { await api.post('/apiordenesRetiro/marcarpasarporcaja/0', { ordenDeRetiro: orderId }); }
        catch (e) { console.error("Error unlocking:", e); }
    };

    // ─── SELECCIÓN DE RETIRO ──────────────────────────────
    const handleSelectRetiro = async (retiro) => {
        if (selectedRetiro?.ordenDeRetiro === retiro.ordenDeRetiro) {
            await unlockOrder(retiro.ordenDeRetiro);
            setSelectedRetiro(null);
            setMonto('');
            return;
        }
        if (selectedRetiro) await unlockOrder(selectedRetiro.ordenDeRetiro);
        setSelectedRetiro(retiro);
        // Auto-fill monto
        const { sumUSD, sumUYU } = calculatePendingSums(retiro);
        if (moneda === 'USD') {
            const val = sumUSD + (cotizacion ? sumUYU / cotizacion : 0);
            setMonto(val > 0 ? val.toFixed(2) : '');
        } else {
            const val = sumUYU + (cotizacion ? sumUSD * cotizacion : 0);
            setMonto(val > 0 ? val.toFixed(2) : '');
        }
        await lockOrder(retiro.ordenDeRetiro);
    };

    const getOrdenes = (retiro) => retiro?.orders || [];

    const calculatePendingSums = (retiro) => {
        let sumUSD = 0, sumUYU = 0;
        getOrdenes(retiro).forEach(o => {
            if (o.orderIdMetodoPago !== null || o.orderPago !== null) return;
            let costStr = o.orderCosto || "";
            let cost = parseFloat(costStr.replace(/[^0-9.-]+/g, "")) || 0;
            const curSym = o.monedaId === 2 ? 'US$' : '$';

            if (curSym === 'US$') sumUSD += cost;
            else sumUYU += cost;
        });
        return { sumUSD, sumUYU };
    };

    const displayTotal = (retiro) => {
        if (!cotizacion) return "Requiere cotización";
        const { sumUSD, sumUYU } = calculatePendingSums(retiro);

        if (moneda === 'USD') {
            const val = sumUSD + (sumUYU / cotizacion);
            return `US$ ${val.toFixed(2)}`;
        } else {
            const val = sumUYU + (sumUSD * cotizacion);
            return `$ ${val.toFixed(2)}`;
        }
    };

    const handleFileChange = (e) => {
        setFileComprobante(e.target.files[0]);
    };

    // ─── PAGO ─────────────────────────────────────────────
    const handleRealizarPago = async () => {
        if (!selectedRetiro) return alert("Seleccione una orden para pagar.");
        if (!formaPago) return toast.warning('Seleccione un método de pago.');
        const importe = parseFloat(monto);
        if (isNaN(importe) || importe <= 0) return alert("El importe debe ser mayor que cero.");

        const ordersToPay = getOrdenes(selectedRetiro)
            .filter(o => o.orderIdMetodoPago === null && o.orderPago === null)
            .map(o => o.orderId);
        if (ordersToPay.length === 0) return alert("No hay sub-órdenes listas para pagar.");

        try {
            const monedaId = moneda === 'USD' ? 2 : 1;
            let filenameDest = null;
            if (fileComprobante) {
                const formData = new FormData();
                formData.append('comprobante', fileComprobante);
                const uploadRes = await api.post('/apipagos/uploadComprobante', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
                filenameDest = uploadRes.data?.filename || uploadRes.data?.comprobanteUrl || null;
            }
            await api.post('/apipagos/realizarPago', {
                metodoPagoId: parseInt(formaPago),
                monedaId,
                monto: importe,
                ordenRetiro: selectedRetiro.ordenDeRetiro,
                orderNumbers: ordersToPay,
                comprobanteUrl: filenameDest
            });
            Toast.fire({ icon: 'success', title: 'Pago guardado exitosamente.' });
            setMonto(''); setFormaPago(''); setFileComprobante(null); setSelectedRetiro(null);
            const fileInput = document.getElementById('file-upload');
            if (fileInput) fileInput.value = '';
            fetchData();
        } catch (err) {
            console.error(err);
            Toast.fire({ icon: 'error', title: 'Error al procesar el pago.' });
        }
    };

    // ─── AUTORIZAR SIN PAGO (Estado 9) ───────────────────
    const handleAutorizarSinPago = async () => {
        if (!selectedRetiro) return Toast.fire({ icon: 'warning', title: 'Seleccione una orden para autorizar.' });
        if (!observacionAutorizo.trim()) return Toast.fire({ icon: 'warning', title: 'Debe ingresar una observación para autorizar sin pago.' });

        setAutorizando(true);
        try {
            await api.post('/web-retiros/autorizar', {
                ordenRetiro: selectedRetiro.ordenDeRetiro,
                nota: observacionAutorizo.trim()
            });
            Toast.fire({ icon: 'success', title: `Orden ${selectedRetiro.ordenDeRetiro} Autorizada.` });
            setModalAutorizar(false);
            setSelectedRetiro(null);
            setMonto('');
            setObservacionAutorizo('');
            fetchOrders();
        } catch (err) {
            Toast.fire({ icon: 'error', title: 'Error: ' + (err.response?.data?.error || err.message), timer: 4000 });
        } finally {
            setAutorizando(false);
        }
    };

    // ─── BUSCADOR INTELIGENTE ──────────────────────────────
    // Si el término coincide con un retiro en la lista → seleccionarlo directamente
    // Si no → buscar en el backend y abrir modal con la situación
    const handleSearch = async () => {
        const term = searchInput.trim();
        if (!term || term.length < 2) return;

        const termLower = term.toLowerCase();

        // 1. Buscar en la lista local de retiros
        const match = retiros.find(retiro => {
            if (retiro.ordenDeRetiro?.toLowerCase() === termLower) return true;
            if (retiro.CliCodigoCliente?.toLowerCase() === termLower) return true;
            if (retiro.CliNombre?.toLowerCase().includes(termLower)) return true;
            // Buscar por código de sub-orden
            return getOrdenes(retiro).some(o => o.orderNumber?.toLowerCase() === termLower);
        });

        if (match) {
            // Encontrado en la lista → seleccionar directamente
            await handleSelectRetiro(match);
            setSearchInput('');
            return;
        }

        // 2. No encontrado en la lista → buscar situación en el backend
        setSearchLoading(true);
        try {
            const res = await api.get(`/apiordenesRetiro/mostrador/buscar?q=${encodeURIComponent(term)}`);
            setSearchModal(res.data);
        } catch (err) {
            console.error(err);
            alert('Error al buscar.');
        } finally {
            setSearchLoading(false);
        }
    };

    // ─── FILTRO LOCAL ─────────────────────────────────────
    const filteredRetiros = retiros.filter((retiro) => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        if (retiro.ordenDeRetiro?.toLowerCase().includes(term)) return true;
        if (retiro.CliNombre?.toLowerCase().includes(term)) return true;
        if (retiro.CliCodigoCliente?.toLowerCase().includes(term)) return true;
        for (let o of getOrdenes(retiro)) {
            if (o.codigoOrden?.toLowerCase().includes(term)) return true;
            if (o.orderNumber?.toLowerCase().includes(term)) return true;
        }
        return false;
    });

    // ─── RENDER ───────────────────────────────────────────
    if (loading && retiros.length === 0) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="animate-spin text-blue-500" size={40} />
                <span className="ml-3 text-zinc-500 font-medium">Cargando caja...</span>
            </div>
        );
    }

    return (
        <div className="min-h-full flex flex-col gap-5 p-4 lg:px-8 lg:py-4 font-sans bg-slate-100">

            {/* Cabecera / Controles */}
            {/* <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end mb-8"> */}
            {/* <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-zinc-800">Seleccionar forma de pago</label>
                    <select
                        className="w-full bg-white border border-zinc-300 rounded-lg px-4 py-2.5 text-zinc-700 outline-none focus:border-[#0070bc] focus:ring-1 focus:ring-[#0070bc] appearance-none"
                        value={formaPago}
                        onChange={(e) => setFormaPago(e.target.value)}
                    >
                        <option value="">Seleccione un método</option>
                        {metodosPago.map((m) => (
                            <option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>
                                {m.MPaDescripcionMetodo}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-zinc-800">Seleccionar Moneda</label>
                    <select
                        className="w-full bg-white border border-zinc-300 rounded-lg px-4 py-2.5 text-zinc-700 outline-none focus:border-[#0070bc] focus:ring-1 focus:ring-[#0070bc] appearance-none"
                        value={moneda}
                        onChange={handleCurrencyChange}
                    >
                        <option value="USD">US$</option>
                        <option value="UYU">$</option>
                    </select>
                </div>

                <div className="flex flex-col gap-2">
                    <label className="text-sm font-bold text-zinc-800">Cargar comprobante</label>
                    <input
                        type="file"
                        id="file-upload"
                        onChange={handleFileChange}
                        className="w-full text-sm border border-zinc-300 p-2 rounded-lg cursor-pointer"
                    />
                </div>

                <div className="flex flex-col gap-2 relative">
                    <label className="text-sm font-bold text-zinc-800">Ingrese Monto</label>
                    <input
                        type="number"
                        placeholder="Monto"
                        className="w-full bg-white border border-zinc-300 rounded-lg px-4 py-2.5 text-zinc-700 outline-none focus:border-[#0070bc] focus:ring-1 focus:ring-[#0070bc] text-lg font-bold"
                        value={monto}
                        onChange={(e) => setMonto(e.target.value)}
                    />
                </div>
            </div>

            <div className="flex justify-end mb-8">
                <button
                    onClick={handleRealizarPago}
                    className="bg-[#0070bc] hover:bg-[#005a99] text-white font-bold py-2.5 px-8 rounded-full shadow-md transition-transform hover:scale-105"
                >
                    Realizar Pago
                </button>
            </div> */}

            {/* Banner Cotización */}


            {/* ─── FORMULARIO DE PAGO (COMPACTO) ──────────── */}
            <div className="bg-white rounded-2xl border border-transparent shadow-[0_2px_8px_rgba(0,0,0,0.35)] p-4">
                <div className="flex items-end gap-3 flex-wrap">
                    {/* Forma de pago */}
                    <div className="flex flex-col gap-1 flex-1 min-w-[150px]">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Método de Pago</label>
                        <CustomSelect
                            value={formaPago}
                            onChange={(val) => setFormaPago(val)}
                            options={metodosPago.map(m => ({ value: String(m.MPaIdMetodoPago), label: m.MPaDescripcionMetodo }))}
                            placeholder="Seleccione..."
                            variant="light"
                            size="small"
                        />
                    </div>

                    {/* Moneda — toggle segmentado */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Moneda</label>
                        <div 
                            className="flex rounded-lg border border-slate-200 overflow-hidden cursor-pointer select-none"
                            onClick={() => handleCurrencyChange({ target: { value: moneda === 'USD' ? 'UYU' : 'USD' } })}
                        >
                            <div className={`w-[50px] py-2.5 text-sm font-bold transition-all text-center ${moneda === 'UYU' ? 'bg-brand-cyan text-white' : 'bg-white text-slate-500'}`}>$</div>
                            <div className={`w-[50px] py-2.5 text-sm font-bold transition-all text-center border-l border-slate-200 ${moneda === 'USD' ? 'bg-brand-magenta text-white' : 'bg-white text-slate-500'}`}>US$</div>
                        </div>
                    </div>

                    {/* Monto */}
                    <div className="flex items-end gap-2">
                        <div className="flex flex-col gap-1 w-[160px]">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Importe</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    placeholder={moneda === 'USD' ? 'US$ - 0,00' : '$ - 0,00'}
                                    className="w-full bg-white border border-slate-200 rounded-lg px-4 p-2.5 text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-sm font-black transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                    value={monto}
                                    onChange={(e) => setMonto(e.target.value)}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Comprobante */}
                    <div className="flex flex-col gap-1">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Comprobante</label>
                        <input
                            type="file"
                            id="file-upload"
                            onChange={(e) => setFileComprobante(e.target.files[0])}
                            className="hidden"
                        />
                        <label
                            htmlFor="file-upload"
                            className="bg-white border border-slate-200 rounded-lg p-2.5 text-sm text-slate-500 cursor-pointer hover:border-blue-400 transition-all truncate max-w-[180px]"
                        >
                            {fileComprobante ? fileComprobante.name : 'Adjuntar archivo...'}
                        </label>
                    </div>

                    {/* Separador */}
                    <div className="self-center w-px h-12 bg-slate-300"></div>

                    {/* Cotización */}
                    <div className="flex items-center gap-4 self-center">
                        <div className="flex flex-col justify-center text-center">
                            <div className="flex items-center justify-center gap-2 text-sm">
                                <span className="font-bold text-brand-cyan uppercase tracking-wider">Cotización</span>
                                {cotizacionFecha && (
                                    <span className="text-brand-cyan font-semibold">{cotizacionFecha.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit' })} {cotizacionFecha.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                                )}
                            </div>
                            <div className="text-sm lg:text-lg font-black text-slate-700 whitespace-nowrap">
                                {cotizacion !== null ? (
                                    <span>1 Dólar = ${Number(cotizacion).toFixed(2)} Pesos</span>
                                ) : (
                                    <span className="text-slate-400 font-medium">Sin cotización</span>
                                )}
                            </div>
                        </div>
                        <RefreshCw
                            size={28}
                            className="text-brand-dark cursor-pointer transition-transform duration-300"
                            style={{ transform: `rotate(${cotSpin}deg)` }}
                            onClick={() => { setCotSpin(s => s + 180); handleBuscarCotizacion(); }}
                        />
                    </div>
                </div>
            </div>


            {/* ─── CONTENIDO PRINCIPAL ─────────────────────── */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 flex-1">

                {/* PANEL IZQUIERDO: Lista de Retiros */}
                <div className="bg-white rounded-2xl border border-transparent shadow-[0_2px_8px_rgba(0,0,0,0.35)] p-4 flex flex-col">

                    {/* Filtro rápido + Buscador */}
                    <div className="flex items-end gap-3 mb-3 flex-wrap">
                        <div className="flex flex-col gap-1 flex-1 min-w-[150px]">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Buscar retiros</label>
                            <input
                                type="text"
                                placeholder="Buscar..."
                                className="w-full bg-white border border-slate-200 rounded-lg px-4 p-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex flex-col gap-1 flex-1 min-w-[150px]">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Buscar situación</label>
                            <input
                                type="text"
                                placeholder="Buscar..."
                                className="w-full bg-white border border-slate-200 rounded-lg px-4 p-2.5 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                value={searchInput}
                                onChange={(e) => setSearchInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                            />
                        </div>
                    </div>


                    {/* <p className="text-[10px] text-slate-400 mb-3 leading-tight">
                Muestra retiros <strong>con cobro pendiente</strong> (Ingresado, Pasar por caja, Abonado de antemano con saldo, Empaquetado sin abonar).
                Los <strong>semanales</strong> se excluyen por defecto. El filtro consulta al servidor al cambiar.
            </p> */}

                    {/* Filtros por tipo de cliente */}
                    <div className="flex items-center gap-1.5 mb-3 flex-wrap">
                        <Filter size={18} className="text-slate-400" />
                        {[
                            { val: 'todos', label: 'Todos' },
                            { val: '1', label: 'Comunes' },
                            { val: '2', label: 'Semanales' },
                            { val: '3', label: 'Rollo Adelantado' },
                        ].map(f => (
                            <button
                                key={f.val}
                                onClick={() => setFiltroTipoCliente(f.val)}
                                className={`px-3 py-1 rounded-lg text-xs font-bold transition-all border
                                    ${filtroTipoCliente === f.val
                                        ? 'bg-brand-cyan text-white border-brand-cyan shadow-sm'
                                        : 'bg-white text-slate-600 border-slate-200 hover:border-brand-cyan hover:text-brand-cyan'
                                    }`}
                            >
                                {f.label}
                            </button>
                        ))}
                        <span className="ml-auto text-xs text-brand-cyan font-black">{filteredRetiros.length} retiros</span>
                    </div>

                    {/* Lista de retiros — chips compactos */}
                    <div className="grid grid-cols-3 gap-2 overflow-y-auto max-h-[60vh] p-1">
                        {filteredRetiros.length === 0 ? (
                            <p className="text-sm text-slate-400 text-center w-full py-8">No hay órdenes pendientes de pago.</p>
                        ) : (
                            filteredRetiros.map((retiro) => {
                                const isSelected = selectedRetiro?.ordenDeRetiro === retiro.ordenDeRetiro;
                                const allPaid = getOrdenes(retiro).length > 0 && getOrdenes(retiro).every(o => o.orderIdMetodoPago !== null || o.orderPago !== null);
                                const isAutorizado = retiro.estadoNumerico === 9 || (retiro.estado || '').toLowerCase() === 'autorizado';
                                const isEntregado = retiro.estadoNumerico === 6 || (retiro.estado || '').toLowerCase() === 'entregado';
                                return (
                                    <button
                                        key={retiro.ordenDeRetiro}
                                        onClick={() => handleSelectRetiro(retiro)}
                                        title={retiro.CliNombre || retiro.CliCodigoCliente || ''}
                                        className={`px-4 py-2.5 rounded-lg border font-black text-sm transition-all whitespace-nowrap flex items-center justify-around
                                            ${isSelected
                                                ? 'bg-custom-cyan border-brand-cyan text-white shadow-sm'
                                                : allPaid
                                                    ? 'bg-emerald-50 border-emerald-300 text-emerald-700 hover:border-emerald-400 hover:scale-[1.03]'
                                                    : isAutorizado
                                                        ? 'bg-amber-50 border-amber-300 text-amber-700 hover:border-amber-400 hover:scale-[1.03]'
                                                        : 'bg-rose-50 border-rose-300 text-rose-700 hover:border-rose-400 hover:scale-[1.03]'
                                            }`}
                                    >
                                        {retiro.ordenDeRetiro}
                                        {isEntregado && <PackageCheck size={24} className="text-brand-dark" />}
                                        {isAutorizado && !isEntregado && <ShieldCheck size={24} className="text-brand-dark" />}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* PANEL DERECHO: Cotización + Detalle del Retiro */}
                <div className="flex flex-col gap-4">

                    {/* Botones: Realizar Pago + Autorizar sin pago */}
                    <div className="flex gap-3">
                        <button
                            onClick={handleRealizarPago}
                            className={`${moneda === 'UYU' ? 'bg-brand-cyan hover:bg-brand-cyan/90' : 'bg-brand-magenta hover:bg-brand-magenta/90'} text-white font-bold py-8 px-6 rounded-2xl border border-transparent shadow-[0_2px_8px_rgba(0,0,0,0.35)] transition-all hover:scale-[1.02] active:scale-[0.97] text-xl uppercase tracking-wider whitespace-nowrap flex items-center justify-center gap-3 flex-1`}
                        >
                            <CreditCard size={24} /> Realizar Pago
                        </button>
                    </div>

                    {/* Detalle del Retiro */}
                    <div className="bg-white rounded-2xl border border-transparent shadow-[0_2px_8px_rgba(0,0,0,0.35)] p-5 flex flex-col flex-1">
                    {selectedRetiro ? (
                        <>
                            {/* Header del retiro — sin total duplicado */}
                            <div className="flex items-center gap-3 mb-4">
                                <h2 className="text-3xl font-black text-brand-cyan">{selectedRetiro.ordenDeRetiro}</h2>
                                <span className="text-sm text-slate-400 font-medium mt-1">{selectedRetiro.lugarRetiro} • {selectedRetiro.estado}</span>
                            </div>

                            {/* Datos del cliente */}
                            <div className="bg-slate-50 rounded-xl border border-slate-200 p-3 mb-4 grid grid-cols-2 gap-3">
                                <div className="flex items-center gap-2">
                                    <User size={14} className="text-slate-400" />
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Cliente</p>
                                        <p className="text-sm font-bold text-slate-800 truncate">{selectedRetiro.CliNombre || '—'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Phone size={14} className="text-slate-400" />
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Teléfono</p>
                                        <p className="text-sm font-bold text-slate-800">{selectedRetiro.CliTelefono || '—'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <FileText size={14} className="text-slate-400" />
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">ID</p>
                                        <p className="text-sm font-bold text-slate-800">{selectedRetiro.CliCodigoCliente || '—'}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <Package size={14} className="text-slate-400" />
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase">Tipo</p>
                                        <p className="text-sm font-bold text-slate-800">{selectedRetiro.TClDescripcion || '—'}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Sub-órdenes */}
                            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Órdenes del retiro</h3>
                            <div className="flex flex-col gap-2 overflow-y-auto max-h-[40vh] pr-1">
                                {getOrdenes(selectedRetiro).length > 0 ? (
                                    getOrdenes(selectedRetiro).map((po, i) => {
                                        const costStr  = po.orderCosto || "";
                                        const curSym   = po.monedaId === 2 ? 'US$' : '$';
                                        const rawValor = parseFloat(costStr.replace(/[^0-9.-]+/g, "")) || 0;
                                        const isPaid   = po.orderIdMetodoPago !== null || po.orderPago !== null;

                                        let valorConvertidoDest = "";
                                        if (moneda === 'UYU' && curSym === 'US$' && cotizacion)
                                            valorConvertidoDest = ` ($ ${(rawValor * cotizacion).toFixed(2)})`;
                                        if (moneda === 'USD' && curSym === '$' && cotizacion)
                                            valorConvertidoDest = ` (US$ ${(rawValor / cotizacion).toFixed(2)})`;

                                        return (
                                            <div
                                                key={i}
                                                className={`px-3 py-2 rounded-xl border-2 flex flex-col gap-1 transition-all
                                                ${isPaid ? 'border-emerald-200 bg-emerald-50/50' : po.orderCobertura ? 'border-violet-200 bg-violet-50/40' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                                            >
                                                {/* Fila principal: icono + nombre + cant + badge */}
                                                <div className="flex items-center gap-2">
                                                    {isPaid
                                                        ? <CheckCircle size={15} className="text-emerald-500 shrink-0" />
                                                        : po.orderCobertura
                                                            ? <ShieldCheck size={15} className="text-violet-500 shrink-0" />
                                                            : <AlertTriangle size={15} className="text-amber-500 shrink-0" />}
                                                    <span className="font-bold text-sm text-slate-800 truncate">
                                                        {po.orderNumber || `Item ${i + 1}`}
                                                    </span>
                                                    {po.orderCantidad != null && (
                                                        <span className="text-[10px] text-slate-400 font-semibold shrink-0">
                                                            Cant: <strong className="text-slate-600">{po.orderCantidad % 1 === 0 ? po.orderCantidad : po.orderCantidad.toFixed(2)}</strong>
                                                        </span>
                                                    )}
                                                    <span className={`ml-auto text-[10px] font-black px-2 py-0.5 rounded-full shrink-0
                                                        ${isPaid ? 'bg-emerald-100 text-emerald-700' : po.orderCobertura ? 'bg-violet-100 text-violet-700' : 'bg-rose-100 text-rose-700'}`}>
                                                        {isPaid ? '✓ Pagada' : po.orderCobertura ? '⚡ Cubierta' : '✗ Sin pago'}
                                                    </span>
                                                    {/* Monto */}
                                                    <div className="text-right shrink-0 ml-2">
                                                        <p className="font-black text-sm text-slate-800">{curSym} {rawValor.toFixed(2)}</p>
                                                        {valorConvertidoDest && <p className="text-xs text-slate-400">{valorConvertidoDest}</p>}
                                                    </div>
                                                </div>
                                                {/* Nombre del trabajo */}
                                                {po.orderNombreTrabajo && (
                                                    <p className="text-[10px] text-slate-500 pl-5 leading-tight italic truncate">
                                                        {po.orderNombreTrabajo}
                                                    </p>
                                                )}
                                                {/* Nota de cobertura (Plan / Ciclo / Saldo) */}
                                                {po.orderCobertura && !isPaid && (
                                                    <p className="text-[10px] text-violet-600 font-semibold pl-5 leading-tight">
                                                        {po.orderCobertura}
                                                    </p>
                                                )}
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p className="text-slate-400 text-sm text-center py-4">No hay detalles de órdenes.</p>
                                )}
                            </div>

                            {/* Botón Autorizar sin pago — abre modal */}
                            {getOrdenes(selectedRetiro).some(o => o.orderIdMetodoPago === null && o.orderPago === null) && (
                                <div className="mt-3 pt-3 border-t border-slate-200">
                                    <button
                                        onClick={() => { setObservacionAutorizo(''); setModalAutorizar(true); }}
                                        className="w-full bg-amber-500 hover:bg-amber-600 text-white text-sm font-black py-2.5 rounded-xl transition-all hover:scale-[1.02] active:scale-[0.97] flex items-center justify-center gap-2 uppercase tracking-wider"
                                    >
                                        <ShieldCheck size={16} /> Autorizar entrega sin pago
                                    </button>
                                </div>
                            )}



                        </>
                    ) : (
                        <div className="flex flex-col items-center justify-center flex-1 text-slate-300">
                            <CreditCard size={64} className="mb-4" />
                            <p className="text-lg font-bold">Seleccione un retiro para cobrar</p>
                            <p className="text-sm mt-1">Haga clic en un retiro de la lista izquierda</p>
                        </div>
                    )}
                                </div>  {/* cierra detalle del retiro */}
                            </div>  {/* cierra col-span-3 wrapper */}
                        </div>

                        {/* ─── MODAL AUTORIZAR SIN PAGO ─── */}
                        {modalAutorizar && selectedRetiro && (() => {
                            const sinPago = getOrdenes(selectedRetiro).filter(o => o.orderIdMetodoPago === null && o.orderPago === null);
                            const tipoCliente = selectedRetiro.TClDescripcion || 'Desconocido';
                            return (
                                <div
                                    className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60  px-4"
                                    onClick={() => setModalAutorizar(false)}
                                >
                                    <div
                                        className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-amber-200"
                                        onClick={e => e.stopPropagation()}
                                    >
                                        {/* Encabezado */}
                                        <div className="flex items-center justify-between mb-4">
                                            <div>
                                                <h3 className="text-xl font-black text-slate-800">Autorizar sin cobrar</h3>
                                                <p className="text-sm text-slate-500">{selectedRetiro.ordenDeRetiro} — {selectedRetiro.CliNombre}</p>
                                            </div>
                                            <button onClick={() => setModalAutorizar(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
                                        </div>

                                        {/* Tipo de cliente pre-cargado */}
                                        <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 mb-4 flex items-center gap-3">
                                            <Package size={16} className="text-slate-400 shrink-0" />
                                            <div>
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Tipo de cliente</p>
                                                <p className="text-sm font-black text-slate-700">{tipoCliente}</p>
                                            </div>
                                            <div className="ml-auto">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Sin pago</p>
                                                <p className="text-sm font-black text-rose-600 text-right">{sinPago.length} {sinPago.length === 1 ? 'orden' : 'órdenes'}</p>
                                            </div>
                                        </div>

                                        {/* Órdenes sin pago (resumen) */}
                                        <div className="flex flex-col gap-1 mb-4 max-h-32 overflow-y-auto">
                                            {sinPago.map((o, i) => {
                                                const v = parseFloat((o.orderCosto || '').replace(/[^0-9.-]+/g, '')) || 0;
                                                const sym = o.monedaId === 2 ? 'US$' : '$';
                                                return (
                                                    <div key={i} className="flex items-center justify-between bg-rose-50 border border-rose-100 rounded-lg px-3 py-1.5 text-sm">
                                                        <span className="font-bold text-slate-700">{o.orderNumber}</span>
                                                        <span className="text-xs text-rose-600 font-bold">✗ Sin pago</span>
                                                        <span className="font-black text-slate-800">{sym} {v.toFixed(2)}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>

                                        {/* Observaciones */}
                                        <label className="block text-xs font-bold text-slate-600 mb-1 uppercase tracking-wider">Observaciones <span className="text-rose-500">*</span></label>
                                        <textarea
                                            rows={3}
                                            value={observacionAutorizo}
                                            onChange={e => setObservacionAutorizo(e.target.value)}
                                            autoFocus
                                            placeholder={`Motivo de autorizar sin cobrar (${tipoCliente})...`}
                                            className="w-full text-sm bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 outline-none focus:ring-2 focus:ring-amber-400/40 focus:border-amber-400 resize-none mb-4 text-slate-700"
                                        />

                                        {/* Botones */}
                                        <div className="flex gap-3">
                                            <button
                                                onClick={() => setModalAutorizar(false)}
                                                className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-xl hover:bg-slate-200 transition-colors"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                onClick={handleAutorizarSinPago}
                                                disabled={autorizando || !observacionAutorizo.trim()}
                                                className="flex-[2] py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white font-black rounded-xl transition-all flex items-center justify-center gap-2"
                                            >
                                                <ShieldCheck size={16}/>
                                                {autorizando ? 'Autorizando...' : 'Confirmar autorización'}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

            {/* ─── MODAL DE BÚSQUEDA (SITUACIÓN DE PAGO) ── */}
            {
                searchModal && (
                    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setSearchModal(null)}>
                        <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between border-b border-slate-200 p-4">
                                <h3 className="text-lg font-black text-slate-800">Situación de Pago — "{searchInput}"</h3>
                                <button onClick={() => setSearchModal(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
                            </div>
                            <div className="p-4 overflow-y-auto flex-1">
                                {/* Retiros encontrados */}
                                {searchModal.retiroRows && searchModal.retiroRows.length > 0 && (
                                    <div className="mb-6">
                                        <h4 className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-2">Con Retiro Asignado</h4>
                                        {(() => {
                                            const groups = {};
                                            searchModal.retiroRows.forEach(r => {
                                                const key = r.OReIdOrdenRetiro;
                                                if (!groups[key]) groups[key] = { ...r, orders: [] };
                                                if (r.OrdIdOrden) groups[key].orders.push(r);
                                            });
                                            return Object.values(groups).map(g => (
                                                <div key={g.OReIdOrdenRetiro} className="bg-slate-50 rounded-xl border border-slate-200 p-3 mb-2">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="font-black text-blue-700">
                                                            {g.FormaRetiro || 'R'}-{String(g.OReIdOrdenRetiro).padStart(4, '0')}
                                                        </span>
                                                        <span className="text-xs font-bold text-slate-500">{g.estadoRetiro} • {g.lugarRetiro}</span>
                                                    </div>
                                                    <p className="text-xs text-slate-500 mb-2">{g.CliNombre} ({g.CliCodigo}) — {g.TClDescripcion}</p>
                                                    {g.orders.map((o, i) => (
                                                        <div key={i} className="flex items-center justify-between py-1 border-t border-slate-200 text-sm gap-2">
                                                            <span className="font-semibold flex-1">{o.OrdCodigoOrden}</span>
                                                            <span className={`text-xs font-bold ${o.estadoOrden === 'Entregado' || o.estadoOrden === 'Cancelado' ? 'text-slate-400' : 'text-slate-600'}`}>{o.estadoOrden}</span>
                                                            <span className={`text-xs font-black px-1.5 py-0.5 rounded ${o.Pagada ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                                                                {o.Pagada ? '✓ Pagada' : '✗ Sin pago'}
                                                            </span>
                                                            <span className="font-bold text-slate-700">{o.MonSimbolo} {parseFloat(o.OrdCostoFinal || 0).toFixed(2)}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ));
                                        })()}
                                    </div>
                                )}

                                {/* Sin retiro */}
                                {searchModal.sinRetiro && searchModal.sinRetiro.length > 0 && (
                                    <div>
                                        <h4 className="text-xs font-bold text-amber-500 uppercase tracking-wider mb-2">Sin Retiro Asignado</h4>
                                        {searchModal.sinRetiro.map((o, i) => (
                                            <div key={i} className="flex items-center justify-between py-2 border-b border-slate-100 text-sm">
                                                <div>
                                                    <span className="font-bold text-slate-800">{o.OrdCodigoOrden}</span>
                                                    <span className="ml-2 text-xs text-slate-400">{o.CliNombre} ({o.CliCodigo})</span>
                                                    <span className="ml-2 text-xs text-slate-400">{o.TClDescripcion}</span>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <span className={`text-xs font-bold ${o.Pagada ? 'text-emerald-600' : 'text-amber-600'}`}>{o.Pagada ? 'PAGADA' : o.estadoOrden}</span>
                                                    <span className="font-bold">{o.MonSimbolo} {parseFloat(o.OrdCostoFinal || 0).toFixed(2)}</span>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Sin resultados */}
                                {(!searchModal.retiroRows || searchModal.retiroRows.length === 0) && (!searchModal.sinRetiro || searchModal.sinRetiro.length === 0) && (
                                    <p className="text-center text-slate-400 py-8">No se encontraron resultados para "{searchInput}"</p>
                                )}
                            </div>
                        </div>
                    </div>
                )
            }
        </div >
    );
};

export default CargaGestionPagosView;
