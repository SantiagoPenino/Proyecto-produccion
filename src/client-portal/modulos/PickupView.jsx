import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import Lottie from 'lottie-react';
import loadingAnim from '../../assets/animations/loading.json';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/apiClient'; // Assuming user comes from here
import { CheckCircle, AlertCircle, ChevronRight, Truck, CreditCard, Download, MapPin, Package, Trash2, Plus } from 'lucide-react';
import { GlassCard } from '../pautas/GlassCard';
import { CustomButton } from '../pautas/CustomButton';
import { FormInput } from '../pautas/FormInput';

export const PickupView = () => {
    const { user } = useAuth();
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

    // Shipping/confirmation state
    const [shippingData, setShippingData] = useState(null);
    const [selectedFormaEnvio, setSelectedFormaEnvio] = useState(null);
    const [selectedAgencia, setSelectedAgencia] = useState(null);
    const [selectedDireccion, setSelectedDireccion] = useState('');
    const [showAddAddress, setShowAddAddress] = useState(false);
    const [newAlias, setNewAlias] = useState('');
    const [newDireccion, setNewDireccion] = useState('');
    const [newCiudad, setNewCiudad] = useState('');
    const [newLocalidad, setNewLocalidad] = useState('');
    const [loadingShipping, setLoadingShipping] = useState(false);

    useEffect(() => {
        const loadPickupOrders = async () => {
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
    }, []);

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

            const payload = {
                orders: ordersPayload,
                totalCost: Number((totalAmount || 0).toFixed(2)),
                lugarRetiro: 5
            };

            const res = await apiClient.post('/web-orders/pickup-orders/create', payload);

            if (res.success) {
                const code = res.data?.OReIdOrdenRetiro || res.data?.codigoRetiro || `RET-${Math.floor(Math.random() * 9000) + 1000}`;
                setPickupCode(code);
                sessionStorage.setItem('pickup_code', String(code));
                return code;
            } else {
                alert(res.error || "Error al crear retiro");
                return null;
            }
        } catch (error) {
            console.error(error);
            alert("Error al conectar con el servidor: " + error.message);
            return null;
        } finally {
            setLoading(false);
        }
    };

    const handleProceed = async () => {
        // Flujo Handy: crear link de pago con datos del retiro ya creado
        if (!pickupCode) {
            alert('No hay retiro creado.');
            return;
        }
        setLoading(true);
        try {
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
                ordenRetiro: pickupCode,
                totalAmount: totalAmount,
                activeCurrency: activeCurrency,
                bultosJSON: JSON.stringify(ordersPayload)
            };

            const res = await apiClient.post('/web-retiros/payment', payload);

            if (res.success && res.url) {
                window.open(res.url, '_blank');
                window.location.href = `/payment-status?txId=${res.transactionId}`;
            } else {
                alert("No se pudo generar el link de pago: " + (res.error || ""));
            }
        } catch (err) {
            console.error("Error al ir a pagar:", err);
            alert("Ocurrió un error al contactar la pasarela de pagos.");
        } finally {
            setLoading(false);
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
                alert(res.error || 'Error al guardar');
            }
        } catch (e) { alert('Error al guardar dirección'); }
    };

    const handleDeleteAddress = async (id) => {
        const result = await Swal.fire({
            title: '¿Eliminar dirección?',
            theme: 'dark',
            showCancelButton: true,
            confirmButtonColor: '#ff0000',
            cancelButtonColor: '#71717a',
            confirmButtonText: 'ELIMINAR',
            cancelButtonText: 'Cancelar'
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

    if (step === 'confirmation') return (
        <div className="animate-fade-in space-y-6">
            <button onClick={() => { setSelectedOrders([]); sessionStorage.removeItem('pickup_selected'); setStep('selection'); }} className="mb-2 flex items-center text-zinc-500 hover:text-black transition-colors">
                <ChevronRight className="rotate-180" size={20} /> Volver
            </button>

            {/* Header */}
            <div className="flex items-center gap-4 mb-2">
                <div className="p-3 bg-white border border-zinc-200 text-black rounded-xl shadow-sm">
                    <Package size={28} />
                </div>
                <div>
                    <h2 className="text-3xl font-bold text-neutral-800 tracking-tight">Retiro R-{pickupCode}</h2>
                    <p className="text-zinc-500 font-medium">Retiro creado. Revisá los datos y elegí forma de envío.</p>
                </div>
            </div>

            {/* Resumen de órdenes */}
            <GlassCard noPadding className="overflow-hidden">
                <div className="p-5 border-b border-zinc-200 bg-zinc-50/50">
                    <h3 className="font-bold text-zinc-800">Órdenes Seleccionadas</h3>
                </div>
                <div className="divide-y divide-zinc-100">
                    {selectedOrdersData.map(o => (
                        <div key={o.id} className="p-4 flex justify-between items-center">
                            <div>
                                <span className="font-mono font-bold text-zinc-700">{o.id}</span>
                                <p className="text-sm text-zinc-500 mt-0.5">{o.desc}</p>
                            </div>
                            <span className="font-bold text-zinc-800">
                                {o.currency === 'USD' ? 'US$' : '$'} {(o.amount || 0).toFixed(2)}
                            </span>
                        </div>
                    ))}
                </div>
                <div className="p-5 border-t border-zinc-200 bg-zinc-50/50 flex justify-between items-center">
                    <span className="font-bold text-zinc-600 uppercase text-sm">Total</span>
                    <span className="text-2xl font-black text-black">
                        {activeCurrency === 'USD' ? 'US$' : '$'} {(totalAmount || 0).toFixed(2)}
                    </span>
                </div>
            </GlassCard>

            {/* Forma de envío */}
            {shippingData && (
                <GlassCard className="space-y-5">
                    <h3 className="font-bold text-zinc-800 flex items-center gap-2">
                        <Truck size={20} /> Forma de Envío
                    </h3>

                    <select
                        value={selectedFormaEnvio || ''}
                        onChange={e => setSelectedFormaEnvio(Number(e.target.value))}
                        className="w-full p-3 border border-zinc-300 rounded-xl bg-white text-zinc-800 font-medium focus:outline-none focus:ring-2 focus:ring-black/10"
                    >
                        {shippingData.formasEnvio.map(f => (
                            <option key={f.ID} value={f.ID}>{f.Nombre}</option>
                        ))}
                    </select>

                    {/* Si es encomienda: agencia + dirección */}
                    {isEncomienda && (
                        <div className="space-y-4 pt-2">
                            {/* Agencia */}
                            <div>
                                <label className="block text-sm font-bold text-zinc-600 mb-2 uppercase">Agencia</label>
                                <select
                                    value={selectedAgencia || ''}
                                    onChange={e => setSelectedAgencia(Number(e.target.value))}
                                    className="w-full p-3 border border-zinc-300 rounded-xl bg-white text-zinc-800 font-medium focus:outline-none focus:ring-2 focus:ring-black/10"
                                >
                                    {shippingData.agencias.map(a => (
                                        <option key={a.ID} value={a.ID}>{a.Nombre}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Dirección */}
                            <div>
                                <label className="block text-sm font-bold text-zinc-600 mb-2 uppercase">Dirección de Envío</label>
                                {(shippingData.defaultDireccion || shippingData.direccionesGuardadas?.length > 0) ? (
                                    <div className="space-y-2">
                                        {/* Dirección principal */}
                                        {shippingData.defaultDireccion && (
                                            <label
                                                className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${selectedDireccion === shippingData.defaultDireccion ? 'border-black bg-zinc-50 ring-1 ring-black' : 'border-zinc-200 hover:border-zinc-400'}`}
                                                onClick={() => setSelectedDireccion(shippingData.defaultDireccion)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selectedDireccion === shippingData.defaultDireccion ? 'border-black' : 'border-zinc-300'}`}>
                                                        {selectedDireccion === shippingData.defaultDireccion && <div className="w-2 h-2 rounded-full bg-black" />}
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-bold text-zinc-800">📍 Principal</span>
                                                        <p className="text-sm text-zinc-600">{shippingData.defaultDireccion}</p>
                                                    </div>
                                                </div>
                                            </label>
                                        )}

                                        {/* Direcciones guardadas */}
                                        {shippingData.direccionesGuardadas?.map((d, idx) => (
                                            <div
                                                key={d.ID}
                                                className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${selectedDireccion === d.Direccion ? 'border-black bg-zinc-50 ring-1 ring-black' : 'border-zinc-200 hover:border-zinc-400'}`}
                                                onClick={() => setSelectedDireccion(d.Direccion)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${selectedDireccion === d.Direccion ? 'border-black' : 'border-zinc-300'}`}>
                                                        {selectedDireccion === d.Direccion && <div className="w-2 h-2 rounded-full bg-black" />}
                                                    </div>
                                                    <div>
                                                        <span className="text-sm font-bold text-zinc-800">{d.Alias || 'Dirección guardada'}</span>
                                                        <p className="text-sm text-zinc-600">
                                                            {d.Direccion}
                                                            {d.Ciudad ? `, ${d.Ciudad}` : ''}
                                                            {d.Localidad ? ` (${d.Localidad})` : ''}
                                                        </p>
                                                    </div>
                                                </div>
                                                {/* No permitir eliminar la primera dirección si no hay dirección principal */}
                                                {(idx > 0 || shippingData.defaultDireccion) && (
                                                    <button
                                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDeleteAddress(d.ID); }}
                                                        className="text-zinc-400 hover:text-red-500 transition-colors p-1"
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
                            {(shippingData.direccionesGuardadas?.length || 0) < 3 && (
                                <div>
                                    {!showAddAddress ? (
                                        <button
                                            onClick={() => setShowAddAddress(true)}
                                            className="flex items-center gap-2 text-sm font-bold text-zinc-500 hover:text-black transition-colors"
                                        >
                                            <Plus size={16} /> Agregar nueva dirección
                                        </button>
                                    ) : (
                                        <div className="space-y-3 p-4 bg-zinc-50 rounded-xl border border-zinc-200">
                                            <input
                                                type="text"
                                                placeholder='Alias (ej: "Oficina")'
                                                value={newAlias}
                                                onChange={e => setNewAlias(e.target.value)}
                                                className="w-full p-2.5 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                                            />
                                            <input
                                                type="text"
                                                placeholder="Dirección completa"
                                                value={newDireccion}
                                                onChange={e => setNewDireccion(e.target.value)}
                                                className="w-full p-2.5 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10"
                                            />
                                            <div className="grid grid-cols-2 gap-3">
                                                <select
                                                    value={newCiudad}
                                                    onChange={e => { setNewCiudad(e.target.value); setNewLocalidad(''); }}
                                                    className="w-full p-2.5 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10 bg-white"
                                                >
                                                    <option value="">Departamento...</option>
                                                    {shippingData.departamentos?.map(d => (
                                                        <option key={d.ID} value={d.Nombre}>{d.Nombre}</option>
                                                    ))}
                                                </select>
                                                <select
                                                    value={newLocalidad}
                                                    onChange={e => setNewLocalidad(e.target.value)}
                                                    className="w-full p-2.5 border border-zinc-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-black/10 bg-white"
                                                    disabled={!newCiudad}
                                                >
                                                    <option value="">Localidad...</option>
                                                    {(() => {
                                                        const dept = shippingData.departamentos?.find(d => d.Nombre === newCiudad);
                                                        if (!dept) return null;
                                                        return shippingData.localidades?.filter(l => l.DepartamentoID === dept.ID).map(l => (
                                                            <option key={l.ID} value={l.Nombre}>{l.Nombre}</option>
                                                        ));
                                                    })()}
                                                </select>
                                            </div>
                                            <div className="flex gap-2">
                                                <CustomButton onClick={handleAddAddress} variant="primary" className="text-sm py-2 px-4">
                                                    Guardar
                                                </CustomButton>
                                                <button onClick={() => { setShowAddAddress(false); setNewAlias(''); setNewDireccion(''); setNewCiudad(''); setNewLocalidad(''); }} className="text-sm text-zinc-500 hover:text-black">
                                                    Cancelar
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </GlassCard>
            )}

            {/* Botones finales */}
            <div className="flex justify-between items-center">
                <CustomButton
                    onClick={() => downloadReceipt(pickupCode)}
                    variant="secondary"
                    icon={Download}
                    className="py-3 px-6"
                >
                    Descargar Comprobante
                </CustomButton>

                {!user?.hasCredit && totalAmount > 0 && (
                    <CustomButton
                        onClick={handleProceed}
                        isLoading={loading}
                        variant="primary"
                        icon={CreditCard}
                        className="py-3 px-8 text-lg"
                    >
                        Ir a Pagar
                    </CustomButton>
                )}
            </div>
        </div>
    );

    // ========================
    // STEP: SELECTION (default)
    // ========================
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
                                <tr
                                    key={`${order.id}-${idx}`}
                                    onClick={() => handleToggleOrder(order.id)}
                                    className={`border-b border-zinc-100 hover:bg-zinc-50/50 transition-colors cursor-pointer ${selectedOrders.includes(order.id) ? 'bg-zinc-50' : ''}`}
                                >
                                    <td className="p-4 text-center">
                                        <input
                                            type="checkbox"
                                            className="w-5 h-5 rounded border-zinc-300 text-black focus:ring-black cursor-pointer accent-black"
                                            checked={selectedOrders.includes(order.id)}
                                            readOnly
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
                            onClick={async () => {
                                // 1. Crear retiro
                                const code = await handleCreatePickup();
                                if (!code) return;

                                // 2. Cargar datos de envío
                                setLoadingShipping(true);
                                try {
                                    const res = await apiClient.get('/web-orders/shipping-data');
                                    if (res.success) {
                                        setShippingData(res.data);
                                        setSelectedFormaEnvio(res.data.defaultFormaEnvioID || res.data.formasEnvio[0]?.ID);
                                        setSelectedAgencia(res.data.defaultAgenciaID || res.data.agencias[0]?.ID);
                                        setSelectedDireccion(res.data.defaultDireccion || '');
                                    }
                                } catch (e) {
                                    console.error('Error cargando datos de envío:', e);
                                }
                                setLoadingShipping(false);

                                // 3. Ir a confirmación
                                setStep('confirmation');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            disabled={selectedOrders.length === 0}
                            isLoading={loading || loadingShipping}
                            variant="primary"
                            icon={ChevronRight}
                            className="py-3 px-6"
                        >
                            Confirmar Retiro
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
