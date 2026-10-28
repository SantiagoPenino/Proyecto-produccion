import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { GlassCard } from '../pautas/GlassCard';
import { CustomButton } from '../pautas/CustomButton';
import { User, UserPen, Mail, Save } from 'lucide-react';
import { apiClient } from '../api/apiClient';
import { ClientFormFields, Field, useNomenclators, inputClass } from '../../components/shared/ClientFormFields';
import { validateClientDocument } from '../../utils/documentValidation';
import { MisDisenadores } from './MisDisenadores';

export const ProfileEdit = () => {
    const { user, updateProfile } = useAuth();
    const navigate = useNavigate();
    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState(null);
    const [fieldErrors, setFieldErrors] = useState({});

    // DB mapping (matches register endpoint):
    //   Clientes.Nombre        = Razón Social (business name)  → user.name
    //   Clientes.NombreFantasia = Nombre + Apellido (personal) → user.company
    const [form, setForm] = useState({
        nombre: '',
        apellido: '',
        telefono: user?.phone || '',
        razonSocial: user?.name || '',       // Clientes.Nombre = razón social
        rut: user?.ruc || '',
        direccion: user?.address || '',
        departamentoId: user?.departamentoId ? String(user.departamentoId) : '',
        localidadId: user?.localidadId ? String(user.localidadId) : '',
        agenciaId: user?.agenciaId ? String(user.agenciaId) : '',
    });

    // Parse nombre+apellido from NombreFantasia (user.company)
    useEffect(() => {
        if (user) {
            const fullName = user.company || '';  // NombreFantasia = "Nombre Apellido"
            const parts = fullName.trim().split(/\s+/);
            const nombre = parts[0] || '';
            const apellido = parts.slice(1).join(' ') || '';

            setForm({
                nombre,
                apellido,
                telefono: user.phone || '',
                razonSocial: user.name || '',    // Clientes.Nombre = razón social
                rut: user.ruc || '',
                documento: user.documento || '',
                direccion: user.address || '',
                departamentoId: user.departamentoId ? String(user.departamentoId) : '',
                localidadId: user.localidadId ? String(user.localidadId) : '',
                agenciaId: user.agenciaId ? String(user.agenciaId) : '',
            });
        }
    }, [user]);

    // Nomenclator data via shared hook (using portal's apiClient)
    const fetchFn = (url) => apiClient.get(url);
    const { departments, localities, agencies } = useNomenclators(form.departamentoId, fetchFn);

    const selectedDept = departments.find(d => String(d.ID) === String(form.departamentoId));
    const isMontevideo = selectedDept?.Nombre?.toLowerCase()?.includes('montevideo');

    // Clear agencia when switching to Montevideo
    useEffect(() => {
        if (isMontevideo) {
            setForm(f => ({ ...f, agenciaId: '' }));
        }
    }, [isMontevideo]);

    const set = (key) => (e) => {
        const val = e.target.value;
        setForm(f => {
            const next = { ...f, [key]: val };
            if (key === 'departamentoId') {
                next.localidadId = '';
                next.agenciaId = '';
            }
            return next;
        });
        if (fieldErrors[key]) {
            setFieldErrors(fe => ({ ...fe, [key]: '' }));
        }
    };

    const validateField = (key, value) => {
        const v = typeof value === 'string' ? value.trim() : String(value || '');
        if (key === 'rut' && v && !validateClientDocument(v)) {
            return 'Documento ingresado (CI o RUT) inválido';
        }
        return '';
    };

    const handleBlur = (key) => () => {
        const err = validateField(key, form[key]);
        setFieldErrors(fe => ({ ...fe, [key]: err }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setMessage(null);

        const err = validateField('rut', form.rut);
        if (err) {
            setFieldErrors({ rut: err });
            setMessage({ type: 'error', text: 'Corregí los errores marcados en el formulario.' });
            setSaving(false);
            return;
        }

        const locName = localities.find(l => String(l.ID) === String(form.localidadId))?.Nombre || '';
        const ageName = agencies.find(a => String(a.ID) === String(form.agenciaId))?.Nombre || '';

        try {
            await updateProfile({
                name: form.razonSocial,                                        // → Clientes.Nombre (razón social)
                company: `${form.nombre} ${form.apellido}`.trim(),             // → Clientes.NombreFantasia (nombre+apellido)
                phone: form.telefono,
                address: form.direccion,
                ruc: form.rut,
                localidad: locName,
                agencia: ageName,
                departamentoId: form.departamentoId ? parseInt(form.departamentoId) : null,
                localidadId: form.localidadId ? parseInt(form.localidadId) : null,
                agenciaId: form.agenciaId ? parseInt(form.agenciaId) : null,
                formaEnvioId: isMontevideo ? 1 : 2,
            });
            setMessage({ type: 'success', text: 'Datos actualizados correctamente' });
        } catch (err) {
            // 400 = un dato que no se puede guardar (por ejemplo, la dirección de más de 80 caracteres): se dice cuál
            setMessage({ type: 'error', text: err?.status === 400 && err.message ? err.message : 'Error al guardar los cambios' });
        } finally {
            setSaving(false);
        }
    };

    if (!user) return null;

    return (
        <div className="max-w-lg mx-auto space-y-3 animate-fade-in">
            <div className="flex items-center gap-3 mb-2">
                <UserPen size={48} strokeWidth={1} className="text-brand-gold" />
                <div>
                    <h2 className="text-lg font-bold text-zinc-300 uppercase">Editar <span className="text-custom-cyan">Datos</span></h2>
                    <p className="text-zinc-500 uppercase text-xs">Tu información personal.</p>
                </div>
            </div>

            <div className="p-4 bg-custom-dark rounded-xl">
                <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                    {/* ID de Cliente (read-only) */}
                    <Field label="ID de Cliente" icon={User}>
                        <input type="text" className={`${inputClass} cursor-not-allowed`} value={user.idCliente || ''} disabled />
                    </Field>

                    {/* Email (read-only) */}
                    <Field label="Email" icon={Mail}>
                        <input type="email" className={`${inputClass} cursor-not-allowed`} value={user.email || ''} disabled />
                    </Field>

                    {/* Shared client fields */}
                    <ClientFormFields
                        form={form}
                        set={set}
                        fieldErrors={fieldErrors}
                        handleBlur={handleBlur}
                        departments={departments}
                        localities={localities}
                        agencies={agencies}
                        isMontevideo={isMontevideo}
                        placeholders={{
                            nombre: (user.company || '').split(/\s+/)[0] || '',
                            apellido: (user.company || '').split(/\s+/).slice(1).join(' ') || '',
                            telefono: user.phone || '',
                            razonSocial: user.name || '',
                            rut: user.ruc || '',
                            documento: user.documento || '',
                            direccion: user.address || '',
                        }}
                    />

                    {message && (
                        <div className={`p-3 rounded-xl text-xs font-bold flex items-center gap-2 ${message.type === 'success' ? 'text-green-400' : 'text-custom-magenta animate-pulse'}`}>
                            {message.text}
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <CustomButton type="button" onClick={() => navigate('/portal/profile')} className="flex-1 !bg-transparent !text-zinc-500 hover:!text-zinc-300 !shadow-none border border-zinc-800 hover:!border-brand-magenta/40 hover:!bg-brand-magenta/5" whileHover={{ scale: 1 }} whileTap={{ scale: 1 }}>
                            Cancelar
                        </CustomButton>
                        <CustomButton type="submit" isLoading={saving} icon={Save} className="flex-1 !bg-transparent !text-zinc-400 hover:!text-zinc-100 !shadow-none border border-zinc-800 hover:!border-brand-cyan/40 hover:!bg-brand-cyan/5" whileHover={{ scale: 1 }} whileTap={{ scale: 1 }}>
                            Guardar
                        </CustomButton>
                    </div>
                </form>
            </div>

            {/* Diseñadores autorizados a crear pedidos en nombre del cliente */}
            <MisDisenadores />
        </div>
    );
};
