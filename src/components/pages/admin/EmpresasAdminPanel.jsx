import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
    Building2, Plus, Save, Star, Power, Loader2, RefreshCw,
} from 'lucide-react';
import {
    listarEmpresas,
    crearEmpresa,
    actualizarEmpresa,
    setEmpresaPorDefecto,
    toggleActivaEmpresa,
} from '../../../services/modules/empresasService';
import api from '../../../services/apiClient';

// ─── Estado inicial del formulario ───────────────────────
const EMPTY_FORM = {
    EmpIdEmpresa: null,
    // Identidad
    EmpRuc: '',
    EmpRazonSocial: '',
    EmpNombreFantasia: '',
    EmpSlogan: '',
    EmpDireccion: '',
    EmpCiudad: '',
    EmpDepartamento: '',
    EmpPais: 'Uruguay',
    EmpTelefono: '',
    EmpEmail: '',
    EmpWeb: '',
    EmpLogoUrl: '',
    EmpColorPrimario: '#00B4D8',
    // Facturación electrónica (SISNET)
    EmpSisnetWsdlUrl: '',
    EmpSisnetUser: '',
    EmpSisnetPass: '',
    EmpSisnetCaja: '',
    EmpSisnetTasaBasica: 'tasa_basica',
    EmpSisnetTasaMinima: 'tasa_Minima',
    // Estado
    EmpActiva: true,
    EmpPorDefecto: false,
};

// Rellena el formulario a partir de una empresa de la lista (nunca la contraseña).
const empresaToForm = (emp) => ({
    ...EMPTY_FORM,
    EmpIdEmpresa: emp.EmpIdEmpresa ?? null,
    EmpRuc: emp.EmpRuc ?? '',
    EmpRazonSocial: emp.EmpRazonSocial ?? '',
    EmpNombreFantasia: emp.EmpNombreFantasia ?? '',
    EmpSlogan: emp.EmpSlogan ?? '',
    EmpDireccion: emp.EmpDireccion ?? '',
    EmpCiudad: emp.EmpCiudad ?? '',
    EmpDepartamento: emp.EmpDepartamento ?? '',
    EmpPais: emp.EmpPais ?? 'Uruguay',
    EmpTelefono: emp.EmpTelefono ?? '',
    EmpEmail: emp.EmpEmail ?? '',
    EmpWeb: emp.EmpWeb ?? '',
    EmpLogoUrl: emp.EmpLogoUrl ?? '',
    EmpColorPrimario: emp.EmpColorPrimario ?? '#00B4D8',
    EmpSisnetWsdlUrl: emp.EmpSisnetWsdlUrl ?? '',
    EmpSisnetUser: emp.EmpSisnetUser ?? '',
    EmpSisnetPass: '', // la API nunca devuelve la contraseña
    EmpSisnetCaja: emp.EmpSisnetCaja ?? '',
    EmpSisnetTasaBasica: emp.EmpSisnetTasaBasica ?? 'tasa_basica',
    EmpSisnetTasaMinima: emp.EmpSisnetTasaMinima ?? 'tasa_Minima',
    EmpActiva: Number(emp.EmpActiva) === 1 || emp.EmpActiva === true,
    EmpPorDefecto: Number(emp.EmpPorDefecto) === 1 || emp.EmpPorDefecto === true,
});

// ─── Input reutilizable (tema dark card) ─────────────────
const Field = ({ label, name, value, onChange, type = 'text', placeholder, required, helper }) => (
    <div className="flex flex-col gap-1">
        <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
            {label} {required && <span className="text-cyan-400">*</span>}
        </label>
        <input
            type={type}
            name={name}
            value={value ?? ''}
            onChange={onChange}
            placeholder={placeholder}
            className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm w-full outline-none focus:border-cyan-500 placeholder:text-zinc-500"
        />
        {helper && <span className="text-[10px] text-zinc-500">{helper}</span>}
    </div>
);

