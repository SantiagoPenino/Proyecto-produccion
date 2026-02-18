import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/Button.jsx';
import { User, Lock, Mail, Eye, EyeOff, Phone, MapPin, FileText, Building } from 'lucide-react';
import { API_URL } from '../../services/apiClient';

const inputClass = "w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-cyan-300 focus:border-cyan-400 focus:bg-white transition-all outline-none font-semibold text-slate-700 placeholder-slate-400";
const labelClass = "text-xs font-bold text-slate-500 uppercase tracking-wider ml-1";
const iconClass = "absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400 group-focus-within:text-cyan-600 transition-colors";

const Field = ({ label, icon: Icon, required, error, children }) => (
    <div className="space-y-1">
        <label className={labelClass}>
            {label} {required && <span className="text-red-400">*</span>}
        </label>
        <div className="relative group">
            <div className={iconClass}><Icon size={18} /></div>
            {children}
        </div>
        {error && <p className="text-red-500 text-xs font-semibold ml-1 mt-0.5">{error}</p>}
    </div>
);

const RegisterPage = () => {
    const [form, setForm] = useState({
        idCliente: '', email: '', password: '', confirmPassword: '',
        nombre: '', apellido: '', razonSocial: '', rut: '',
        direccion: '', telefono: '', documento: ''
    });
    const [fieldErrors, setFieldErrors] = useState({});
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const navigate = useNavigate();

    const set = (key) => (e) => {
        setForm(f => ({ ...f, [key]: e.target.value }));
        // Clear field error when user starts typing
        if (fieldErrors[key]) {
            setFieldErrors(fe => ({ ...fe, [key]: '' }));
        }
    };

    const validateField = (key, value) => {
        const v = value.trim();
        const required = ['idCliente', 'email', 'password', 'confirmPassword', 'nombre', 'apellido', 'direccion', 'telefono'];

        if (required.includes(key) && !v) {
            return 'Este campo es obligatorio';
        }

        switch (key) {
            case 'email':
                if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
                    return 'Email inválido';
                break;
            case 'password':
                if (v && v.length < 6)
                    return 'Mínimo 6 caracteres';
                if (v && !/[A-Z]/.test(v))
                    return 'Debe contener al menos una mayúscula';
                if (v && !/[0-9]/.test(v))
                    return 'Debe contener al menos un número';
                break;
            case 'confirmPassword':
                if (v && v !== form.password)
                    return 'Las contraseñas no coinciden';
                break;
            case 'telefono':
                if (v && !/^[+\d\s()-]{6,20}$/.test(v))
                    return 'Teléfono inválido';
                break;
            case 'rut':
                if (v && !/^\d{12}$/.test(v))
                    return 'RUT debe ser 12 dígitos numéricos';
                break;
        }
        return '';
    };

    const handleBlur = (key) => () => {
        const err = validateField(key, form[key]);
        setFieldErrors(fe => ({ ...fe, [key]: err }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setSuccess('');

        // Validate all fields
        const allKeys = Object.keys(form);
        const errors = {};
        let hasError = false;
        for (const key of allKeys) {
            const err = validateField(key, form[key]);
            if (err) {
                errors[key] = err;
                hasError = true;
            }
        }
        setFieldErrors(errors);

        if (hasError) {
            setError('Corregí los errores marcados en el formulario.');
            return;
        }

        setIsLoading(true);
        try {
            const response = await fetch(`${API_URL}/web-auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idcliente: form.idCliente,
                    name: form.nombre,
                    email: form.email,
                    password: form.password,
                    company: form.razonSocial,
                    phone: form.telefono,
                    address: form.direccion,
                    ruc: form.rut,
                    fantasyName: `${form.nombre} ${form.apellido}`,
                    documento: form.documento
                })
            });
            const data = await response.json();

            if (response.ok && data.success) {
                setSuccess('¡Cuenta creada exitosamente! Redirigiendo al login...');
                setTimeout(() => navigate('/login'), 2000);
            } else {
                setError(data.message || 'Error al registrar la cuenta.');
            }
        } catch (err) {
            setError('Error de conexión. Intentá de nuevo.');
        } finally {
            setIsLoading(false);
        }
    };


    // Override global body overflow:hidden for this page
    useEffect(() => {
        document.body.style.overflow = 'auto';
        return () => { document.body.style.overflow = 'hidden'; };
    }, []);

    return (
        <div className="min-h-screen bg-slate-50 relative font-sans py-10 px-4">
            <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-cyan-400 via-magenta-500 to-yellow-400 z-50"></div>

            <div className="bg-white p-10 rounded-3xl shadow-2xl shadow-slate-200/50 w-full max-w-lg border border-slate-100 relative z-10 mx-auto">
                <div className="flex flex-col items-center mb-6">
                    <img src="/assets/images/logo.png" alt="Logo" className="w-48 h-auto mb-4 object-contain" />
                    <h2 className="text-xl font-bold text-slate-800">Crear cuenta</h2>
                    <p className="text-sm text-slate-400">Registrate con tu ID de Cliente</p>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {/* ID de Cliente */}
                    <Field label="ID de Cliente" icon={User} required error={fieldErrors.idCliente}>
                        <input type="text" className={`${inputClass} ${fieldErrors.idCliente ? 'border-red-400 focus:ring-red-300' : ''}`} placeholder="Ej: Kasak-1899" value={form.idCliente} onChange={set('idCliente')} onBlur={handleBlur('idCliente')} />
                    </Field>

                    {/* Email */}
                    <Field label="Email" icon={Mail} required error={fieldErrors.email}>
                        <input type="email" className={`${inputClass} ${fieldErrors.email ? 'border-red-400 focus:ring-red-300' : ''}`} placeholder="tu@email.com" value={form.email} onChange={set('email')} onBlur={handleBlur('email')} />
                    </Field>

                    {/* Contraseña | Confirmar Contraseña */}
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className={labelClass}>Contraseña <span className="text-red-400">*</span></label>
                            <div className="relative group">
                                <div className={iconClass}><Lock size={18} /></div>
                                <input type={showPassword ? "text" : "password"} className={`${inputClass} ${fieldErrors.password ? 'border-red-400 focus:ring-red-300' : ''}`} placeholder="••••••••" value={form.password} onChange={set('password')} onBlur={handleBlur('password')} />
                            </div>
                            {fieldErrors.password && <p className="text-red-500 text-xs font-semibold ml-1 mt-0.5">{fieldErrors.password}</p>}
                        </div>
                        <div className="space-y-1">
                            <label className={labelClass}>Confirmar <span className="text-red-400">*</span></label>
                            <div className="relative group">
                                <div className={iconClass}><Lock size={18} /></div>
                                <input type={showPassword ? "text" : "password"} className={`${inputClass} ${fieldErrors.confirmPassword ? 'border-red-400 focus:ring-red-300' : ''}`} placeholder="••••••••" value={form.confirmPassword} onChange={set('confirmPassword')} onBlur={handleBlur('confirmPassword')} />
                                <button type="button" className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 cursor-pointer" onClick={() => setShowPassword(!showPassword)}>
                                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                </button>
                            </div>
                            {fieldErrors.confirmPassword && <p className="text-red-500 text-xs font-semibold ml-1 mt-0.5">{fieldErrors.confirmPassword}</p>}
                        </div>
                    </div>

                    {/* Nombre | Apellido */}
                    <div className="grid grid-cols-2 gap-3">
                        <Field label="Nombre" icon={User} required error={fieldErrors.nombre}>
                            <input type="text" className={`${inputClass} ${fieldErrors.nombre ? 'border-red-400 focus:ring-red-300' : ''}`} placeholder="Juan" value={form.nombre} onChange={set('nombre')} onBlur={handleBlur('nombre')} />
                        </Field>
                        <Field label="Apellido" icon={User} required error={fieldErrors.apellido}>
                            <input type="text" className={`${inputClass} ${fieldErrors.apellido ? 'border-red-400 focus:ring-red-300' : ''}`} placeholder="Pérez" value={form.apellido} onChange={set('apellido')} onBlur={handleBlur('apellido')} />
                        </Field>
                    </div>

                    {/* Razón Social */}
                    <Field label="Razón Social" icon={Building}>
                        <input type="text" className={inputClass} placeholder="Opcional" value={form.razonSocial} onChange={set('razonSocial')} onBlur={handleBlur('razonSocial')} />
                    </Field>

                    {/* RUT */}
                    <Field label="RUT" icon={FileText} error={fieldErrors.rut}>
                        <input type="text" className={`${inputClass} ${fieldErrors.rut ? 'border-red-400 focus:ring-red-300' : ''}`} placeholder="Opcional" value={form.rut} onChange={set('rut')} onBlur={handleBlur('rut')} />
                    </Field>

                    {/* Dirección */}
                    <Field label="Dirección" icon={MapPin} required error={fieldErrors.direccion}>
                        <input type="text" className={`${inputClass} ${fieldErrors.direccion ? 'border-red-400 focus:ring-red-300' : ''}`} placeholder="Calle 123, Ciudad" value={form.direccion} onChange={set('direccion')} onBlur={handleBlur('direccion')} />
                    </Field>

                    {/* Teléfono */}
                    <Field label="Teléfono" icon={Phone} required error={fieldErrors.telefono}>
                        <input type="text" className={`${inputClass} ${fieldErrors.telefono ? 'border-red-400 focus:ring-red-300' : ''}`} placeholder="+598 99 123 456" value={form.telefono} onChange={set('telefono')} onBlur={handleBlur('telefono')} />
                    </Field>

                    {/* Documento de identidad */}
                    <Field label="Documento de identidad" icon={FileText}>
                        <input type="text" className={inputClass} placeholder="Opcional" value={form.documento} onChange={set('documento')} onBlur={handleBlur('documento')} />
                    </Field>

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
                        Crear Cuenta
                    </Button>

                    <p className="text-center text-sm text-slate-500">
                        ¿Ya tenés cuenta?{' '}
                        <a href="/login" className="font-bold text-cyan-600 hover:text-cyan-700 transition-colors">
                            Iniciá sesión
                        </a>
                    </p>
                </form>
            </div>
        </div>
    );
};

export default RegisterPage;
