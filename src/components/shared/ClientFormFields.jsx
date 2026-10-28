import { useState, useEffect } from 'react';
import { User, Phone, MapPin, FileText, Building, ChevronDown, Truck } from 'lucide-react';
import { CustomSelect } from '../../client-portal/pautas/CustomSelect';

const inputClass = "w-full pl-10 pr-4 py-2 bg-[#111] border border-[#3f3f46] rounded-[10px] focus:ring-1 focus:ring-[#00AEEF] focus:border-[#00AEEF] transition-all outline-none font-semibold text-sm text-zinc-100 placeholder-zinc-500 focus:placeholder-zinc-100";
const selectClass = "w-full pl-10 pr-10 py-2 bg-[#111] border border-[#3f3f46] rounded-[10px] focus:ring-1 focus:ring-[#00AEEF] focus:border-[#00AEEF] transition-all outline-none font-semibold text-sm text-zinc-100 appearance-none cursor-pointer hover:border-zinc-500";
const labelClass = "text-xs font-bold text-zinc-100 uppercase tracking-wider ml-1";
const iconClass = "absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-[#00AEEF] transition-colors";

// Largos de dbo.Clientes: el backend (webAuthController) rechaza lo que se pase. Nombre y apellido van juntos a una
// columna de 150 (70 + 70), el teléfono a una de 20, la razón social a una de 150.
export const LARGO_DIRECCION = 80;

export const Field = ({ label, icon: Icon, required, error, children }) => (
    <div className="space-y-1">
        <label className={labelClass}>
            {label} {required && <span className="text-custom-magenta">*</span>}
        </label>
        <div className="relative group">
            <div className={iconClass}><Icon size={18} /></div>
            {children}
        </div>
        {error && <p className="text-custom-magenta text-xs font-semibold ml-1 mt-0.5">{error}</p>}
    </div>
);

// Export style constants for pages that need them (e.g. password fields)
export { inputClass, selectClass, labelClass, iconClass };

/**
 * Shared nomenclator hook — fetches departments, localities, agencies.
 */
export const useNomenclators = (departamentoId, fetchFn) => {
    const [departments, setDepartments] = useState([]);
    const [localities, setLocalities] = useState([]);
    const [agencies, setAgencies] = useState([]);

    useEffect(() => {
        fetchFn('/nomenclators/departments')
            .then(data => { if (data.success) setDepartments(data.data); })
            .catch(() => { });
    }, []);

    useEffect(() => {
        fetchFn('/nomenclators/agencies')
            .then(data => { if (data.success) setAgencies(data.data); })
            .catch(() => { });
    }, []);

    useEffect(() => {
        if (!departamentoId) { setLocalities([]); return; }
        fetchFn(`/nomenclators/localities/${departamentoId}`)
            .then(data => { if (data.success) setLocalities(data.data); })
            .catch(() => { });
    }, [departamentoId]);

    return { departments, localities, agencies };
};

/**
 * Shared form fields for client data.
 */