// ─── Parámetros DGI globales (umbral e-Ticket: tope en UI × valor de la UI) ───
const ParametrosDGI = () => {
    const [conf, setConf] = useState({ limiteUI: '', valorUI: '' });
    const [cargando, setCargando] = useState(true);
    const [guardando, setGuardando] = useState(false);

    useEffect(() => {
        api.get('/contabilidad/cfe/config-dgi')
            .then(({ data }) => {
                if (data?.success) setConf({ limiteUI: String(data.limiteUI), valorUI: String(data.valorUI) });
            })
            .catch(() => {})
            .finally(() => setCargando(false));
    }, []);

    const guardar = async () => {
        const limiteUI = parseFloat(String(conf.limiteUI).replace(',', '.'));
        const valorUI = parseFloat(String(conf.valorUI).replace(',', '.'));
        if (!(limiteUI > 0) || !(valorUI > 0)) {
            toast.error('Valores inválidos: el tope (en UI) y el valor de la UI deben ser números mayores a 0. Solución: revisá los campos (ej: 10000 y 6.5321).');
            return;
        }
        setGuardando(true);
        try {
            await api.put('/contabilidad/cfe/config-dgi', { limiteUI, valorUI });
            toast.success(`Parámetros DGI guardados. Nuevo umbral: $ ${(limiteUI * valorUI).toLocaleString('es-UY', { maximumFractionDigits: 2 })} UYU (${limiteUI.toLocaleString('es-UY')} UI × $${valorUI}).`);
        } catch (err) {
            toast.error('No se pudieron guardar los parámetros DGI: ' + (err.response?.data?.error || err.message));
        } finally {
            setGuardando(false);
        }
    };

    const umbral = (parseFloat(String(conf.limiteUI).replace(',', '.')) || 0) * (parseFloat(String(conf.valorUI).replace(',', '.')) || 0);

    return (
        <div className="bg-zinc-900 rounded-2xl p-4 border border-zinc-800 flex flex-col gap-3">
            <div>
                <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Parámetros DGI (globales)</p>
                <p className="text-[10px] text-zinc-500 mt-0.5 leading-snug">
                    Tope en Unidades Indexadas y valor vigente de la UI. Sobre este umbral, los e-Tickets exigen CI/RUT del comprador. Aplica a todas las empresas.
                </p>
            </div>
            {cargando ? (
                <div className="flex items-center gap-2 text-zinc-500 text-xs"><Loader2 size={14} className="animate-spin text-cyan-400" /> Cargando…</div>
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Tope (en UI)</label>
                            <input
                                value={conf.limiteUI}
                                onChange={e => setConf(p => ({ ...p, limiteUI: e.target.value }))}
                                placeholder="10000"
                                className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm w-full"
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Valor UI ($)</label>
                            <input
                                value={conf.valorUI}
                                onChange={e => setConf(p => ({ ...p, valorUI: e.target.value }))}
                                placeholder="6.5321"
                                className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm w-full"
                            />
                        </div>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] text-cyan-400 font-bold">
                            Umbral: {umbral > 0 ? `$ ${umbral.toLocaleString('es-UY', { maximumFractionDigits: 2 })} UYU` : '—'}
                        </span>
                        <button
                            onClick={guardar}
                            disabled={guardando}
                            className="flex items-center gap-1.5 bg-zinc-100 hover:bg-white text-zinc-900 font-bold text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                            {guardando ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Guardar
                        </button>
                    </div>
                </>
            )}
        </div>
    );
};

const SectionTitle = ({ children }) => (
    <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wider mt-2 mb-1 pb-1 border-b border-zinc-800">
        {children}
    </h3>
);

