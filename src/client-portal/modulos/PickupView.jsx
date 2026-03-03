import React, { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/apiClient'; // Assuming user comes from here
import { CheckCircle, AlertCircle, ChevronRight, Truck, CreditCard, Download } from 'lucide-react';
import { GlassCard } from '../pautas/GlassCard';
import { CustomButton } from '../pautas/CustomButton';
import { FormInput } from '../pautas/FormInput';

export const PickupView = () => {
    const { user } = useAuth();
    const [selectedOrders, setSelectedOrders] = useState([]);
    const [readyOrders, setReadyOrders] = useState([]);
    const [pickupCode, setPickupCode] = useState(null);
    const [step, setStep] = useState('selection');
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(true);

    useEffect(() => {
        const loadPickupOrders = async () => {
            setFetching(true);
            try {
                const res = await apiClient.get('/web-orders/pickup-orders');
                if (res.success) {
                    setReadyOrders(res.data);
                }
            } catch (error) {
                console.error("Error loading pickup orders:", error);
            } finally {
                setFetching(false);
            }
        };
        loadPickupOrders();
    }, []);

    const handleToggleOrder = (orderId) => {
        if (selectedOrders.includes(orderId)) {
            setSelectedOrders(selectedOrders.filter(id => id !== orderId));
        } else {
            // Verificar que no se mezclen monedas
            const orderToAdd = readyOrders.find(o => o.id === orderId);
            if (orderToAdd && selectedOrders.length > 0) {
                const firstSelected = readyOrders.find(o => o.id === selectedOrders[0]);
                if (firstSelected && orderToAdd.currency !== firstSelected.currency) {
                    alert("⚠️ No es posible mezclar pagos en Dólares y Pesos Uruguayos en una misma transacción.\n\nPor favor, selecciona únicamente órdenes que compartan la misma moneda (ej: solo Dólares o solo Pesos) para poder redirigirte a la pasarela.");
                    return; // Bloquea la selección mixta
                }
            }
            setSelectedOrders([...selectedOrders, orderId]);
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

    const handleCreatePickup = async () => {
        setLoading(true);
        try {
            // Construir payload completo desde frontend
            const ordersPayload = selectedOrders.map(selId => {
                const order = readyOrders.find(o => o.id === selId);
                if (!order) return null;
                // Usar el ID visible (ej: "TWD-6253" o "67") en lugar del ID interno
                const orderNum = order.id.replace('#', '');
                return {
                    OrdIdOrden: order.rawId,
                    orderNumber: orderNum,
                    ordNombreTrabajo: order.desc.split(' - ').pop() || order.desc, // Extraemos el nombre si está concatenado
                    meters: String(order.quantityStr || ""),
                    MonSimbolo: order.currency === 'USD' ? 'USD' : '$',
                    costo: Number(Number(order.amount || 0).toFixed(2)),
                    estado: order.originalStatus,
                    tipodecliente: order.clientType || "Comun",
                    pago: order.isPaid ? 'Pagado' : 'No realizado',
                    checked: true,
                    clientId: order.clientId || 'N/A',
                    contact: order.contact || '',
                    // Keep old fields for backward compatibility just in case
                    costWithCurrency: `${order.currency === 'USD' ? 'USD' : '$'} ${typeof order.amount === 'number' ? order.amount.toFixed(2) : '0.00'}`
                };
            }).filter(Boolean);

            const payload = {
                orders: ordersPayload,
                totalCost: Number((totalAmount || 0).toFixed(2)),
                lugarRetiro: 5
            };

            const res = await apiClient.post('/web-orders/pickup-orders/create', payload);

            if (res.success) {
                // Priorizar OReIdOrdenRetiro de la respuesta externa
                const code = res.data?.OReIdOrdenRetiro || res.data?.codigoRetiro || `RET-${Math.floor(Math.random() * 9000) + 1000}`;
                setPickupCode(code);
                setStep('success');
                // Auto download receipt
                setTimeout(() => downloadReceipt(code), 1000);
            } else {
                alert(res.error || "Error al crear retiro");
            }
        } catch (error) {
            console.error(error);
            alert("Error al conectar con el servidor: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleProceed = async () => {
        if (user?.hasCredit || totalAmount === 0) {
            handleCreatePickup();
        } else {
            // Flujo Handy: 1) Crear retiro → 2) Crear link de pago con datos del retiro
            setLoading(true);
            try {
                // 1. Primero crear el retiro en React (igual que handleCreatePickup)
                const ordersForRetiro = selectedOrders.map(selId => {
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
                        pago: 'No realizado',
                        checked: true,
                        clientId: order.clientId || 'N/A',
                        contact: order.contact || '',
                        costWithCurrency: `${order.currency === 'USD' ? 'USD' : '$'} ${typeof order.amount === 'number' ? order.amount.toFixed(2) : '0.00'}`
                    };
                }).filter(Boolean);

                const retiroRes = await apiClient.post('/web-orders/pickup-orders/create', {
                    orders: ordersForRetiro,
                    totalCost: Number((totalAmount || 0).toFixed(2)),
                    lugarRetiro: 5
                });

                if (!retiroRes.success) {
                    alert(retiroRes.error || "Error al crear retiro");
                    setLoading(false);
                    return;
                }

                const ordenRetiro = retiroRes.data?.OReIdOrdenRetiro || retiroRes.data?.codigoRetiro;
                const reactOrderNumbers = retiroRes.data?.orderNumbers || ordersForRetiro.map(o => o.OrdIdOrden).filter(Boolean);

                console.log('[PickupView] Retiro creado:', ordenRetiro, 'OrderNumbers:', reactOrderNumbers);

                // 2. Crear link de pago Handy con datos del retiro
                // Usa el mismo endpoint que UnpaidPickupsView para consistencia
                const ordersPayload = selectedOrders.map(selId => {
                    const order = readyOrders.find(o => o.id === selId);
                    if (!order) return null;
                    return {
                        id: order.id,
                        rawId: order.rawId,
                        orderNumber: order.id.replace('#', ''),
                        desc: order.desc,
                        amount: order.amount,
                    };
                }).filter(Boolean);

                const payload = {
                    ordenRetiro: ordenRetiro,
                    totalAmount: totalAmount,
                    activeCurrency: activeCurrency,
                    bultosJSON: JSON.stringify(ordersPayload)
                };

                const res = await apiClient.post('/web-retiros/payment', payload);

                if (res.success && res.url) {
                    // Abrir Handy en nueva pestaña y redirigir esta pestaña a payment-status
                    window.open(res.url, '_blank');
                    window.location.href = `/payment-status?txId=${res.transactionId}`;
                } else {
                    // Retiro ya creado pero falló Handy — mostrar éxito del retiro
                    setPickupCode(ordenRetiro || 'ERROR');
                    setStep('success');
                    alert("El retiro se creó pero no se pudo generar el link de pago: " + (res.error || ""));
                }
            } catch (err) {
                console.error("Error al ir a pagar:", err);
                alert("Ocurrió un error al contactar la pasarela de pagos.");
            } finally {
                setLoading(false);
            }
        }
    };

    const handlePayment = (e) => {
        e.preventDefault();
        handleCreatePickup();
    };

    if (step === 'success') {
        return (
            <div className="max-w-xl mx-auto text-center py-12 animate-fade-in">
                <GlassCard className="flex flex-col items-center">
                    <div className="inline-flex p-4 bg-green-100 rounded-full text-green-600 mb-6">
                        <CheckCircle size={64} />
                    </div>
                    <h2 className="text-3xl font-bold text-neutral-800 mb-4">¡Retiro Habilitado!</h2>
                    <p className="text-neutral-600 mb-6">
                        {user?.hasCredit
                            ? "El importe ha sido cargado a tu Cuenta Corriente."
                            : "El pago se ha procesado correctamente."
                        }
                        <br />Ya puedes pasar por el mostrador de entregas.
                    </p>

                    <div className="bg-black p-6 rounded-xl inline-block shadow-lg mb-8 w-full max-w-sm">
                        <div className="text-white text-center">
                            <p className="text-xs uppercase tracking-widest text-zinc-400 mb-2">Código de Retiro</p>
                            <p className="text-4xl font-mono font-bold text-white tracking-wider">{pickupCode}</p>
                        </div>
                    </div>

                    <div className="mb-8">
                        <CustomButton onClick={() => downloadReceipt(pickupCode)} variant="secondary" icon={Download}>
                            Descargar Comprobante
                        </CustomButton>
                    </div>

                    <div>
                        <button onClick={() => { setStep('selection'); setSelectedOrders([]); }} className="text-black font-bold hover:underline">
                            Volver a lista de retiros
                        </button>
                    </div>
                </GlassCard>
            </div>
        );
    }

    if (step === 'payment') {
        return (
            <div className="max-w-2xl mx-auto animate-fade-in">
                <button onClick={() => setStep('selection')} className="mb-4 flex items-center text-zinc-500 hover:text-black transition-colors">
                    <ChevronRight className="rotate-180" size={20} /> Volver
                </button>

                <GlassCard noPadding className="overflow-hidden">
                    <div className="p-6 border-b border-zinc-200 bg-zinc-50/50">
                        <h2 className="text-xl font-bold text-neutral-800 flex items-center gap-2">
                            <CreditCard className="text-black" /> Pasarela de Pago
                        </h2>
                    </div>

                    <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div>
                            <p className="text-sm font-bold text-zinc-500 mb-4 uppercase">Resumen de Pago</p>
                            <ul className="space-y-3 mb-6">
                                {readyOrders.filter(o => selectedOrders.includes(o.id)).map(o => (
                                    <li key={o.id} className="flex justify-between text-sm">
                                        <span className="text-zinc-600">{o.desc}</span>
                                        <span className="font-medium">${o.amount}</span>
                                    </li>
                                ))}
                            </ul>
                            <div className="border-t border-zinc-200 pt-3 flex justify-between font-bold text-lg">
                                <span>Total a Pagar:</span>
                                <span className="text-black">${totalAmount}</span>
                            </div>
                        </div>

                        <form onSubmit={handlePayment} className="space-y-4">
                            <FormInput label="Número de Tarjeta" placeholder="0000 0000 0000 0000" required />
                            <div className="grid grid-cols-2 gap-4">
                                <FormInput label="Vencimiento" placeholder="MM/AA" required />
                                <FormInput label="CVC" placeholder="123" required />
                            </div>
                            <CustomButton type="submit" variant="primary" className="w-full mt-4" isLoading={loading}>
                                Pagar y Generar Código
                            </CustomButton>
                        </form>
                    </div>
                </GlassCard>
            </div>
        );
    }

    if (fetching) {
        return (
            <div className="flex flex-col justify-center items-center py-20 animate-pulse">
                <Truck className="text-zinc-300 mb-4" size={48} />
                <span className="text-zinc-400 font-bold text-lg">Buscando órdenes listas...</span>
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex items-center gap-4 mb-2">
                <div className="p-3 bg-white border border-zinc-200 text-black rounded-xl">
                    <Truck size={28} />
                </div>
                <div>
                    <h2 className="text-3xl font-bold text-neutral-800">Gestión de Retiros</h2>
                    <p className="text-zinc-500">Selecciona las órdenes que deseas retirar hoy.</p>
                </div>
            </div>

            <GlassCard noPadding className="overflow-hidden">
                {/* Desktop: Tabla */}
                <div className="hidden md:block">
                    <table className="w-full text-left">
                        <thead className="bg-zinc-50/50 border-b border-zinc-200">
                            <tr>
                                <th className="p-4 w-12 text-center">
                                    <input type="checkbox" className="rounded accent-black" disabled />
                                </th>
                                <th className="p-4 text-sm font-bold text-zinc-600">Orden ID</th>
                                <th className="p-4 text-sm font-bold text-zinc-600">Descripción</th>
                                <th className="p-4 text-sm font-bold text-zinc-600">Fecha Listo</th>
                                <th className="p-4 text-sm font-bold text-zinc-600 text-right">Saldo Pendiente</th>
                                <th className="p-4 text-sm font-bold text-zinc-600 text-center">Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {readyOrders.map((order, idx) => (
                                <tr key={`${order.id}-${idx}`} className={`border-b border-zinc-100 hover:bg-zinc-50/50 transition-colors ${selectedOrders.includes(order.id) ? 'bg-zinc-50' : ''}`}>
                                    <td className="p-4 text-center">
                                        <input
                                            type="checkbox"
                                            className="w-5 h-5 rounded border-zinc-300 text-black focus:ring-black cursor-pointer accent-black"
                                            checked={selectedOrders.includes(order.id)}
                                            onChange={() => handleToggleOrder(order.id)}
                                        />
                                    </td>
                                    <td className="p-4 font-mono font-medium text-zinc-700">{order.id}</td>
                                    <td className="p-4 text-zinc-600">{order.desc}</td>
                                    <td className="p-4 text-zinc-500 text-sm">{order.date}</td>
                                    <td className="p-4 text-right font-medium text-zinc-800">
                                        {order.isPaid ? (
                                            <span className="text-green-600 flex items-center justify-end gap-1">
                                                <CheckCircle size={14} /> Pagado
                                            </span>
                                        ) : (
                                            `${order.currency === 'USD' ? 'US$' : '$'} ${(order.amount || 0).toFixed(2)}`
                                        )}
                                    </td>
                                    <td className="p-4 text-center">
                                        <span className={`text-xs px-2 py-1 rounded-full font-bold border ${order.isPaid ? 'bg-green-100 text-green-700 border-green-200' : 'bg-green-100 text-green-700 border-green-200'}`}>
                                            {order.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Mobile: Cards */}
                <div className="md:hidden divide-y divide-zinc-100">
                    {readyOrders.map((order, idx) => (
                        <div
                            key={`mobile-${order.id}-${idx}`}
                            onClick={() => handleToggleOrder(order.id)}
                            className={`p-4 flex items-start gap-3 cursor-pointer transition-colors ${selectedOrders.includes(order.id) ? 'bg-zinc-50' : ''}`}
                        >
                            <input
                                type="checkbox"
                                className="w-5 h-5 mt-0.5 rounded border-zinc-300 text-black focus:ring-black cursor-pointer accent-black"
                                checked={selectedOrders.includes(order.id)}
                                readOnly
                            />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="font-mono font-bold text-sm text-zinc-800">{order.id}</span>
                                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold border ${order.isPaid ? 'bg-green-100 text-green-700 border-green-200' : 'bg-green-100 text-green-700 border-green-200'}`}>
                                        {order.status}
                                    </span>
                                </div>
                                <p className="text-sm text-zinc-600 truncate">{order.desc}</p>
                                <div className="flex items-center justify-between mt-2 text-xs text-zinc-500">
                                    <span>{order.date}</span>
                                    <span className="font-medium text-zinc-800">
                                        {order.isPaid ? (
                                            <span className="text-green-600 flex items-center gap-1">
                                                <CheckCircle size={12} /> Pagado
                                            </span>
                                        ) : (
                                            `${order.currency === 'USD' ? 'US$' : '$'} ${(order.amount || 0).toFixed(2)}`
                                        )}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="p-6 bg-zinc-50/50 border-t border-zinc-200 flex flex-col md:flex-row justify-between items-center gap-4">
                    <div className="text-zinc-600">
                        <span className="font-bold text-zinc-800">{selectedOrders.length}</span> órdenes seleccionadas
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="text-right">
                            <p className="text-xs text-zinc-500 uppercase font-bold">Total a Pagar</p>
                            <p className="text-2xl font-bold text-zinc-800">
                                {activeCurrency === 'USD' ? 'US$' : '$'} {(totalAmount || 0).toFixed(2)}
                            </p>
                        </div>
                        <CustomButton
                            onClick={handleProceed}
                            disabled={selectedOrders.length === 0}
                            variant="primary"
                            icon={ChevronRight}
                            className="py-3 px-6"
                        >
                            {user?.hasCredit || totalAmount === 0 ? 'Confirmar Retiro' : 'Ir a Pagar'}
                        </CustomButton>

                        <CustomButton
                            onClick={handleCreatePickup}
                            disabled={selectedOrders.length === 0 || loading}
                            variant="secondary"
                            className="py-3 px-6 ml-2 bg-zinc-200 text-zinc-600 hover:bg-zinc-300 border border-zinc-200"
                            title="Generar retiro directamente (Solo Pruebas)"
                        >
                            🛠️
                        </CustomButton>
                    </div>
                </div>
            </GlassCard>

            {/* Aviso de Cuenta Corriente */}
            {user?.hasCredit ? (
                <div className="flex items-center gap-3 p-4 bg-green-50 text-green-800 rounded-lg border border-green-200">
                    <CheckCircle size={20} />
                    <p className="text-sm">Tu cuenta corriente está habilitada. Puedes retirar sin pago inmediato.</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 p-4 bg-amber-50 text-amber-800 rounded-lg border border-amber-200">
                    <AlertCircle size={20} />
                    <p className="text-sm">Se requiere pago online para generar el código de retiro.</p>
                </div>
            )}
        </div>
    );
};
