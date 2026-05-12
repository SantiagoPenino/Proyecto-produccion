import React, { useState, useEffect, useRef } from 'react';
import { AlertCircle, Lock, FileText, CheckCircle, XCircle } from 'lucide-react';

/**
 * AlertaAutorizacionModal
 * Modal de alerta de autorización unificado para autorizar entregas con deuda.
 * Reemplaza el Swal.fire para tener un estilo consistente en toda la app.
 *
 * Props:
 *  - visible: boolean
 *  - titulo?: string
 *  - subtitulo?: string
 *  - onConfirm(password, observacion): void
 *  - onCancel(): void
 */
const AlertaAutorizacionModal = ({
    visible,
    titulo = '!ALERTA!',
    subtitulo = 'Este retiro DEBE SER ABONADO. Por favor verifique que pase por caja y confirme el pago.',
    leyenda = 'ESTO ES UNA EXCEPCIONALIDAD',
    onConfirm,
    onCancel,
}) => {
    const [password, setPassword] = useState('');
    const [obs, setObs] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const passRef = useRef(null);

    useEffect(() => {
        if (visible) {
            setPassword('');
            setObs('');
            setError('');
            setLoading(false);
            setTimeout(() => passRef.current?.focus(), 100);
        }
    }, [visible]);

    if (!visible) return null;

    const handleConfirm = async () => {
        if (!password.trim()) { setError('La contraseña de autorización es obligatoria.'); return; }
        if (!obs.trim()) { setError('La explicación / observación es obligatoria.'); return; }
        setError('');
        setLoading(true);
        try {
            await onConfirm(password, obs);
        } finally {
            setLoading(false);
        }
    };

    const handleKey = (e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && e.ctrlKey) handleConfirm();
    };

    return (
        <div
            className="fixed inset-0 z-[9999] bg-black/60 flex items-center justify-center p-4"
            onKeyDown={handleKey}
        >
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm p-8 flex flex-col items-center gap-4 animate-in zoom-in-95 duration-200">

                {/* Icono */}
                <div className="w-16 h-16 bg-rose-100 rounded-full flex items-center justify-center mb-1">
                    <AlertCircle className="text-rose-500" size={36} strokeWidth={2} />
                </div>

                {/* Título */}
                <h2 className="text-2xl font-black text-zinc-800 text-center">{titulo}</h2>

                {/* Subtítulo */}
                <p className="text-zinc-600 text-center text-sm leading-relaxed">{subtitulo}</p>

                {/* Leyenda badge */}
                <span className="text-rose-600 font-black text-xs tracking-widest uppercase">{leyenda}</span>

                {/* Campos */}
                <div className="w-full flex flex-col gap-3 mt-2">
                    <div>
                        <label className="block text-sm font-bold text-zinc-700 mb-1">
                            Contraseña de Autorización
                        </label>
                        <div className="relative">
                            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={16} />
                            <input
                                ref={passRef}
                                type="password"
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                placeholder="••••••••"
                                className="w-full pl-9 pr-4 py-2.5 border border-zinc-300 rounded-xl outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400 text-zinc-800 font-bold"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-zinc-700 mb-1">
                            Explicación o Detalle <span className="text-rose-500">(Requerido)</span>
                        </label>
                        <div className="relative">
                            <FileText className="absolute left-3 top-3 text-zinc-400" size={16} />
                            <textarea
                                value={obs}
                                onChange={e => setObs(e.target.value)}
                                placeholder="Ej: Cliente acuerda pago al retiro, cuota pendiente..."
                                rows={3}
                                className="w-full pl-9 pr-4 py-2.5 border border-zinc-300 rounded-xl outline-none focus:ring-2 focus:ring-rose-400 focus:border-rose-400 text-zinc-700 resize-none"
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="bg-rose-50 border border-rose-200 text-rose-600 text-sm font-bold px-3 py-2 rounded-xl">
                            ⚠️ {error}
                        </div>
                    )}
                </div>

                {/* Botones */}
                <div className="flex gap-3 w-full mt-2">
                    <button
                        onClick={onCancel}
                        disabled={loading}
                        className="flex-1 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 font-bold py-3 rounded-2xl transition-colors flex items-center justify-center gap-2"
                    >
                        <XCircle size={18} /> Cancelar
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={loading}
                        className="flex-1 bg-rose-500 hover:bg-rose-600 disabled:opacity-60 text-white font-black py-3 rounded-2xl transition-colors flex items-center justify-center gap-2 shadow-md"
                    >
                        <CheckCircle size={18} />
                        {loading ? 'Autorizando...' : 'Autorizar'}
                    </button>
                </div>

                <p className="text-xs text-zinc-400 text-center">Ctrl+Enter para confirmar · Esc para cancelar</p>
            </div>
        </div>
    );
};

export default AlertaAutorizacionModal;


