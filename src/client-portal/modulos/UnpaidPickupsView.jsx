import React, { useState, useEffect } from 'react';
import Lottie from 'lottie-react';
import loadingAnim from '../../assets/animations/Loading.json';
import { useAuth } from '../auth/AuthContext';
import { apiClient } from '../api/apiClient';
import { CreditCard, AlertCircle, ChevronRight, CheckCircle, Package } from 'lucide-react';
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
        
        // Anti-popup blocker: Abrir pestaña en blanco síncronamente en el momento del click
        const payWindow = window.open('about:blank', '_blank');
        
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
                // Navegar en la pestaña nueva
                if (payWindow) payWindow.location.href = url;
                
                // Navegar la original a la vista de status
                if (txId) {
                    window.location.href = `/portal/payment-status?txId=${txId}`;
                }
            } else {
                if (payWindow) payWindow.close();
                alert("No se pudo obtener el link de pago.");
            }
        } catch (error) {
            if (payWindow) payWindow.close();
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
                <span className="font-bold uppercase -mt-20 animate-pulse text-zinc-300">Buscando pagos pendientes...</span>
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
                <CreditCard size={48} strokeWidth={1} className="text-brand-gold" />
                <div>
                    <h2 className="text-lg font-bold text-zinc-300 uppercase tracking-tight">Pagos <span className="text-custom-cyan">Pendientes</span></h2>
                    <p className="text-zinc-500 uppercase text-xs">Retiros pendientes de pago.</p>
                </div>
            </div>

            {retiros.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center rounded-xl bg-brand-dark border border-zinc-800">
                    <div className="w-20 h-20 bg-emerald-900/30 rounded-full flex items-center justify-center mb-6">
                        <CheckCircle size={40} className="text-emerald-400" />
                    </div>
                    <h3 className="text-xl font-bold text-zinc-200 mb-2">¡Todo al día!</h3>
                    <p className="text-zinc-500 max-w-sm">
                        No tienes órdenes de retiro pendientes de pago en este momento.
                    </p>
                </div>
            ) : (
                <div className="grid gap-3">
                    {retiros.map((retiro) => {
                        let bultos = [];
                        try {
                            bultos = JSON.parse(retiro.BultosJSON || "[]");
                        } catch (e) { }

                        return (
                            <div key={retiro.OrdIdRetiro} className="overflow-hidden rounded-xl bg-brand-dark border border-zinc-800 hover:border-zinc-700 transition-all pt-3 px-4 pb-4 space-y-3">
                                {/* Header row */}
                                <div className="flex items-center justify-between">
                                    <span className="text-base font-black text-custom-cyan uppercase tracking-tight">{retiro.OrdIdRetiro}</span>
                                    <span className="px-2 py-0.5 bg-amber-900/30 text-amber-400 text-[10px] font-bold uppercase tracking-wider rounded-full border border-amber-700/40">
                                        Pendiente de Pago
                                    </span>
                                    <span className="text-xs text-zinc-500">
                                        {new Date(retiro.Fecha).toLocaleDateString()}
                                    </span>
                                </div>

                                {/* Orders list - full width */}
                                {bultos.length > 0 && (
                                    <div className="bg-custom-dark p-3 rounded-lg border border-zinc-800 space-y-1.5">
                                        {bultos.slice(0, 3).map((b, i) => (
                                            <div key={i} className="flex justify-between text-sm">
                                                <span className="text-zinc-400 truncate mr-3" title={b.desc}>{b.desc || b.orderNumber}</span>
                                                <span className="font-bold text-custom-cyan shrink-0">${b.amount}</span>
                                            </div>
                                        ))}
                                        {bultos.length > 3 && (
                                            <div className="text-xs text-zinc-600 pt-2 border-t border-zinc-800 mt-2">
                                                + {bultos.length - 3} artículos más
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Total + Pay button */}
                                <div className="flex items-center justify-between gap-3 pt-2 border-t border-zinc-800">
                                    <div>
                                        <p className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Total</p>
                                        <p className="text-lg font-black text-zinc-100">
                                            <span className="text-xs text-zinc-500 mr-1">{retiro.Moneda === 'USD' ? 'US$' : '$'}</span>
                                            {Number(retiro.Monto || 0).toFixed(2)}
                                        </p>
                                    </div>

                                    <CustomButton
                                        onClick={() => handlePay(retiro)}
                                        isLoading={payingId === retiro.OrdIdRetiro}
                                        disabled={payingId !== null}
                                        icon={CreditCard}
                                        className="w-1/2 md:w-auto !bg-custom-dark !text-zinc-400 hover:!text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5"
                                        whileHover={{ scale: 1 }}
                                        whileTap={{ scale: 1 }}
                                    >
                                        Pagar Online
                                    </CustomButton>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
