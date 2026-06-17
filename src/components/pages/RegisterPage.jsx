import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '../ui/Button.jsx';
import { User, Lock, Mail, Eye, EyeOff, UserCheck, ChevronDown, AlertCircle, CheckCircle2 } from 'lucide-react';
import Swal from 'sweetalert2';
import { API_URL } from '../../services/apiClient';
import { ClientFormFields, Field, useNomenclators, inputClass, iconClass } from '../shared/ClientFormFields';
import ParticlesCanvas from '../ui/ParticlesCanvas';
import LandingNavbar from '../shared/LandingNavbar.jsx';
import { validateClientDocument } from '../../utils/documentValidation';

const RegisterPage = () => {
    const location = useLocation();
    const [form, setForm] = useState({
        idCliente: '', email: location.state?.prefilledEmail || '', password: '', confirmPassword: '',
        nombre: '', apellido: '', telefono: '',
        razonSocial: '', rut: '',
        direccion: '', departamentoId: '', localidadId: '', agenciaId: ''
    });
    const [fieldErrors, setFieldErrors] = useState({});
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [hadVendedor, setHadVendedor] = useState(false);
    const [vendedores, setVendedores] = useState([]);
    const [selectedVendedorId, setSelectedVendedorId] = useState('');
    const [selectedVendedorName, setSelectedVendedorName] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [newsletter, setNewsletter] = useState(true);
    const navigate = useNavigate();

    // Nomenclator data via shared hook
    const fetchFn = async (url) => {
        const r = await fetch(`${API_URL}${url}`);
        return r.json();
    };
    const { departments, localities, agencies } = useNomenclators(form.departamentoId, fetchFn);

    // Determine if selected department is Montevideo
    const selectedDept = departments.find(d => String(d.ID) === String(form.departamentoId));
    const isMontevideo = selectedDept?.Nombre?.toLowerCase()?.includes('montevideo');

    // Clear agencia when switching to Montevideo
    useEffect(() => {
        if (isMontevideo) {
            setForm(f => ({ ...f, agenciaId: '' }));
        }
    }, [isMontevideo]);

    // Fetch vendedores when department changes
    useEffect(() => {
        if (form.departamentoId) {
            fetch(`${API_URL}/nomenclators/vendedores-by-department/${form.departamentoId}`)
                .then(r => r.json())
                .then(data => {
                    if (data.success) setVendedores(data.data);
                    else setVendedores([]);
                })
                .catch(() => setVendedores([]));
        } else {
            setVendedores([]);
        }
        setSelectedVendedorId('');
        setSelectedVendedorName('');
        setHadVendedor(false);
    }, [form.departamentoId]);

    const set = (key) => (e) => {
        const val = key === 'idCliente' ? e.target.value.replace(/\s/g, '') : e.target.value;
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
        const required = ['idCliente', 'email', 'password', 'confirmPassword', 'nombre', 'apellido', 'telefono', 'rut', 'direccion', 'departamentoId', 'localidadId'];

        if (key === 'agenciaId' && !isMontevideo && !v) {
            return 'Seleccioná una agencia';
        }

        if (required.includes(key) && !v) {
            return 'Este campo es obligatorio';
        }

        switch (key) {
            case 'idCliente':
                if (v && /\s/.test(v))
                    return 'No puede contener espacios';
                if (v && !/^[a-zA-Z0-9]+$/.test(v))
                    return 'No puede contener símbolos, solo letras y números';
                break;
            case 'email':
                if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
                    return 'Email inválido';
                break;
            case 'password':
                if (v && v.length < 4)
                    return 'Mínimo 4 caracteres';
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
                if (v && !validateClientDocument(v))
                    return 'Documento ingresado (CI o RUT) inválido';
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

        const locName = localities.find(l => String(l.ID) === String(form.localidadId))?.Nombre || '';
        const ageName = agencies.find(a => String(a.ID) === String(form.agenciaId))?.Nombre || '';

        setIsLoading(true);
        try {
            const response = await fetch(`${API_URL}/web-auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    idcliente: form.idCliente,
                    name: `${form.nombre} ${form.apellido}`.trim(),
                    email: form.email,
                    password: form.password,
                    company: form.razonSocial,
                    phone: form.telefono,
                    address: form.direccion,
                    ruc: form.rut,
                    fantasyName: form.razonSocial.trim() || form.idCliente,
                    departamentoId: form.departamentoId ? parseInt(form.departamentoId) : null,
                    localidadId: form.localidadId ? parseInt(form.localidadId) : null,
                    agenciaId: form.agenciaId ? parseInt(form.agenciaId) : null,
                    localidad: locName,
                    agencia: ageName,
                    formaEnvioId: isMontevideo ? 1 : 2,
                    manualVendedorId: hadVendedor && selectedVendedorId ? selectedVendedorId : null,
                    newsletter: newsletter ? 1 : 0
                })
            });

            const data = await response.json();

            if (response.ok && data.success) {
                setSuccess('¡Registro exitoso!');

                let seconds = 10;
                const isMobile = window.innerWidth < 768;
                document.body.style.overflow = 'hidden'; // Ocultar scroll subyacente
                setIsModalOpen(true);
                const swalResult = Swal.fire({
                    title: '¡Ya casi terminás!',
                    html: `
                        <p style="color:#a1a1aa;font-size:14px;margin-bottom:16px;line-height:1.6">
                            Te enviamos un correo electrónico con un <strong style="color:#f4f4f5">link de activación</strong>.<br/>
                            Hacé clic en ese link para activar tu cuenta y poder ingresar.
                        </p>
                        <p id="swal-countdown" style="color:#71717a;font-size:12px">
                            Serás redirigido al inicio de sesión en <strong style="color:#00AEEF" id="swal-sec">10</strong> segundos, o podés hacer clic aquí abajo.
                        </p>
                    `,
                    confirmButtonText: 'Ir a iniciar sesión →',
                    showConfirmButton: true,
                    allowOutsideClick: false,
                    allowEscapeKey: false,
                    background: isMobile
                        ? '#19181B'
                        : 'linear-gradient(#19181B, #19181B) padding-box, linear-gradient(to bottom right, #00AEEF, #EC008C, #FFF200) border-box',
                    color: '#f4f4f5',
                    width: isMobile ? '100vw' : undefined,
                    padding: isMobile ? '2rem 1.5rem' : undefined,
                    customClass: { popup: isMobile ? 'swal-mobile-full' : '' },
                    didOpen: () => {
                        const popup = Swal.getPopup();
                        if (isMobile) {
                            popup.style.background = '#19181B';
                            popup.style.borderRadius = '0';
                            popup.style.margin = '0';
                            popup.style.position = 'fixed';
                            popup.style.inset = '0';
                            popup.style.width = '100vw';
                            popup.style.maxWidth = '100vw';
                            popup.style.height = '100dvh';
                            popup.style.display = 'flex';
                            popup.style.flexDirection = 'column';
                            popup.style.justifyContent = 'center';
                        } else {
                            popup.style.border = '2px solid transparent';
                            popup.style.borderRadius = '24px';
                            popup.style.boxShadow = '0 25px 50px -12px rgba(0,0,0,0.7)';
                        }

                        const title = popup.querySelector('.swal2-title');
                        if (title) {
                            title.style.fontSize = isMobile ? '22px' : '20px';
                            title.style.color = '#f4f4f5';
                        }

                        const confirmBtn = Swal.getConfirmButton();
                        if (confirmBtn) {
                            confirmBtn.style.cssText = `background:transparent;color:#f4f4f5;border:1px solid rgba(0,174,239,0.4);border-radius:12px;padding:12px 24px;font-weight:700;font-size:14px;cursor:pointer;transition:all 0.2s;width:100%;margin-top:8px`;
                            confirmBtn.onmouseenter = () => { confirmBtn.style.background = 'rgba(0,174,239,0.08)'; confirmBtn.style.borderColor = '#00AEEF'; };
                            confirmBtn.onmouseleave = () => { confirmBtn.style.background = 'transparent'; confirmBtn.style.borderColor = 'rgba(0,174,239,0.4)'; };
                        }

                        const interval = setInterval(() => {
                            seconds--;
                            const secEl = document.getElementById('swal-sec');
                            if (secEl) secEl.textContent = seconds;
                            if (seconds <= 0) {
                                clearInterval(interval);
                                Swal.close();
                                navigate('/login');
                            }
                        }, 1000);

                        Swal.getConfirmButton()?.addEventListener('click', () => clearInterval(interval));
                    }
                });

                swalResult.then((result) => {
                    document.body.style.overflow = 'auto'; // Restaurar scroll por si acaso (aunque navigate lo reescriba)
                    setIsModalOpen(false);
                    if (result.isConfirmed) {
                        navigate('/login');
                    }
                });
            } else {
                setError(data.message || data.error || 'Error al registrar la cuenta.');
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
        <div className="flex flex-col min-h-[100dvh] bg-[#19181B] relative overflow-x-hidden font-sans pt-[85px]">
            <LandingNavbar />

            {/* Particles canvas (Reactivado a pedido del usuario) */}
            <ParticlesCanvas />

            <div className="flex-1 flex flex-col p-4 md:p-6 pb-12 z-10 w-full relative">
                {/* Estilos dinámicos para pausar hover/keyframes */}
                <style>{`
                    .login-gradient-border.modal-open-freeze {
                        animation-play-state: paused !important;
                    }
                `}</style>
                {/* Card wrapper with static CMY border instead of animated gradient to save GPU */}
                <div className={`relative w-full md:max-w-4xl z-10 mx-auto my-auto rounded-3xl p-[2px] login-gradient-border shadow-2xl shadow-black/50 ${isModalOpen ? 'modal-open-freeze' : ''}`}>
                    {/* Contenedor interior oscuro para simular el borde */}
                    <div className="relative bg-custom-dark p-6 md:px-8 md:py-8 rounded-[22px] w-full overflow-hidden">
                        <div className="mb-6 text-center">
                            <h2 className="text-2xl font-black text-white tracking-tight">Crear cuenta</h2>
                            <p className="text-sm font-medium text-zinc-400 mt-1">Industrializá tu producción hoy mismo.</p>
                        </div>

                        <form onSubmit={handleSubmit} className="flex flex-col gap-4 md:gap-4">
                            {/* Se usa el grid directo para que distribuya los campos en zig-zag */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">

                                {/* ID de Cliente */}
                                <Field label="ID de Cliente" icon={User} required error={fieldErrors.idCliente}>
                                    <input type="text" className={`${inputClass} ${fieldErrors.idCliente ? 'border-custom-magenta focus:ring-brand-magenta focus:border-custom-magenta' : ''}`} placeholder="Ej: Tu ID" value={form.idCliente} onChange={set('idCliente')} onBlur={handleBlur('idCliente')} />
                                </Field>

                                {/* Email */}
                                <Field label="Email" icon={Mail} required error={fieldErrors.email}>
                                    <input type="email" className={`${inputClass} ${fieldErrors.email ? 'border-custom-magenta focus:ring-brand-magenta focus:border-custom-magenta' : ''}`} placeholder="tu@email.com" value={form.email} onChange={set('email')} onBlur={handleBlur('email')} />
                                </Field>

                                {/* Contraseña | Confirmar Contraseña */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider ml-1">Contraseña <span className="text-custom-magenta">*</span></label>
                                        <div className="relative group">
                                            <div className={iconClass}><Lock size={18} /></div>
                                            <input type={showPassword ? "text" : "password"} className={`${inputClass} ${fieldErrors.password ? 'border-custom-magenta focus:ring-custom-magenta focus:border-custom-magenta' : ''}`} placeholder="********" value={form.password} onChange={set('password')} onBlur={handleBlur('password')} />
                                        </div>
                                        {fieldErrors.password && <p className="text-custom-magenta text-xs font-semibold ml-1 mt-0.5">{fieldErrors.password}</p>}
                                    </div>
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-zinc-100 uppercase tracking-wider ml-1">Confirmar <span className="text-custom-magenta">*</span></label>
                                        <div className="relative group">
                                            <div className={iconClass}><Lock size={18} /></div>
                                            <input type={showPassword ? "text" : "password"} className={`${inputClass} ${fieldErrors.confirmPassword ? 'border-custom-magenta focus:ring-custom-magenta focus:border-custom-magenta' : ''}`} placeholder="********" value={form.confirmPassword} onChange={set('confirmPassword')} onBlur={handleBlur('confirmPassword')} />
                                            <button type="button" className="absolute inset-y-0 right-0 pr-3 flex items-center text-[#00AEEF] hover:text-[#009bda] cursor-pointer" onClick={() => setShowPassword(!showPassword)}>
                                                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                            </button>
                                        </div>
                                        {fieldErrors.confirmPassword && <p className="text-custom-magenta text-xs font-semibold ml-1 mt-0.5">{fieldErrors.confirmPassword}</p>}
                                    </div>
                                </div>

                                {/* Shared client fields caen solos en el flow del Grid */}
                                <ClientFormFields
                                    form={form}
                                    set={set}
                                    fieldErrors={fieldErrors}
                                    handleBlur={handleBlur}
                                    departments={departments}
                                    localities={localities}
                                    agencies={agencies}
                                    isMontevideo={isMontevideo}
                                />
                            </div>

                            {/* Vendedor checkbox + SweetAlert picker */}
                            <div className={`bg-[#111] border border-[#3f3f46] rounded-[10px] p-4 space-y-3 ${!form.departamentoId || !form.localidadId ? 'opacity-50' : ''}`}>
                                <label className={`flex items-center gap-3 select-none ${!form.departamentoId || !form.localidadId ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
                                    onClick={async () => {
                                        if (!form.departamentoId || !form.localidadId) return;
                                        if (!hadVendedor) {
                                            if (vendedores.length === 0) {
                                                Swal.fire({ title: 'Sin asesores', text: 'No hay asesores disponibles para este departamento.', icon: 'info', background: '#212121', color: '#f4f4f5' });
                                                return;
                                            }
                                            // Build HTML grid with photos
                                            const isMobile = window.innerWidth < 768;
                                            const grid = vendedores.map((v, idx) => {
                                                const imgUrl = `/assets/images/asesores/${v.Cedula}.webp`;
                                                const firstName = v.Nombre.split(' ')[0];
                                                if (isMobile) {
                                                    const staggerStyle = idx % 2 !== 0 ? 'transform: translateY(96px);' : '';
                                                    return `<div class="swal-asesor" data-id="${v.ID}" data-nombre="${v.Nombre}" style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:8px 4px;border-radius:16px;cursor:pointer;transition:all 0.2s;background:transparent;${staggerStyle}">
                                                        <img src="${imgUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" style="width:120px;height:120px;border-radius:50%;object-fit:cover;box-shadow:0 8px 20px -8px rgba(0,0,0,0.8)" />
                                                        <div style="width:120px;height:120px;border-radius:50%;background:#006E97;display:none;align-items:center;justify-content:center;color:#f4f4f5;font-weight:bold;font-size:40px;box-shadow:0 8px 20px -8px rgba(0,0,0,0.8)">${firstName.charAt(0)}</div>
                                                        <span style="font-weight:700;color:#f4f4f5;font-size:16px;text-transform:uppercase;letter-spacing:0.05em;text-align:center">${firstName}</span>
                                                    </div>`;
                                                } else {
                                                    return `<div class="swal-asesor" data-id="${v.ID}" data-nombre="${v.Nombre}" style="display:flex;flex-direction:column;align-items:center;gap:16px;padding:20px 16px;border-radius:16px;cursor:pointer;transition:all 0.2s;background:transparent;flex:1;min-width:140px;max-width:180px;">
                                                        <img src="${imgUrl}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" style="width:96px;height:96px;border-radius:50%;object-fit:cover" /><div style="width:96px;height:96px;border-radius:50%;background:#006E97;display:none;align-items:center;justify-content:center;color:#f4f4f5;font-weight:bold;font-size:30px">${firstName.charAt(0)}</div>
                                                        <span style="font-weight:600;color:#f4f4f5;font-size:13px;text-align:center;text-transform:uppercase;letter-spacing:0.05em">${firstName}</span>
                                                    </div>`;
                                                }
                                            });
                                            const separator = '';
                                            const gridHtml = grid.join(separator);

                                            document.body.style.overflow = 'hidden'; // Ocultar scroll subyacente durante el modal
                                            setIsModalOpen(true);
                                            const selected = await new Promise((resolve) => {
                                                Swal.fire({
                                                    title: 'SELECCIONÁ TU ASESOR',
                                                    html: `<div style="${isMobile ? 'display:grid;grid-template-columns:auto auto;justify-content:center;justify-items:center;row-gap:20px;column-gap:24px;padding-bottom:96px;transform:translateY(-50px);' : 'display:flex;flex-wrap:wrap;justify-content:center;gap:12px;'}padding:8px">${gridHtml}</div>`,
                                                    showConfirmButton: false,
                                                    showCancelButton: false,
                                                    showCloseButton: isMobile,
                                                    background: 'transparent',
                                                    color: '#f4f4f5',
                                                    width: isMobile ? '100vw' : 'auto',
                                                    padding: isMobile ? '1rem 0' : undefined,
                                                    customClass: { popup: isMobile ? 'swal-mobile-full' : '' },
                                                    didOpen: () => {
                                                        const popup = Swal.getPopup();
                                                        if (isMobile) {
                                                            popup.style.background = '#19181B';
                                                            popup.style.borderRadius = '0';
                                                            popup.style.margin = '0';
                                                            popup.style.position = 'fixed';
                                                            popup.style.top = '0';
                                                            popup.style.left = '0';
                                                            popup.style.width = '100vw';
                                                            popup.style.height = '100dvh';
                                                            popup.style.display = 'flex';
                                                            popup.style.flexDirection = 'column';
                                                            const htmlContainer = popup.querySelector('.swal2-html-container');
                                                            if (htmlContainer) {
                                                                htmlContainer.style.flex = '1';
                                                                htmlContainer.style.display = 'flex';
                                                                htmlContainer.style.alignItems = 'center';
                                                                htmlContainer.style.justifyContent = 'center';
                                                            }
                                                            const closeBtn = popup.querySelector('.swal2-close');
                                                            if (closeBtn) {
                                                                closeBtn.style.position = 'absolute';
                                                                closeBtn.style.top = '10px';
                                                                closeBtn.style.right = '20px';
                                                                closeBtn.style.top = 'auto';
                                                                closeBtn.style.fontSize = '36px';
                                                                closeBtn.style.color = '#ec008c';
                                                            }
                                                            const title = popup.querySelector('.swal2-title');
                                                            if (title) {
                                                                title.style.fontSize = '24px';
                                                            }
                                                        } else {
                                                            popup.style.background = 'linear-gradient(#19181B, #19181B) padding-box, linear-gradient(to bottom right, #00AEEF, #EC008C, #FFF200) border-box';
                                                            popup.style.border = '2px solid transparent';
                                                            popup.style.borderRadius = '24px';
                                                            popup.style.boxShadow = '0 25px 50px -12px rgba(0, 0, 0, 0.7)';
                                                        }
                                                        const items = Swal.getPopup().querySelectorAll('.swal-asesor');
                                                        items.forEach(el => {
                                                            el.addEventListener('mouseenter', () => { el.style.background = '#2a2a2a'; });
                                                            el.addEventListener('mouseleave', () => { el.style.background = 'transparent'; });
                                                            el.addEventListener('click', () => {
                                                                document.body.style.overflow = 'auto';
                                                                resolve({ id: el.dataset.id, nombre: el.dataset.nombre });
                                                                Swal.close();
                                                            });
                                                        });
                                                    },
                                                }).then((result) => {
                                                    document.body.style.overflow = 'auto';
                                                    setIsModalOpen(false);
                                                    if (result.dismiss) resolve(null);
                                                });
                                            });

                                            if (selected) {
                                                setHadVendedor(true);
                                                setSelectedVendedorId(selected.id);
                                                setSelectedVendedorName(selected.nombre);
                                            }
                                        } else {
                                            setHadVendedor(false);
                                            setSelectedVendedorId('');
                                            setSelectedVendedorName('');
                                        }
                                    }}
                                >
                                    <div className="flex items-center justify-center text-[#00AEEF]">
                                        {hadVendedor ? (
                                            <CheckCircle2 size={22} className="text-[#00AEEF] drop-shadow-[0_0_8px_rgba(0,174,239,0.5)]" />
                                        ) : (
                                            <div className="w-[22px] h-[22px] rounded-full border-2 border-[#3f3f46] group-hover:border-[#00AEEF]/50 transition-colors" />
                                        )}
                                    </div>
                                    <span className="text-sm font-semibold text-zinc-300">¿Fuiste atendido por algún asesor?</span>
                                </label>

                                {hadVendedor && selectedVendedorName && (
                                    <div className="flex items-center gap-3 mt-2 p-3 bg-[#19181B] border border-[#00AEEF]/30 rounded-xl">
                                        <UserCheck size={18} className="text-[#00AEEF]" />
                                        <span className="text-sm font-semibold text-zinc-100">{selectedVendedorName}</span>
                                        <button type="button" className="ml-auto text-xs text-zinc-500 hover:text-custom-magenta" onClick={() => { setHadVendedor(false); setSelectedVendedorId(''); setSelectedVendedorName(''); }}>✕</button>
                                    </div>
                                )}
                            </div>

                            {error && (
                                <div className="text-custom-magenta p-3 rounded-xl text-xs font-bold flex items-center gap-2 justify-center animate-pulse">
                                    <AlertCircle size={14} />
                                    {error}
                                </div>
                            )}

                            {success && (
                                <div className="bg-green-50 text-green-600 p-3 rounded-xl text-xs font-bold flex items-center gap-2 border border-green-100">
                                    <CheckCircle2 size={14} />
                                    {success}
                                </div>
                            )}

                            {/* Newsletter checkbox */}
                            <div>
                                <label
                                    className="flex items-center gap-3 cursor-pointer select-none"
                                    onClick={() => setNewsletter(v => !v)}
                                >
                                    <div className="flex items-center justify-center text-[#00AEEF]">
                                        {newsletter ? (
                                            <CheckCircle2 size={20} className="text-[#00AEEF] drop-shadow-[0_0_8px_rgba(0,174,239,0.5)]" />
                                        ) : (
                                            <div className="w-[20px] h-[20px] rounded-full border-2 border-[#3f3f46] group-hover:border-[#00AEEF]/50 transition-colors" />
                                        )}
                                    </div>
                                    <span className="text-xs font-semibold text-zinc-400 group-hover:text-zinc-300 transition-colors">Recibir ofertas y novedades por correo</span>
                                </label>
                            </div>

                            <Button
                                type="submit"
                                className="w-full py-[14px] px-4 rounded-xl font-bold active:scale-[0.98] transition-all flex justify-center items-center gap-2 mt-2 text-[15px] !shadow-none border cursor-pointer"
                                style={{
                                    background: 'linear-gradient(90deg, rgba(0,174,239,0.1) 0%, rgba(0,174,239,0.2) 100%)',
                                    borderColor: 'rgba(0,174,239,0.4)',
                                    color: '#00AEEF',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(90deg, rgba(0,174,239,0.15) 0%, rgba(0,174,239,0.3) 100%)';
                                    e.currentTarget.style.borderColor = 'rgba(0,174,239,0.7)';
                                    e.currentTarget.style.boxShadow = '0 0 15px rgba(0,174,239,0.2)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(90deg, rgba(0,174,239,0.1) 0%, rgba(0,174,239,0.2) 100%)';
                                    e.currentTarget.style.borderColor = 'rgba(0,174,239,0.4)';
                                    e.currentTarget.style.boxShadow = 'none';
                                }}
                                isLoading={isLoading}
                            >
                                Crear Cuenta
                            </Button>

                            <p className="text-center text-sm text-zinc-500 mt-2">
                                ¿Ya tenés cuenta?{' '}
                                <a 
                                  href="/login" 
                                  className="font-bold border-b border-transparent hover:border-custom-cyan transition-all"
                                  style={{ color: '#00AEEF' }}
                                >
                                    Iniciá sesión
                                </a>
                            </p>
                        </form>
                    </div>
                </div>
            </div>

            {/* 4-color bar - mobile only, fixed to bottom of screen */}
            <div className="fixed bottom-0 left-0 w-screen flex h-2 md:hidden z-50">
                <div className="flex-1 bg-custom-cyan" />
                <div className="flex-1 bg-custom-magenta" />
                <div className="flex-1 bg-custom-yellow" />
                <div className="flex-1 bg-white" />
            </div>
        </div>
    );
};

export default RegisterPage;
