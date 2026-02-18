import { useState } from 'react';
import { Button } from '../ui/Button.jsx';
import { Mail } from 'lucide-react';
import { API_URL } from '../../services/apiClient';

const ForgotPasswordPage = () => {
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        if (!email.trim()) {
            setError('Por favor, ingresá tu email.');
            return;
        }

        setIsLoading(true);
        try {
            const response = await fetch(`${API_URL}/auth/forgot-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });
            const data = await response.json();

            if (response.ok && data.success) {
                setSuccess('Se envió un enlace de recuperación a tu email. Revisá tu bandeja de entrada.');
            } else {
                setError(data.message || 'No se pudo procesar la solicitud.');
            }
        } catch (err) {
            setError('Error de conexión. Intentá de nuevo.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 relative overflow-hidden font-sans">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-cyan-400 via-magenta-500 to-yellow-400 z-50"></div>
            <div className="absolute -top-40 -right-40 w-96 h-96 bg-cyan-200 rounded-full blur-3xl opacity-30"></div>
            <div className="absolute top-40 -left-20 w-72 h-72 bg-magenta-200 rounded-full blur-3xl opacity-30"></div>

            <div className="bg-white p-10 rounded-3xl shadow-2xl shadow-slate-200/50 w-full max-w-md border border-slate-100 relative z-10 backdrop-blur-sm bg-white/90">
                <div className="flex flex-col items-center mb-6">
                    <img src="/assets/images/logo.png" alt="Logo" className="w-48 h-auto mb-4 object-contain" />
                    <h2 className="text-xl font-bold text-slate-800">Recuperar contraseña</h2>
                    <p className="text-sm text-slate-400 text-center mt-1">Ingresá tu email y te enviaremos un enlace para restablecer tu contraseña</p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    <div className="space-y-1">
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-wider ml-1">Email</label>
                        <div className="relative group">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-cyan-600 transition-colors">
                                <Mail size={18} />
                            </div>
                            <input
                                type="email"
                                className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 focus:bg-white transition-all outline-none font-semibold text-slate-700 placeholder-slate-400"
                                placeholder="tu@email.com"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-50 text-red-600 p-3 rounded-xl text-xs font-bold flex items-center gap-2 border border-red-100">
                            <i className="fa-solid fa-circle-exclamation"></i>
                            {error}
                        </div>
                    )}

                    {success && (
                        <div className="bg-green-50 text-green-600 p-3 rounded-xl text-xs font-bold flex items-center gap-2 border border-green-100">
                            <i className="fa-solid fa-circle-check"></i>
                            {success}
                        </div>
                    )}

                    <Button
                        type="submit"
                        className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold shadow-lg shadow-slate-900/20 active:scale-[0.98] transition-all flex justify-center items-center gap-2 mt-2"
                        isLoading={isLoading}
                    >
                        Enviar enlace de recuperación
                    </Button>

                    <p className="text-center text-sm text-slate-500">
                        <a href="/login" className="font-bold text-cyan-600 hover:text-cyan-700 transition-colors">
                            ← Volver al login
                        </a>
                    </p>
                </form>
            </div>
        </div>
    );
};

export default ForgotPasswordPage;
