import React, { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { GlassCard } from '../pautas/GlassCard';
import { CustomButton } from '../pautas/CustomButton';
import { FormInput } from '../pautas/FormInput';
import { useNavigate, useLocation } from 'react-router-dom';
import { Lock, Mail, Users, ArrowRight } from 'lucide-react';
import { apiClient } from '../api/apiClient';

// Subcomponent for Password Change
const ChangePasswordForm = ({ userId, onCancel, onSuccess }) => {
    const [pass, setPass] = useState('');
    const [confirm, setConfirm] = useState('');
    const [loading, setLoading] = useState(false);
    const [msg, setMsg] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        // Removed complexity check
        if (!pass) return setMsg("Ingresa una contraseña");
        if (pass !== confirm) return setMsg("Las contraseñas no coinciden");

        setLoading(true);
        try {
            await apiClient.post('/web-auth/update-password', { newPassword: pass });
            onSuccess();
        } catch (e) {
            setMsg(e.message || "Error al actualizar");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="space-y-4">
            <h3 className="text-xl font-bold text-center mb-4">Actualizar Contraseña</h3>
            <p className="text-sm text-gray-500 text-center mb-4">
                Es necesario que configures una nueva contraseña para tu cuenta.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
                <input
                    type="password" placeholder="Nueva Contraseña"
                    className="w-full p-3 border rounded"
                    value={pass} onChange={e => setPass(e.target.value)} required
                />
                <input
                    type="password" placeholder="Repetir Nueva Contraseña"
                    className="w-full p-3 border rounded"
                    value={confirm} onChange={e => setConfirm(e.target.value)} required
                />
                {msg && <div className="text-red-500 text-sm text-center">{msg}</div>}
                <button
                    type="submit" disabled={loading}
                    className="w-full bg-black text-white py-3 rounded font-bold"
                >
                    {loading ? 'Actualizando...' : 'Guardar Nueva Contraseña'}
                </button>
            </form>
        </div>
    );
};

export const LoginPage = () => {
    const { login, register } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const from = location.state?.from?.pathname || '/portal';

    const [isLogin, setIsLogin] = useState(true);
    const [requireReset, setRequireReset] = useState(false);
    const [formData, setFormData] = useState({
        idcliente: '', // Added ID field
        email: '',
        password: '',
        confirmPassword: '',
        name: '',
        ruc: '',
        company: '',
        fantasyName: '',
        address: '',
        phone: '',
        // Nomenclator IDs
        departamentoId: '',
        localidadId: '',
        agenciaId: '',
        formaEnvioId: '',
    });

    const [deps, setDeps] = useState([]);
    const [locs, setLocs] = useState([]);
    const [agencies, setAgencies] = useState([]);
    const [methods, setMethods] = useState([]);

    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Initial Load of Nomenclators
    React.useEffect(() => {
        if (!isLogin) {
            apiClient.get('/nomenclators/departments').then(r => setDeps(r.data)).catch(console.error);
            apiClient.get('/nomenclators/agencies').then(r => setAgencies(r.data)).catch(console.error);
            apiClient.get('/nomenclators/shipping-methods').then(r => setMethods(r.data)).catch(console.error);
        }
    }, [isLogin]);

    // Load Localities when Department changes
    React.useEffect(() => {
        if (formData.departamentoId) {
            apiClient.get(`/nomenclators/localities/${formData.departamentoId}`)
                .then(r => setLocs(r.data))
                .catch(console.error);
        } else {
            setLocs([]);
        }
    }, [formData.departamentoId]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (isLogin) {
                // Login now uses 'idcliente' (mapped to 'identifier' in AuthContext)
                const result = await login(formData.idcliente, formData.password);
                if (result.requireReset) {
                    setRequireReset(true);
                    return;
                }
            } else {
                if (formData.password !== formData.confirmPassword) {
                    throw new Error("Las contraseñas no coinciden");
                }

                // Look up names for fallback
                const depName = deps.find(d => d.ID == formData.departamentoId)?.Nombre || '';
                const locName = locs.find(l => l.ID == formData.localidadId)?.Nombre || '';
                const agencyName = agencies.find(a => a.ID == formData.agenciaId)?.Nombre || '';

                await register({
                    idcliente: formData.idcliente, // Send ID
                    name: formData.name,
                    email: formData.email,
                    password: formData.password,
                    company: formData.company,
                    phone: formData.phone,
                    address: formData.address,
                    ruc: formData.ruc,
                    fantasyName: formData.fantasyName,

                    // Nomenclator Data
                    departamentoId: formData.departamentoId,
                    localidadId: formData.localidadId,
                    agenciaId: formData.agenciaId,
                    formaEnvioId: formData.formaEnvioId,

                    // Text Fallbacks
                    localidad: locName,
                    agencia: agencyName
                });
            }
            navigate(from, { replace: true });
        } catch (err) {
            setError(err.message || 'Error en autenticación');
        } finally {
            setLoading(false);
        }
    };

    if (requireReset) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 font-sans">
                <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-lg border border-gray-100">
                    <ChangePasswordForm
                        onSuccess={() => navigate(from, { replace: true })}
                        onCancel={() => setRequireReset(false)}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4 font-sans">
            <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-lg border border-gray-100">

                <div className="flex justify-center mb-6">
                    <img src="/assets/images/logo.png" alt="User Logo" className="h-16 object-contain" onError={(e) => e.target.style.display = 'none'} />
                </div>

                <h2 className="text-2xl font-semibold text-center text-gray-800 mb-6">
                    {isLogin ? 'Iniciar Sesión' : 'Registrarme'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {isLogin && (
                        <>
                            <div>
                                <input
                                    type="text"
                                    name="idcliente" // Changed to idcliente
                                    placeholder="ID de Cliente"
                                    className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black transition-colors"
                                    value={formData.idcliente}
                                    onChange={handleChange}
                                    required // Mandatory
                                />
                            </div>
                            <div>
                                <input
                                    type="password"
                                    name="password"
                                    placeholder="Contraseña"
                                    className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black transition-colors"
                                    value={formData.password}
                                    onChange={handleChange}
                                />
                            </div>
                        </>
                    )}

                    {!isLogin && (
                        <div className="space-y-4">
                            {/* ID Cliente First field in Register */}
                            <input
                                type="text"
                                name="idcliente"
                                placeholder="ID de Cliente"
                                className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black"
                                value={formData.idcliente}
                                onChange={handleChange}
                                required
                            />

                            <input type="email" name="email" placeholder="Email" className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black" value={formData.email} onChange={handleChange} required />
                            <input type="text" name="name" placeholder="Nombre" className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black" value={formData.name} onChange={handleChange} required />
                            <input type="text" name="ruc" placeholder="RUT" className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black" value={formData.ruc} onChange={handleChange} />
                            <input type="text" name="company" placeholder="Razón Social" className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black" value={formData.company} onChange={handleChange} />
                            <input type="text" name="fantasyName" placeholder="Nombre Fantasía" className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black" value={formData.fantasyName} onChange={handleChange} />
                            <input type="text" name="address" placeholder="Domicilio" className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black" value={formData.address} onChange={handleChange} />

                            {/* Nomenclators Selection */}
                            <select name="departamentoId" value={formData.departamentoId} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black bg-white appearance-none">
                                <option value="">Seleccione Departamento</option>
                                {deps.map(d => <option key={d.ID} value={d.ID}>{d.Nombre}</option>)}
                            </select>

                            <select name="localidadId" value={formData.localidadId} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black bg-white appearance-none" disabled={!formData.departamentoId}>
                                <option value="">Seleccione Localidad</option>
                                {locs.map(l => <option key={l.ID} value={l.ID}>{l.Nombre}</option>)}
                            </select>

                            <select name="formaEnvioId" value={formData.formaEnvioId} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black bg-white appearance-none">
                                <option value="">Forma de Envío Preferida</option>
                                {methods.map(m => <option key={m.ID} value={m.ID}>{m.Nombre}</option>)}
                            </select>

                            {/* Show Agencies only if "Encomienda" is selected */}
                            {methods.find(m => m.ID == formData.formaEnvioId)?.Nombre.toLowerCase().includes('encomienda') && (
                                <select name="agenciaId" value={formData.agenciaId} onChange={handleChange} className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black bg-white appearance-none">
                                    <option value="">Seleccione Agencia</option>
                                    {agencies.map(a => <option key={a.ID} value={a.ID}>{a.Nombre}</option>)}
                                </select>
                            )}

                            <input type="tel" name="phone" placeholder="Celular" className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black" value={formData.phone} onChange={handleChange} />

                            <input type="password" name="password" placeholder="Contraseña" className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black" value={formData.password} onChange={handleChange} required />
                            <input type="password" name="confirmPassword" placeholder="Repetir contraseña" className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:border-black" value={formData.confirmPassword} onChange={handleChange} required />
                        </div>
                    )}

                    {error && (
                        <div className="p-3 bg-red-100 text-red-700 rounded text-sm text-center">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-black text-white py-3 rounded font-bold hover:bg-gray-800 transition-colors uppercase mt-6"
                    >
                        {loading ? 'Procesando...' : (isLogin ? 'Ingresar' : 'Registrarme')}
                    </button>

                    {isLogin && (
                        <div className="text-center mt-2">
                            <a href="#" className="text-sm text-gray-500 hover:underline">
                                ¿Olvidaste tu contraseña?
                            </a>
                        </div>
                    )}
                </form>

                <div className="mt-8 text-center">
                    <button
                        onClick={() => { setIsLogin(!isLogin); setError(''); }}
                        className="text-sm font-semibold text-gray-800 hover:text-black"
                    >
                        {isLogin ? (
                            <>¿No tienes cuenta? <span className="uppercase border-b border-black">Registrarse</span></>
                        ) : (
                            <>Ya tengo una cuenta. <span className="uppercase font-bold">Iniciar Sesión</span></>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
