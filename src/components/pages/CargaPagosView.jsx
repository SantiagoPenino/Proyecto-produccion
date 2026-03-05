import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import api, { SOCKET_URL } from '../../services/apiClient';
import { io } from 'socket.io-client';

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

    // Cotizacion hooks
    const [cotizacion, setCotizacion] = useState(null);
    const [isManualCotizacion, setIsManualCotizacion] = useState(false);
    const [manualCotizacion, setManualCotizacion] = useState('');

    const [searchTerm, setSearchTerm] = useState('');
    const [socketInstance, setSocketInstance] = useState(null);

    // Initial Load
    useEffect(() => {
        // Socket init
        const socket = io(SOCKET_URL, { transports: ["websocket", "polling"] });

        socket.on("connect", () => console.log("Caja conectada a Sockets:", socket.id));
        socket.on("retiros:update", () => {
            console.log("Evento retiros:update (Socket). Refrescando Caja...");
            fetchOrders();
        });
        socket.on("actualizado", () => {
            console.log("Evento actualizado (Socket). Refrescando Caja...");
            fetchOrders();
        });

        setSocketInstance(socket);

        fetchData();

        return () => {
            socket.disconnect();
            if (selectedRetiro) unlockOrder(selectedRetiro.ordenDeRetiro);
        };
    }, []);

    const fetchOrders = async () => {
        try {
            const resRetiros = await api.get('/apiordenesretiro/caja');
            const dataRetiros = Array.isArray(resRetiros.data) ? resRetiros.data : (Array.isArray(resRetiros) ? resRetiros : []);
            setRetiros(dataRetiros);
        } catch (e) {
            console.error("Error fetching orders:", e);
        }
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            await fetchOrders();

            const [resMetodos, resCotiz] = await Promise.allSettled([
                api.get('/apipagos/metodos'),
                api.get('/apicotizaciones/hoy')
            ]);

            if (resMetodos.status === 'fulfilled') {
                const dataMetodos = Array.isArray(resMetodos.value.data) ? resMetodos.value.data : [];
                setMetodosPago(dataMetodos);
            }

            if (resCotiz.status === 'fulfilled' && resCotiz.value.data?.cotizaciones?.length > 0) {
                setCotizacion(resCotiz.value.data.cotizaciones[0].CotDolar);
            } else {
                setCotizacion(null);
            }
        } catch (error) {
            console.error("Error fetching data:", error);
        } finally {
            setLoading(false);
        }
    };

    const handleSetManualCotizacion = async () => {
        if (!manualCotizacion || isNaN(manualCotizacion)) {
            return alert('Por favor, ingrese un valor válido para la cotización.');
        }

        if (window.confirm(`¿Está seguro de establecer la cotización del dólar en ${manualCotizacion} UYU?`)) {
            try {
                await api.post('/apicotizaciones/insertar', {
                    cotizacion: parseFloat(manualCotizacion)
                });
                alert('Cotización registrada exitosamente');
                setCotizacion(parseFloat(manualCotizacion));
                setIsManualCotizacion(false);
            } catch (error) {
                console.error('Error insertando cotización:', error);
                alert('Hubo un error al guardar la cotización.');
            }
        }
    };

    const handleCurrencyChange = (e) => {
        const newCurrency = e.target.value;
        let payment = parseFloat(monto);
        if (isNaN(payment) || payment <= 0) payment = 0;

        if (moneda === 'USD' && newCurrency === 'UYU' && cotizacion) {
            payment = payment * cotizacion;
        } else if (moneda === 'UYU' && newCurrency === 'USD' && cotizacion) {
            payment = payment / cotizacion;
        }

        setMoneda(newCurrency);
        if (payment > 0) setMonto(payment.toFixed(2));
    };

    // Locks the order logically from DB / API
    const lockOrder = async (orderId) => {
        try {
            await api.post('/apiordenesretiro/marcarpasarporcaja/1', { ordenDeRetiro: orderId });
        } catch (e) { console.error("Error locking order:", e); }
    };

    const unlockOrder = async (orderId) => {
        try {
            await api.post('/apiordenesretiro/marcarpasarporcaja/0', { ordenDeRetiro: orderId });
        } catch (e) { console.error("Error unlocking order:", e); }
    };

    const handleSelectRetiro = async (retiro) => {
        if (selectedRetiro?.ordenDeRetiro === retiro.ordenDeRetiro) {
            await unlockOrder(retiro.ordenDeRetiro);
            setSelectedRetiro(null);
            setMonto('');
            return;
        }

        if (selectedRetiro) {
            await unlockOrder(selectedRetiro.ordenDeRetiro);
        }

        setSelectedRetiro(retiro);
        setMonto('');
        await lockOrder(retiro.ordenDeRetiro);
    };

    const getOrdenes = (retiro) => {
        return retiro?.orders || [];
    };

    // Calcular montos PENDIENTES
    const calculatePendingSums = (retiro) => {
        let sumUSD = 0;
        let sumUYU = 0;

        getOrdenes(retiro).forEach(o => {
            if (o.orderIdMetodoPago !== null || o.orderPago !== null) return; // Ignore already paid orders! (Important from old Caja)
            let costStr = o.orderCosto || "";
            let cost = parseFloat(costStr.replace(/[^0-9.-]+/g, "")) || 0;
            const curSym = costStr.includes('USD') || costStr.includes('U$S') ? 'USD' : (costStr.includes('$') ? 'UYU' : 'USD');

            if (curSym === 'USD') sumUSD += cost;
            else sumUYU += cost;
        });

        return { sumUSD, sumUYU };
    };

    const displayTotal = (retiro) => {
        if (!cotizacion) return "Requiere cotización";

        const { sumUSD, sumUYU } = calculatePendingSums(retiro);

        if (moneda === 'USD') {
            const val = sumUSD + (sumUYU / cotizacion);
            return `USD ${val.toFixed(2)}`;
        } else {
            const val = sumUYU + (sumUSD * cotizacion);
            return `UYU ${val.toFixed(2)}`;
        }
    };

    const handleFileChange = (e) => {
        setFileComprobante(e.target.files[0]);
    };

    const handleRealizarPago = async () => {
        if (!selectedRetiro) return alert("Seleccione una orden para pagar.");
        if (!formaPago) return alert("Seleccione un método de pago.");

        const importe = parseFloat(monto);
        if (isNaN(importe) || importe <= 0) {
            return alert("El importe del pago debe ser mayor que cero.");
        }

        // Subordenes no pagadas
        const ordersToPay = getOrdenes(selectedRetiro)
            .filter(o => o.orderIdMetodoPago === null && o.orderPago === null)
            .map(o => o.orderId);

        if (ordersToPay.length === 0) {
            return alert("No hay sub-órdenes listas para pagar en este retiro (ya están pagas o error).");
        }

        try {
            const monedaId = moneda === 'USD' ? 2 : 1;
            let filenameDest = null;

            // Si hay comprobante para cargar
            if (fileComprobante) {
                const formData = new FormData();
                formData.append('comprobante', fileComprobante);
                const uploadRes = await api.post('/apipagos/uploadComprobante', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' }
                });

                if (uploadRes.data?.filename || uploadRes.data?.comprobanteUrl) {
                    filenameDest = uploadRes.data.filename || uploadRes.data.comprobanteUrl;
                }
            }

            const res = await api.post('/apipagos/realizarPago', {
                metodoPagoId: parseInt(formaPago),
                monedaId: monedaId,
                monto: importe,
                ordenRetiro: selectedRetiro.ordenDeRetiro,
                orderNumbers: ordersToPay,
                comprobanteUrl: filenameDest
            });

            if (res.data) {
                alert("Pago guardado exitosamente.");
                setMonto('');
                setFormaPago('');
                setFileComprobante(null);
                setSelectedRetiro(null);
                document.getElementById('file-upload').value = '';
                fetchData();
            } else {
                alert("No se pudo confirmar el pago.");
            }
        } catch (err) {
            console.error(err);
            alert("Error al procesar el pago.");
        }
    };

    const filteredRetiros = retiros.filter((retiro) => {
        if (!searchTerm) return true;
        const term = searchTerm.toLowerCase();
        if (retiro.ordenDeRetiro && retiro.ordenDeRetiro.toLowerCase().includes(term)) return true;

        const ordenes = getOrdenes(retiro);
        for (let o of ordenes) {
            if (o.codigoOrden && o.codigoOrden.toLowerCase().includes(term)) return true;
            if (o.cliente) {
                if (String(o.cliente.id).includes(term)) return true;
                if (o.cliente.codigo?.toLowerCase().includes(term)) return true;
                if (o.cliente.nombreApellido?.toLowerCase().includes(term)) return true;
            }
        }
        return false;
    });

    if (loading && retiros.length === 0) {
        return <div className="p-8 text-center text-zinc-500">Cargando órdenes de la caja...</div>;
    }

    return (
        <div className="bg-white rounded-xl shadow-lg p-6 lg:p-10 font-sans border border-zinc-100 min-h-full flex flex-col">

            {/* Cabecera / Controles */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end mb-8">
                <div className="flex flex-col gap-2">
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
                        <option value="USD">USD</option>
                        <option value="UYU">UYU</option>
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
            </div>

            {/* Banner Cotización */}
            <div className="bg-[#eaf5ff] rounded-2xl py-6 flex flex-col items-center justify-center mb-10 border border-[#cbe5ff]">
                <h3 className="text-lg font-bold text-[#0070bc]">Cotización del Dólar:</h3>

                {cotizacion !== null ? (
                    <p className="text-xl font-black text-zinc-800">1 USD = {Number(cotizacion).toFixed(2)} UYU</p>
                ) : (
                    <div className="mt-2 text-center">
                        {!isManualCotizacion ? (
                            <p className="text-sm font-medium">
                                No se encontró la cotización del dólar.{' '}
                                <button className="underline text-[#0070bc]" onClick={() => setIsManualCotizacion(true)}>
                                    Ingresar manualmente
                                </button>
                            </p>
                        ) : (
                            <div className="flex flex-col gap-2 mt-2">
                                <input
                                    type="number"
                                    value={manualCotizacion}
                                    onChange={(e) => setManualCotizacion(e.target.value)}
                                    placeholder="Cotización ej: 40"
                                    className="border rounded-lg px-3 py-1 font-bold text-center"
                                />
                                <button onClick={handleSetManualCotizacion} className="bg-[#0070bc] text-white rounded-lg px-3 py-1 text-sm">
                                    Confirmar Cotización
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Main Content Split */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 flex-1">
                {/* Lado Izquierdo: Órdenes para Pagar */}
                <div className="pr-0 lg:pr-10 lg:border-r border-zinc-200">
                    <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
                        <h3 className="text-lg font-bold text-zinc-800">Órdenes pendientes</h3>
                        <div className="relative w-full md:w-64">
                            <input
                                type="text"
                                placeholder="Buscar Retiro, Orden, Cliente..."
                                className="w-full pl-10 pr-4 py-2 border border-zinc-300 rounded-full text-sm focus:outline-none focus:border-[#0070bc] focus:ring-1 focus:ring-[#0070bc]"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            <i className="fa-solid fa-search absolute left-4 top-1/2 transform -translate-y-1/2 text-zinc-400"></i>
                        </div>
                    </div>

                    <div className="flex flex-wrap gap-4 max-h-[60vh] overflow-y-auto custom-scrollbar pr-2 pb-2 content-start">
                        {filteredRetiros.length === 0 ? (
                            <p className="text-zinc-500">No hay órdenes en la caja.</p>
                        ) : (
                            filteredRetiros.map((retiro) => {
                                const isSelected = selectedRetiro?.ordenDeRetiro === retiro.ordenDeRetiro;
                                const isLocked = selectedRetiro && selectedRetiro.ordenDeRetiro !== retiro.ordenDeRetiro;

                                return (
                                    <button
                                        key={retiro.ordenDeRetiro}
                                        onClick={() => handleSelectRetiro(retiro)}
                                        className={`
                                            px-6 py-2.5 rounded-full font-bold border-2 transition-all cursor-pointer hover:bg-[#eaf5ff]
                                            ${isSelected ? 'bg-[#0070bc] border-[#0070bc] text-white shadow-lg scale-105 !hover:bg-[#005a99]' : ''}
                                            ${!isSelected && !isLocked ? 'bg-white border-[#85c3f0] text-[#429fe5]' : ''}
                                            ${isLocked && !isSelected ? 'opacity-50 hover:opacity-100 bg-zinc-50 border-zinc-300 text-zinc-500 hover:border-[#85c3f0] hover:text-[#429fe5]' : ''}
                                        `}
                                    >
                                        {retiro.ordenDeRetiro}
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>

                {/* Lado Derecho: Detalles de la Orden */}
                <div className="pl-0 lg:pl-4">
                    {selectedRetiro ? (
                        <div className="flex flex-col items-center lg:items-end text-center lg:text-right w-full fade-in">
                            <h2 className="text-4xl font-black text-[#0070bc] mb-2 mt-4">
                                {selectedRetiro.ordenDeRetiro}
                            </h2>

                            <p className="text-[#0070bc] font-bold text-2xl mb-8 mt-2 bg-blue-50 px-6 py-2 rounded-full border border-blue-200">
                                Total a Cobrar: <span className="font-black text-blue-800">{displayTotal(selectedRetiro)}</span>
                            </p>

                            <h3 className="text-lg font-bold text-zinc-800 mb-6 w-full lg:text-right">Abonos de la orden:</h3>
                            <div className="flex flex-col gap-4 w-full items-end">
                                {getOrdenes(selectedRetiro).length > 0 ? (
                                    getOrdenes(selectedRetiro).map((po, i) => {
                                        const costStr = po.orderCosto || "";
                                        const curSym = costStr.includes('USD') || costStr.includes('U$S') ? 'USD' : (costStr.includes('$') ? 'UYU' : 'USD');
                                        const rawValor = parseFloat(costStr.replace(/[^0-9.-]+/g, "")) || 0;
                                        const isPaid = po.orderIdMetodoPago !== null || po.orderPago !== null;

                                        let valorConvertidoDest = "";
                                        if (moneda === 'UYU' && (curSym === 'USD' || curSym === 'U$S') && cotizacion) {
                                            valorConvertidoDest = ` ($ ${(rawValor * cotizacion).toFixed(2)})`;
                                        }
                                        if (moneda === 'USD' && (curSym === '$' || curSym === 'UYU') && cotizacion) {
                                            valorConvertidoDest = ` (USD ${(rawValor / cotizacion).toFixed(2)})`;
                                        }

                                        return (
                                            <div
                                                key={i}
                                                className={`w-full border-2 rounded-full px-6 py-3 font-bold flex flex-col md:flex-row justify-between items-center transition-all bg-white
                                                    ${isPaid ? 'border-green-300 text-green-600 bg-green-50/50' : 'border-[#85c3f0] text-[#0070bc]'}
                                                `}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <span>{po.orderNumber || `Item ${i + 1}`}</span>
                                                    {isPaid && <span className="text-xs bg-green-500 text-white px-2 py-0.5 rounded-full uppercase tracking-wider">Ya Pagado</span>}
                                                </div>

                                                <div className="mt-2 md:mt-0 opacity-90">
                                                    Costo total: {curSym} {rawValor.toFixed(2)} {valorConvertidoDest}
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p className="text-zinc-500">No hay detalles de órdenes.</p>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-zinc-400 opacity-70">
                            <i className="fa-solid fa-cash-register text-6xl mb-4 text-[#85c3f0]"></i>
                            <p className="font-medium">Seleccione una orden libre para cobrarla.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CargaGestionPagosView;
