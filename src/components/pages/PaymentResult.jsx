import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle, Clock, ArrowLeft, CreditCard, Package, Receipt } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

const statusConfig = {
    Pagado: {
        icon: CheckCircle2,
        title: '¡Pago realizado con éxito!',
        subtitle: 'Tu pago fue procesado correctamente.',
        color: '#22c55e',
        bg: 'rgba(34, 197, 94, 0.1)',
        border: 'rgba(34, 197, 94, 0.3)'
    },
    Fallido: {
        icon: XCircle,
        title: 'El pago no pudo completarse',
        subtitle: 'Hubo un problema al procesar tu pago. Podés intentarlo nuevamente.',
        color: '#ef4444',
        bg: 'rgba(239, 68, 68, 0.1)',
        border: 'rgba(239, 68, 68, 0.3)'
    },
    Pendiente: {
        icon: Clock,
        title: 'Pago pendiente',
        subtitle: 'Tu pago está siendo procesado. Te notificaremos cuando se confirme.',
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.1)',
        border: 'rgba(245, 158, 11, 0.3)'
    },
    Creado: {
        icon: Clock,
        title: 'Procesando pago...',
        subtitle: 'Estamos verificando tu pago con la pasarela.',
        color: '#3b82f6',
        bg: 'rgba(59, 130, 246, 0.1)',
        border: 'rgba(59, 130, 246, 0.3)'
    }
};

const defaultConfig = statusConfig.Pendiente;