export const ClientFormFields = ({ form, set, fieldErrors = {}, handleBlur, departments, localities, agencies, isMontevideo, placeholders = {} }) => {
    const blur = handleBlur || (() => () => { });

    // Auto-select locality when only one exists for the chosen department
    useEffect(() => {
        if (localities.length === 1 && !form.localidadId) {
            set('localidadId')({ target: { value: String(localities[0].ID) } });
        }
    }, [localities]);

    // Bridge CustomSelect onChange (passes value directly) to set() handler (expects e.target.value)
    const selectSet = (key) => (val) => set(key)({ target: { value: val } });

    const ph = {
        nombre: 'Juan',
        apellido: 'Pérez',
        telefono: '099123456',
        razonSocial: 'Opcional',
        rut: 'Sin puntos ni guiones',
        documento: 'Sin puntos ni guiones',
        direccion: 'Calle 1234',
        ...placeholders,
    };

    return (
        <>
            {/* Nombre | Apellido */}
            <div className="grid grid-cols-2 gap-3">
                <Field label="Nombre" icon={User} required error={fieldErrors.nombre}>
                    <input type="text" className={`${inputClass} ${fieldErrors.nombre ? 'border-custom-magenta focus:ring-brand-magenta focus:border-custom-magenta' : ''}`} placeholder={ph.nombre} value={form.nombre} maxLength={70} onChange={set('nombre')} onBlur={blur('nombre')} />
                </Field>
                <Field label="Apellido" icon={User} required error={fieldErrors.apellido}>
                    <input type="text" className={`${inputClass} ${fieldErrors.apellido ? 'border-custom-magenta focus:ring-brand-magenta focus:border-custom-magenta' : ''}`} placeholder={ph.apellido} value={form.apellido} maxLength={70} onChange={set('apellido')} onBlur={blur('apellido')} />
                </Field>
            </div>

            {/* Teléfono */}
            <Field label="Teléfono" icon={Phone} required error={fieldErrors.telefono}>
                <input type="text" className={`${inputClass} ${fieldErrors.telefono ? 'border-custom-magenta focus:ring-brand-magenta focus:border-custom-magenta' : ''}`} placeholder={ph.telefono} value={form.telefono} maxLength={20} onChange={set('telefono')} onBlur={blur('telefono')} />
            </Field>

            {/* Razón Social */}
            <Field label="Razón Social" icon={Building}>
                <input type="text" className={inputClass} placeholder={ph.razonSocial} value={form.razonSocial} maxLength={150} onChange={set('razonSocial')} />
            </Field>

            {/* Cédula o RUT */}
            <Field label="Cédula o RUT" icon={FileText} required error={fieldErrors.rut}>
                <input type="text" className={`${inputClass} ${fieldErrors.rut ? 'border-custom-magenta focus:ring-brand-magenta focus:border-custom-magenta' : ''}`} placeholder={ph.rut} value={form.rut} maxLength={12} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); set('rut')({ target: { value: v } }); }} onBlur={blur('rut')} />
            </Field>



            {/* Dirección: la base guarda hasta 80 caracteres (Clientes.DireccionTrabajo); con más, el registro daba error.
                Cerca del tope se muestra cuánto queda. */}
            <Field label="Dirección" icon={MapPin} required error={fieldErrors.direccion}>
                <input type="text" className={`${inputClass} ${(form.direccion || '').length >= 60 ? 'pr-14' : ''} ${fieldErrors.direccion ? 'border-custom-magenta focus:ring-brand-magenta focus:border-custom-magenta' : ''}`} placeholder={ph.direccion} value={form.direccion} maxLength={LARGO_DIRECCION} onChange={set('direccion')} onBlur={blur('direccion')} />
                {(form.direccion || '').length >= 60 && (
                    <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold tabular-nums pointer-events-none ${(form.direccion || '').length >= LARGO_DIRECCION ? 'text-custom-magenta' : 'text-zinc-500'}`}>
                        {(form.direccion || '').length}/{LARGO_DIRECCION}
                    </span>
                )}
            </Field>

            {/* Lógica condicional del Layout para Departamento, Localidad y Agencia */}
            {form.departamentoId && !isMontevideo ? (
                // Si HAY agencia: Todo a la izquierda (dividido en 2) y Agencia a la derecha
                <>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-1">
                            <label className={labelClass}>
                                Departamento <span className="text-custom-magenta">*</span>
                            </label>
                            <CustomSelect
                                value={form.departamentoId}
                                onChange={selectSet('departamentoId')}
                                options={departments.map(d => ({ value: String(d.ID), label: d.Nombre }))}
                                placeholder="Seleccionar..."
                                size="small"
                                direction="up"
                                className="font-semibold transition-all"
                                variant="black"
                            />
                            {fieldErrors.departamentoId && <p className="text-custom-magenta text-xs font-semibold ml-1 mt-0.5">{fieldErrors.departamentoId}</p>}
                        </div>
                        <div className="space-y-1">
                            <label className={labelClass}>
                                Localidad <span className="text-custom-magenta">*</span>
                            </label>
                            <CustomSelect
                                value={form.localidadId}
                                onChange={selectSet('localidadId')}
                                options={localities.map(l => ({ value: String(l.ID), label: l.Nombre }))}
                                placeholder={form.departamentoId ? 'Seleccionar...' : 'Localidad'}
                                size="small"
                                direction="up"
                                disabled={!form.departamentoId}
                                className="font-semibold transition-all"
                                variant="black"
                            />
                            {fieldErrors.localidadId && <p className="text-custom-magenta text-xs font-semibold ml-1 mt-0.5">{fieldErrors.localidadId}</p>}
                        </div>
                    </div>
                    <div className="space-y-1">
                        <label className={labelClass}>
                            Agencia <span className="text-custom-magenta">*</span>
                        </label>
                        <CustomSelect
                            value={form.agenciaId}
                            onChange={selectSet('agenciaId')}
                            options={agencies.map(a => ({ value: String(a.ID), label: a.Nombre }))}
                            placeholder="Seleccionar agencia..."
                            size="small"
                            direction="up"
                            className="font-semibold transition-all"
                            variant="black"
                        />
                        {fieldErrors.agenciaId && <p className="text-custom-magenta text-xs font-semibold ml-1 mt-0.5">{fieldErrors.agenciaId}</p>}
                    </div>
                </>
            ) : (
                // Si NO hay agencia: Departamento ocupa toda la izq, y Localidad toda la der
                <>
                    <div className="space-y-1">
                        <label className={labelClass}>
                            Departamento <span className="text-custom-magenta">*</span>
                        </label>
                        <CustomSelect
                            value={form.departamentoId}
                            onChange={selectSet('departamentoId')}
                            options={departments.map(d => ({ value: String(d.ID), label: d.Nombre }))}
                            placeholder="Seleccionar..."
                            size="small"
                            direction="up"
                            className="font-semibold transition-all"
                            variant="black"
                        />
                        {fieldErrors.departamentoId && <p className="text-custom-magenta text-xs font-semibold ml-1 mt-0.5">{fieldErrors.departamentoId}</p>}
                    </div>
                    <div className="space-y-1">
                        <label className={labelClass}>
                            Localidad <span className="text-custom-magenta">*</span>
                        </label>
                        <CustomSelect
                            value={form.localidadId}
                            onChange={selectSet('localidadId')}
                            options={localities.map(l => ({ value: String(l.ID), label: l.Nombre }))}
                            placeholder={form.departamentoId ? 'Seleccionar...' : 'Localidad'}
                            size="small"
                            direction="up"
                            disabled={!form.departamentoId}
                            className="font-semibold transition-all"
                            variant="black"
                        />
                        {fieldErrors.localidadId && <p className="text-custom-magenta text-xs font-semibold ml-1 mt-0.5">{fieldErrors.localidadId}</p>}
                    </div>
                </>
            )}
        </>
    );
};
