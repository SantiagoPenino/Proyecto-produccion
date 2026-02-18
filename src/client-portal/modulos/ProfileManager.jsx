import React, { useState } from 'react';
import { GlassCard } from '../pautas/GlassCard';
import { CustomButton } from '../pautas/CustomButton';
import { FormInput } from '../pautas/FormInput';
import { useAuth } from '../auth/AuthContext';
import { User, Lock, History, Save } from 'lucide-react';
import { StatusBadge } from '../pautas/StatusBadge';

export const ProfileManager = () => {
    const { user, updateProfile } = useAuth();
    const [activeTab, setActiveTab] = useState('info');
    const [formData, setFormData] = useState({
        name: user?.name || '',
        email: user?.email || '',
        company: user?.company || '',
        phone: user?.phone || '',
    });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(null);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        try {
            await updateProfile(formData);
            setMessage({ type: 'success', text: 'Perfil actualizado con éxito' });
        } catch (err) {
            setMessage({ type: 'error', text: 'Error al actualizar perfil' });
        } finally {
            setLoading(false);
            setTimeout(() => setMessage(null), 3000);
        }
    };

    return (
        <div className="max-w-4xl mx-auto space-y-6 animate-fade-in">
            <h2 className="text-2xl font-bold text-neutral-800">Mi Perfil</h2>

            <div className="flex gap-4">
                <CustomButton variant={activeTab === 'info' ? 'primary' : 'ghost'} onClick={() => setActiveTab('info')} icon={User}>
                    Datos Personales
                </CustomButton>
                <CustomButton variant={activeTab === 'security' ? 'primary' : 'ghost'} onClick={() => setActiveTab('security')} icon={Lock}>
                    Seguridad
                </CustomButton>
                <CustomButton variant={activeTab === 'history' ? 'primary' : 'ghost'} onClick={() => setActiveTab('history')} icon={History}>
                    Historial
                </CustomButton>
            </div>

            {activeTab === 'info' && (
                <GlassCard>
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FormInput
                                label="Nombre Completo"
                                value={formData.name}
                                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                            />
                            <FormInput
                                label="Empresa"
                                value={formData.company}
                                onChange={(e) => setFormData({ ...formData, company: e.target.value })}
                            />
                            <FormInput
                                label="Email"
                                type="email"
                                value={formData.email}
                                disabled
                                className="opacity-75 cursor-not-allowed"
                            />
                            <FormInput
                                label="Teléfono"
                                value={formData.phone}
                                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                            />
                        </div>

                        <div className="flex justify-end pt-4">
                            <CustomButton type="submit" isLoading={loading} icon={Save}>
                                Guardar Cambios
                            </CustomButton>
                        </div>

                        {message && (
                            <div className={`p-3 rounded-lg text-sm ${message.type === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                {message.text}
                            </div>
                        )}
                    </form>
                </GlassCard>
            )}

            {activeTab === 'security' && (
                <GlassCard>
                    <h3 className="font-bold text-lg mb-4">Cambiar Contraseña</h3>
                    <form className="space-y-4 max-w-md">
                        <FormInput label="Contraseña Actual" type="password" />
                        <FormInput label="Nueva Contraseña" type="password" />
                        <FormInput label="Confirmar Nueva Contraseña" type="password" />
                        <CustomButton variant="primary">Actualizar Contraseña</CustomButton>
                    </form>
                </GlassCard>
            )}

            {activeTab === 'history' && (
                <GlassCard>
                    <h3 className="font-bold text-lg mb-4">Actividad Reciente</h3>
                    <div className="space-y-3">
                        {[1, 2, 3].map((i) => (
                            <div key={i} className="flex items-center justify-between p-3 hover:bg-zinc-50 rounded-lg border border-zinc-100">
                                <div>
                                    <p className="font-medium text-sm">Inicio de sesión exitoso</p>
                                    <p className="text-xs text-zinc-500">Hace {i} días desde Chrome/Windows</p>
                                </div>
                                <StatusBadge status="Completado" />
                            </div>
                        ))}
                    </div>
                </GlassCard>
            )}
        </div>
    );
};
