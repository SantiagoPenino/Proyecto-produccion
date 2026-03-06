import React, { useState, useEffect } from 'react';
import Lottie from 'lottie-react';
import loadingAnim from '../../assets/animations/loading.json';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/apiClient';
import { CreditCard, AlertCircle, ChevronRight, CheckCircle, Package } from 'lucide-react';
import { GlassCard } from '../pautas/GlassCard';
import { CustomButton } from '../pautas/CustomButton';

export const UnpaidPickupsView = () => {
    const { user } = useAuth();
    const [retiros, setRetiros] = useState([]);
    const [loading, setLoading] = useState(true);
    const [payingId, setPayingId] = useState(null);

    useEffect(() => {
        const fetchRetiros = async () => {
            try {
                const res = await apiClient.get('/web-retiros/mis-retiros');
                if (res) {
                    // res is directly the array because we use res.data in axios, 
                    // but wait, apiClient usually returns {success: true, data: ...} or just the data depending on implementation.
                    // Let's check how pickupView did it: `const res = await apiClient.get('/web-orders/pickup-orders'); if (res.success) set(res.data)` 
                    // webRetirosController returns `res.json(result.recordset)` directly. 
                    // If apiClient wraps it, it might be in res.data or just res.
                    const data = Array.isArray(res) ? res : (res.data || []);
                    setRetiros(data);
                }
            } catch (error) {
                console.error("Error fetching unpaid retiros:", error);
            } finally {
                setLoading(false);
            }
        };
        fetchRetiros();
    }, []);

    const handlePay = async (retiro) => {
        setPayingId(retiro.OrdIdRetiro);
        try {
            const payload = {
                ordenRetiro: retiro.OrdIdRetiro,
                totalAmount: retiro.Monto,
                activeCurrency: retiro.Moneda || 'UYU',
                bultosJSON: retiro.BultosJSON
            };

            const res = await apiClient.post('/web-retiros/payment', payload);
            const url = res?.url || res?.data?.url;
            const txId = res?.transactionId || res?.data?.transactionId;

            if (url) {
                // Abrir Handy en nueva pestaña y redirigir esta a payment-status
                window.open(url, '_blank');
                if (txId) {
                    window.location.href = `/payment-status?txId=${txId}`;
                }
            } else {
                alert("No se pudo obtener el link de pago.");
            }
        } catch (error) {
            console.error("Error generating payment link:", error);
            alert("Error al contactar la pasarela de pagos.");
        } finally {
            setPayingId(null);
        }
    };

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center min-h-[60vh]">
                <Lottie animationData={loadingAnim} loop style={{ width: 250, height: 250 }} />
                <span className="font-bold uppercase -mt-20 animate-pulse">Buscando pagos pendientes...</span>
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex items-center gap-4 mb-2">
                <div className="p-3 bg-white border border-zinc-200 text-black rounded-xl shadow-sm">
                    <CreditCard size={28} />
                </div>
                <div>
                    <h2 className="text-3xl font-bold text-neutral-800 tracking-tight">Pagos Pendientes</h2>
                    <p className="text-zinc-500 font-medium">Gestiona y abona tus órdenes de retiro pendientes.</p>
                </div>
            </div>

            {retiros.length === 0 ? (
                <GlassCard className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6">
                        <CheckCircle size={40} className="text-emerald-500" />
                    </div>
                    <h3 className="text-xl font-bold text-zinc-800 mb-2">¡Todo al día!</h3>
                    <p className="text-zinc-500 max-w-sm">
                        No tienes órdenes de retiro pendientes de pago en este momento.
                    </p>
                </GlassCard>
            ) : (
                <div className="grid gap-6">
                    {retiros.map((retiro) => {
                        let bultos = [];
                        try {
                            bultos = JSON.parse(retiro.BultosJSON || "[]");
                        } catch (e) { }

                        return (
                            <GlassCard key={retiro.OrdIdRetiro} className="overflow-hidden p-0 border border-zinc-200 shadow-sm hover:border-zinc-300 transition-all">
                                <div className="p-6 md:p-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                                    <div className="flex-1 space-y-4">
                                        <div className="flex items-center gap-3">
                                            <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-bold uppercase tracking-wider rounded-lg border border-amber-200">
                                                Pendiente de Pago
                                            </span>
                                            <span className="text-sm font-bold text-zinc-400">
                                                {new Date(retiro.Fecha).toLocaleDateString()}
                                            </span>
                                        </div>

                                        <div>
                                            <h3 className="text-2xl font-black text-zinc-800 uppercase italic tracking-tight">
                                                ORDEN: {retiro.OrdIdRetiro}
                                            </h3>
                                            <p className="text-sm text-zinc-500 mt-1 flex items-center gap-2">
                                                <Package size={16} /> {bultos.length} artículo(s) en esta orden
                                            </p>
                                        </div>

                                        {bultos.length > 0 && (
                                            <div className="bg-zinc-50 p-4 rounded-xl border border-zinc-100 space-y-2">
                                                {bultos.slice(0, 3).map((b, i) => (
                                                    <div key={i} className="flex justify-between text-sm">
                                                        <span className="text-zinc-600 truncate max-w-[250px]" title={b.desc}>{b.desc || b.orderNumber}</span>
                                                        <span className="font-bold text-zinc-800">${b.amount}</span>
                                                    </div>
                                                ))}
                                                {bultos.length > 3 && (
                                                    <div className="text-xs text-zinc-400 pt-2 border-t border-zinc-200 mt-2">
                                                        + {bultos.length - 3} artículos más
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    <div className="w-full md:w-auto flex flex-col items-center md:items-end gap-6 bg-zinc-50 md:bg-transparent p-6 md:p-0 rounded-2xl">
                                        <div className="text-center md:text-right">
                                            <p className="text-xs uppercase font-bold text-zinc-400 tracking-widest mb-1">Total a Pagar</p>
                                            <p className="text-4xl font-black text-black">
                                                <span className="text-2xl text-zinc-400 mr-2">{retiro.Moneda === 'USD' ? 'US$' : '$'}</span>
                                                {Number(retiro.Monto || 0).toFixed(2)}
                                            </p>
                                        </div>

                                        <CustomButton
                                            onClick={() => handlePay(retiro)}
                                            isLoading={payingId === retiro.OrdIdRetiro}
                                            disabled={payingId !== null}
                                            icon={CreditCard}
                                            className="w-full md:w-auto px-8 py-4 shadow-xl hover:shadow-2xl transition-all"
                                        >
                                            Pagar Online Ahora
                                        </CustomButton>
                                    </div>
                                </div>
                            </GlassCard>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