export default function PaymentResult() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const [txData, setTxData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const txId = searchParams.get('TransactionExternalId') || searchParams.get('transactionId') || searchParams.get('txId');

        if (!txId) {
            setLoading(false);
            setError('No se encontró información del pago.');
            return;
        }

        const fetchStatus = async () => {
            try {
                const res = await fetch(`${API_BASE}/web-orders/payment-status/${txId}`);
                if (!res.ok) throw new Error('Transacción no encontrada');
                const data = await res.json();
                setTxData(data);
            } catch (e) {
                setError(e.message);
            } finally {
                setLoading(false);
            }
        };

        fetchStatus();

        // Poll cada 5s si está en Creado o Pendiente (esperando webhook)
        const interval = setInterval(async () => {
            try {
                const res = await fetch(`${API_BASE}/web-orders/payment-status/${txId}`);
                if (res.ok) {
                    const data = await res.json();
                    setTxData(data);
                    if (data.status === 'Pagado' || data.status === 'Fallido') {
                        clearInterval(interval);
                    }
                }
            } catch { /* silently retry */ }
        }, 5000);

        return () => clearInterval(interval);
    }, [searchParams]);

    const config = txData ? (statusConfig[txData.status] || defaultConfig) : defaultConfig;
    const Icon = config.icon;

    return (
        <div style={{
            minHeight: '100vh',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'Inter', 'Segoe UI', sans-serif",
            padding: '20px'
        }}>
            <div style={{
                background: 'rgba(30, 41, 59, 0.8)',
                backdropFilter: 'blur(20px)',
                borderRadius: '24px',
                border: `1px solid ${config.border}`,
                padding: '40px',
                maxWidth: '520px',
                width: '100%',
                boxShadow: `0 0 60px ${config.bg}`
            }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px 0' }}>
                        <div style={{
                            width: '40px', height: '40px', border: '3px solid rgba(148,163,184,0.2)',
                            borderTopColor: '#3b82f6', borderRadius: '50%',
                            animation: 'spin 0.8s linear infinite', margin: '0 auto 16px'
                        }} />
                        <p style={{ color: '#94a3b8', fontSize: '14px' }}>Consultando estado del pago...</p>
                    </div>
                ) : error && !txData ? (
                    <div style={{ textAlign: 'center' }}>
                        <XCircle size={48} color="#ef4444" style={{ marginBottom: 16 }} />
                        <h2 style={{ color: '#f8fafc', fontSize: '20px', margin: '0 0 8px' }}>No se encontró la transacción</h2>
                        <p style={{ color: '#94a3b8', fontSize: '14px', margin: '0 0 24px' }}>{error}</p>
                        <button onClick={() => navigate('/portal/pickup')} style={btnStyle(config.color)}>
                            <ArrowLeft size={16} /> Volver al Portal
                        </button>
                    </div>
                ) : txData && (
                    <>
                        {/* Status Header */}
                        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
                            <div style={{
                                width: '72px', height: '72px', borderRadius: '50%',
                                background: config.bg, display: 'flex', alignItems: 'center',
                                justifyContent: 'center', margin: '0 auto 20px',
                                animation: 'pulse 2s ease-in-out infinite'
                            }}>
                                <Icon size={36} color={config.color} />
                            </div>
                            <h1 style={{ color: '#f8fafc', fontSize: '22px', fontWeight: 700, margin: '0 0 8px' }}>
                                {config.title}
                            </h1>
                            <p style={{ color: '#94a3b8', fontSize: '14px', margin: 0, lineHeight: 1.5 }}>
                                {config.subtitle}
                            </p>
                        </div>

                        {/* Amount Section */}
                        <div style={{
                            background: 'rgba(15, 23, 42, 0.6)', borderRadius: '16px',
                            padding: '20px', marginBottom: '16px',
                            border: '1px solid rgba(148, 163, 184, 0.08)'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ color: '#64748b', fontSize: '13px' }}>Total pagado</span>
                                <span style={{ color: '#f8fafc', fontSize: '28px', fontWeight: 700 }}>
                                    {txData.currencySymbol} {Number(txData.totalAmount).toFixed(2)}
                                </span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
                                <span style={{ color: '#64748b', fontSize: '12px' }}>Moneda</span>
                                <span style={{ color: '#cbd5e1', fontSize: '13px' }}>{txData.currency}</span>
                            </div>
                        </div>

                        {/* Details Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
                            {txData.ordenRetiro && (
                                <InfoCard icon={<Receipt size={14} />} label="Código de Retiro"
                                    value={txData.status === 'Pagado' ? String(txData.ordenRetiro).replace('R-', 'PW-') : String(txData.ordenRetiro)} />
                            )}
                            {txData.paymentMethod && (
                                <InfoCard icon={<CreditCard size={14} />} label="Medio de pago" value={txData.paymentMethod} />
                            )}
                        </div>

                        {/* Orders List */}
                        {txData.orders?.length > 0 && (
                            <div style={{
                                background: 'rgba(15, 23, 42, 0.6)', borderRadius: '12px',
                                padding: '14px', marginBottom: '24px',
                                border: '1px solid rgba(148, 163, 184, 0.08)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                                    <Package size={14} color="#64748b" />
                                    <span style={{ color: '#64748b', fontSize: '12px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        Pedidos ({txData.orders.length})
                                    </span>
                                </div>
                                {txData.orders.map((order, i) => (
                                    <div key={i} style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '8px 0', borderTop: i > 0 ? '1px solid rgba(148,163,184,0.06)' : 'none'
                                    }}>
                                        <span style={{ color: '#cbd5e1', fontSize: '13px' }}>
                                            {order.id || order.desc}
                                        </span>
                                        <span style={{ color: '#94a3b8', fontSize: '13px', fontFamily: 'monospace' }}>
                                            {txData.currencySymbol} {Number(order.amount || 0).toFixed(2)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Transaction ID */}
                        <div style={{
                            background: 'rgba(15, 23, 42, 0.4)', borderRadius: '8px',
                            padding: '10px 14px', marginBottom: '24px', textAlign: 'center'
                        }}>
                            <span style={{ color: '#475569', fontSize: '11px' }}>ID: </span>
                            <span style={{ color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>
                                {txData.transactionId}
                            </span>
                        </div>

                        {/* Action Button */}
                        <button
                            onClick={() => navigate('/portal/pickup')}
                            style={btnStyle(config.color)}
                            onMouseOver={e => e.target.style.transform = 'translateY(-2px)'}
                            onMouseOut={e => e.target.style.transform = 'translateY(0)'}
                        >
                            <ArrowLeft size={16} />
                            Volver al Portal
                        </button>
                    </>
                )}
            </div>

            <style>{`
                @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }
                @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
}

function InfoCard({ icon, label, value }) {
    return (
        <div style={{
            background: 'rgba(15, 23, 42, 0.6)', borderRadius: '12px', padding: '14px',
            border: '1px solid rgba(148, 163, 184, 0.08)'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
                <span style={{ color: '#64748b' }}>{icon}</span>
                <span style={{ color: '#64748b', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</span>
            </div>
            <span style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600 }}>{value}</span>
        </div>
    );
}

function btnStyle(color) {
    return {
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
        width: '100%', padding: '14px 24px',
        background: `linear-gradient(135deg, ${color}, ${color}cc)`,
        color: '#fff', border: 'none', borderRadius: '12px',
        fontSize: '15px', fontWeight: 600, cursor: 'pointer',
        transition: 'all 0.2s ease'
    };
}