// ─── Panel principal ─────────────────────────────────────
const EmpresasAdminPanel = () => {
    const [empresas, setEmpresas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [togglingId, setTogglingId] = useState(null);
    const [settingDefault, setSettingDefault] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);

    const isEditing = form.EmpIdEmpresa != null;

    // ─── Carga de la lista (todas, incl. inactivas) ──────
    const cargarEmpresas = useCallback(async (selectId = null) => {
        setLoading(true);
        try {
            const data = await listarEmpresas(false);
            setEmpresas(data);
            if (selectId != null) {
                const found = data.find((e) => e.EmpIdEmpresa === selectId);
                if (found) setForm(empresaToForm(found));
            }
            return data;
        } catch (e) {
            toast.error(e.response?.data?.error || e.message || 'Error al cargar empresas');
            return [];
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        cargarEmpresas();
    }, [cargarEmpresas]);

    // ─── Handlers de formulario ──────────────────────────
    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setForm((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleNueva = () => setForm(EMPTY_FORM);

    const handleSelect = (emp) => setForm(empresaToForm(emp));

    // ─── Guardar (crear / actualizar) ────────────────────
    const handleGuardar = async () => {
        if (!form.EmpRuc.trim()) {
            toast.error('El RUC es obligatorio');
            return;
        }
        if (!form.EmpRazonSocial.trim()) {
            toast.error('La razón social es obligatoria');
            return;
        }

        // Construir payload
        const payload = {
            EmpRuc: form.EmpRuc.trim(),
            EmpRazonSocial: form.EmpRazonSocial.trim(),
            EmpNombreFantasia: form.EmpNombreFantasia,
            EmpSlogan: form.EmpSlogan,
            EmpDireccion: form.EmpDireccion,
            EmpCiudad: form.EmpCiudad,
            EmpDepartamento: form.EmpDepartamento,
            EmpPais: form.EmpPais,
            EmpTelefono: form.EmpTelefono,
            EmpEmail: form.EmpEmail,
            EmpWeb: form.EmpWeb,
            EmpLogoUrl: form.EmpLogoUrl,
            EmpColorPrimario: form.EmpColorPrimario,
            EmpSisnetWsdlUrl: form.EmpSisnetWsdlUrl,
            EmpSisnetUser: form.EmpSisnetUser,
            EmpSisnetCaja: form.EmpSisnetCaja,
            EmpSisnetTasaBasica: form.EmpSisnetTasaBasica,
            EmpSisnetTasaMinima: form.EmpSisnetTasaMinima,
            EmpActiva: form.EmpActiva ? 1 : 0,
        };

        // CRÍTICO: solo enviar la contraseña si el campo NO está vacío,
        // de lo contrario el backend conserva la almacenada.
        if (form.EmpSisnetPass && form.EmpSisnetPass.trim() !== '') {
            payload.EmpSisnetPass = form.EmpSisnetPass;
        }

        setSaving(true);
        try {
            let savedId = form.EmpIdEmpresa;
            if (isEditing) {
                await actualizarEmpresa(form.EmpIdEmpresa, payload);
                toast.success('Empresa actualizada');
            } else {
                const created = await crearEmpresa(payload);
                savedId = created?.EmpIdEmpresa ?? created?.id ?? null;
                toast.success('Empresa creada');
            }
            await cargarEmpresas(savedId);
        } catch (e) {
            toast.error(e.response?.data?.error || e.message || 'Error al guardar la empresa');
        } finally {
            setSaving(false);
        }
    };

    // ─── Marcar por defecto ──────────────────────────────
    const handleSetDefault = async () => {
        if (!isEditing) return;
        setSettingDefault(true);
        try {
            await setEmpresaPorDefecto(form.EmpIdEmpresa);
            toast.success('Empresa marcada como predeterminada');
            await cargarEmpresas(form.EmpIdEmpresa);
        } catch (e) {
            toast.error(e.response?.data?.error || e.message || 'Error al marcar por defecto');
        } finally {
            setSettingDefault(false);
        }
    };

    // ─── Activar / desactivar desde la tarjeta ───────────
    const handleToggle = async (emp, e) => {
        e.stopPropagation();
        setTogglingId(emp.EmpIdEmpresa);
        try {
            await toggleActivaEmpresa(emp.EmpIdEmpresa);
            toast.success(
                Number(emp.EmpActiva) === 1 || emp.EmpActiva === true
                    ? 'Empresa desactivada'
                    : 'Empresa activada'
            );
            const keepSelected = form.EmpIdEmpresa === emp.EmpIdEmpresa ? emp.EmpIdEmpresa : null;
            await cargarEmpresas(keepSelected);
        } catch (err) {
            toast.error(err.response?.data?.error || err.message || 'Error al cambiar el estado');
        } finally {
            setTogglingId(null);
        }
    };

    // ─── Render ──────────────────────────────────────────
    return (
        <div className="flex flex-col lg:flex-row gap-4">
            {/* ─── COLUMNA IZQUIERDA: lista ─── */}
            <div className="w-full lg:w-80 shrink-0 flex flex-col gap-3">
                <ParametrosDGI />
                <button
                    onClick={handleNueva}
                    className="flex items-center justify-center gap-2 px-4 py-2.5 bg-zinc-900 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-lg hover:bg-zinc-800 transition-all"
                >
                    <Plus size={15} /> Nueva empresa
                </button>

                <div className="flex items-center justify-between px-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                        {empresas.length} empresa{empresas.length === 1 ? '' : 's'}
                    </span>
                    <button
                        onClick={() => cargarEmpresas(form.EmpIdEmpresa)}
                        className="p-1.5 rounded-lg hover:bg-zinc-200 text-zinc-500 transition-all"
                        title="Recargar"
                    >
                        <RefreshCw size={13} />
                    </button>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-10">
                        <Loader2 className="animate-spin text-cyan-500" size={28} />
                    </div>
                ) : empresas.length === 0 ? (
                    <p className="text-sm text-zinc-400 italic px-1 py-6">No hay empresas registradas.</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {empresas.map((emp) => {
                            const activa = Number(emp.EmpActiva) === 1 || emp.EmpActiva === true;
                            const porDefecto = Number(emp.EmpPorDefecto) === 1 || emp.EmpPorDefecto === true;
                            const selected = form.EmpIdEmpresa === emp.EmpIdEmpresa;
                            return (
                                <div
                                    key={emp.EmpIdEmpresa}
                                    onClick={() => handleSelect(emp)}
                                    className={`bg-zinc-900 rounded-2xl p-4 border cursor-pointer transition-all ${
                                        selected
                                            ? 'border-cyan-500 ring-1 ring-cyan-500/40'
                                            : 'border-zinc-800 hover:border-zinc-600'
                                    }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="w-9 h-9 rounded-xl bg-zinc-800 flex items-center justify-center shrink-0 text-cyan-400">
                                            <Building2 size={18} />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-bold text-white truncate">
                                                {emp.EmpNombreFantasia || emp.EmpRazonSocial || 'Sin nombre'}
                                            </p>
                                            <p className="text-[11px] text-zinc-500 font-mono truncate">
                                                {emp.EmpRuc || '—'}
                                            </p>
                                            <div className="flex flex-wrap gap-1.5 mt-2">
                                                {porDefecto && (
                                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-cyan-500/20 text-cyan-300 flex items-center gap-1">
                                                        <Star size={9} /> Por defecto
                                                    </span>
                                                )}
                                                {!activa && (
                                                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-zinc-700 text-zinc-400">
                                                        Inactiva
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => handleToggle(emp, e)}
                                            disabled={togglingId === emp.EmpIdEmpresa}
                                            title={activa ? 'Desactivar' : 'Activar'}
                                            className={`p-1.5 rounded-lg shrink-0 transition-all disabled:opacity-50 ${
                                                activa
                                                    ? 'text-emerald-400 hover:bg-emerald-500/10'
                                                    : 'text-zinc-500 hover:bg-zinc-800'
                                            }`}
                                        >
                                            {togglingId === emp.EmpIdEmpresa ? (
                                                <Loader2 size={16} className="animate-spin" />
                                            ) : (
                                                <Power size={16} />
                                            )}
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ─── COLUMNA DERECHA: formulario ─── */}
            <div className="flex-1 min-w-0">
                <div className="bg-zinc-900 rounded-2xl p-5 border border-zinc-800">
                    <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
                        <div className="flex items-center gap-2">
                            <Building2 size={18} className="text-cyan-400" />
                            <h2 className="text-sm font-black text-white uppercase tracking-wider">
                                {isEditing ? 'Editar empresa' : 'Nueva empresa'}
                            </h2>
                        </div>
                        <button
                            onClick={handleGuardar}
                            disabled={saving}
                            className="flex items-center gap-2 px-4 py-2 bg-zinc-900 text-white border border-zinc-700 rounded-xl text-xs font-bold uppercase tracking-wider hover:border-cyan-500 disabled:opacity-50 transition-all"
                            style={{ backgroundColor: saving ? undefined : '#00B4D8', borderColor: '#00B4D8' }}
                        >
                            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                            {saving ? 'Guardando...' : 'Guardar'}
                        </button>
                    </div>

                    {/* Identidad */}
                    <SectionTitle>Identidad</SectionTitle>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field label="RUC" name="EmpRuc" value={form.EmpRuc} onChange={handleChange} required />
                        <Field label="Razón social" name="EmpRazonSocial" value={form.EmpRazonSocial} onChange={handleChange} required />
                        <Field label="Nombre fantasía" name="EmpNombreFantasia" value={form.EmpNombreFantasia} onChange={handleChange} />
                        <Field label="Slogan" name="EmpSlogan" value={form.EmpSlogan} onChange={handleChange} />
                        <Field label="Dirección" name="EmpDireccion" value={form.EmpDireccion} onChange={handleChange} />
                        <Field label="Ciudad" name="EmpCiudad" value={form.EmpCiudad} onChange={handleChange} />
                        <Field label="Departamento" name="EmpDepartamento" value={form.EmpDepartamento} onChange={handleChange} />
                        <Field label="País" name="EmpPais" value={form.EmpPais} onChange={handleChange} />
                        <Field label="Teléfono" name="EmpTelefono" value={form.EmpTelefono} onChange={handleChange} />
                        <Field label="Email" name="EmpEmail" value={form.EmpEmail} onChange={handleChange} type="email" />
                        <Field label="Web" name="EmpWeb" value={form.EmpWeb} onChange={handleChange} />
                        <Field label="Logo (URL / ruta)" name="EmpLogoUrl" value={form.EmpLogoUrl} onChange={handleChange} placeholder="/assets/images/logo/u.png" helper="Usá PNG o JPG — el PDF NO soporta SVG. Vacío = wordmark 'user'+CMYK." />
                    </div>

                    {/* Preview del logo */}
                    {form.EmpLogoUrl && form.EmpLogoUrl.trim() !== '' && (
                        <div className="mt-3 flex items-center gap-2">
                            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Vista previa:</span>
                            <img
                                src={form.EmpLogoUrl}
                                alt="logo"
                                className="h-10 rounded bg-white/5 p-1"
                                onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                        </div>
                    )}

                    {/* Color primario */}
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                                Color primario
                            </label>
                            <div className="flex items-center gap-2">
                                <input
                                    type="color"
                                    name="EmpColorPrimario"
                                    value={/^#[0-9A-Fa-f]{6}$/.test(form.EmpColorPrimario || '') ? form.EmpColorPrimario : '#00B4D8'}
                                    onChange={handleChange}
                                    className="h-9 w-12 rounded-lg border border-zinc-700 bg-zinc-800 cursor-pointer"
                                />
                                <input
                                    type="text"
                                    name="EmpColorPrimario"
                                    value={form.EmpColorPrimario ?? ''}
                                    onChange={handleChange}
                                    placeholder="#00B4D8"
                                    className="bg-zinc-800 border border-zinc-700 text-white rounded-lg px-3 py-2 text-sm flex-1 outline-none focus:border-cyan-500 placeholder:text-zinc-500 font-mono"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Facturación electrónica (SISNET) */}
                    <SectionTitle>Facturación electrónica (SISNET)</SectionTitle>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <Field label="WSDL URL" name="EmpSisnetWsdlUrl" value={form.EmpSisnetWsdlUrl} onChange={handleChange} />
                        <Field label="Usuario" name="EmpSisnetUser" value={form.EmpSisnetUser} onChange={handleChange} />
                        <Field
                            label="Contraseña"
                            name="EmpSisnetPass"
                            value={form.EmpSisnetPass}
                            onChange={handleChange}
                            type="password"
                            placeholder="Dejar vacío para no cambiar"
                        />
                        <Field
                            label="Caja"
                            name="EmpSisnetCaja"
                            value={form.EmpSisnetCaja}
                            onChange={handleChange}
                            placeholder="ej: 1/TEST"
                            helper="Código de punto de emisión que te da SISNET (ej: 1/TEST). NO es el RUC."
                        />
                        <Field label="Tasa básica" name="EmpSisnetTasaBasica" value={form.EmpSisnetTasaBasica} onChange={handleChange} />
                        <Field label="Tasa mínima" name="EmpSisnetTasaMinima" value={form.EmpSisnetTasaMinima} onChange={handleChange} />
                    </div>

                    {/* Estado */}
                    <SectionTitle>Estado</SectionTitle>
                    <div className="flex flex-wrap items-center gap-4">
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                name="EmpActiva"
                                checked={!!form.EmpActiva}
                                onChange={handleChange}
                                className="accent-cyan-500 w-4 h-4"
                            />
                            <span className="text-sm font-bold text-zinc-300">Empresa activa</span>
                        </label>

                        {isEditing && !form.EmpPorDefecto && (
                            <button
                                onClick={handleSetDefault}
                                disabled={settingDefault}
                                className="flex items-center gap-2 px-4 py-2 bg-white text-zinc-500 border border-zinc-200 rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-zinc-100 disabled:opacity-50 transition-all"
                            >
                                {settingDefault ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} />}
                                Marcar como empresa por defecto
                            </button>
                        )}

                        {isEditing && form.EmpPorDefecto && (
                            <span className="px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider bg-cyan-500/20 text-cyan-300 flex items-center gap-1.5">
                                <Star size={12} /> Empresa por defecto
                            </span>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EmpresasAdminPanel;
