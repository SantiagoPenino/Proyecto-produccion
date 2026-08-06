import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './ClientsIntegration.css';
import { toast } from 'sonner';
import Swal from 'sweetalert2';
import Lottie from 'lottie-react';
import api from '../../services/apiClient';
import { Phone, Mail, Trash2, IdCard, MapPin, Tags, X, Check, Link2, ChevronsUpDown } from 'lucide-react';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import animationData from '../../assets/animations/Loading.json';

// ─── Spinner Lottie reutilizable ──────────────────────────────────────────────
function LottieSpinner({ size = 48 }) {
    return <Lottie animationData={animationData} loop style={{ width: size, height: size, flexShrink: 0 }} />;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const AVATAR_COLORS = ['#4f46e5', '#0891b2', '#059669', '#d97706', '#dc2626', '#7c3aed', '#2563eb', '#be185d'];
const getAvatarColor = (name) => { const s = String(name ?? ''); return AVATAR_COLORS[(s.charCodeAt(0) || 0) % AVATAR_COLORS.length]; };
const getInitials = (name) => { const s = String(name ?? '').trim(); return s.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?'; };

const DUP_COLORS = { Email: '#dc2626', TelefonoTrabajo: '#d97706', Nombre: '#7c3aed', IDCliente: '#0891b2', IDReact: '#059669', CodCliente: '#db2777' };

const statusColor = (s) => s === 'ACTIVO' ? 'green' : s === 'INACTIVO' ? 'red' : s === 'BLOQUEADO' ? 'amber' : 'slate';

function Badge({ children, color = 'slate' }) {
    return <span className={`ci-badge ${color}`}>{children}</span>;
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Avatar({ name, size = 34 }) {
    const bg = getAvatarColor(name);
    return (
        <div className="ci-avatar" style={{ background: bg, width: size, height: size, fontSize: size * .36 }}>
            {getInitials(name)}
        </div>
    );
}

// Nombre a mostrar: muchos clientes tienen `Nombre` vacío y solo `NombreFantasia`
// (por eso media grilla mostraba avatares con "?"). Se usa el que exista.
const nombreVisible = (c) => (c?.Nombre || '').trim() || (c?.NombreFantasia || '').trim() || '';

// Gradiente del avatar: dos tonos derivados del color base, para que la ficha
// tenga algo de vida en vez de un cuadrado de color plano.
const getAvatarGradient = (name) => {
    const c = getAvatarColor(name);
    return `linear-gradient(135deg, ${c} 0%, ${c}cc 55%, ${c}99 100%)`;
};

// ─── Helpers de campo reutilizables (FUERA del modal para evitar remounts) ────
// IMPORTANTE: si se definen dentro del componente, React los trata como nuevos
// tipos en cada render y desmonta/remonta el input → pérdida de foco al tipear.
function ModalField({ label, field, type = 'text', readOnly = false, cls = '', form, onChange }) {
    return (
        <div className={`ci-field ${cls}`}>
            <label>{label}</label>
            <input type={type} value={form[field] ?? ''} onChange={onChange(field)} readOnly={readOnly} />
        </div>
    );
}
// Desplegable con HeadlessUI en vez del <select> nativo: el nativo no se puede
// estilar (el panel lo dibuja el sistema operativo) y con listas largas —
// localidades, vendedores— se veía distinto en cada máquina.
// `anchor` posiciona el panel por fuera del contenedor: si no, el scroll del
// cuerpo del modal lo recortaba.
// Los catálogos vienen del ERP con la caja mezclada ("atlantida", "LAS TOSCAS",
// "Ciudad de la Costa", "DAC") y las listas se veían desparejas. Se normaliza al
// MOSTRAR; el dato guardado nunca se toca.
//
// Solo se corrige lo que está mal escrito — todo en MAYÚSCULA o todo en minúscula.
// Si el texto ya mezcla ambas, viene bien tipeado y se respeta tal cual: aplicarle
// la regla rompía "DePunta" → "Depunta", "Encomienda (Agencia)" → "(agencia)" y
// "Retiro en el Local" → "Retiro En el Local".
// Excepción: una palabra suelta de hasta 3 letras en mayúscula es una sigla (DAC).
const MINUSCULAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a', 'al', 'con', 'para', 'por', 'o', 'u']);
const capitalCase = (s) => {
    const str = String(s ?? '').trim();
    if (!str) return str;
    const tieneMin = /[a-záéíóúüñ]/.test(str);
    const tieneMay = /[A-ZÁÉÍÓÚÜÑ]/.test(str);
    if (tieneMin && tieneMay) return str;                       // ya viene bien escrito
    if (!tieneMin && str.length <= 3 && !str.includes(' ')) return str;  // sigla: DAC, UTE
    return str.toLowerCase().split(/\s+/)
        .map((w, i) => (i > 0 && MINUSCULAS.has(w))
            ? w
            : w.replace(/(^|\()([a-záéíóúüñ])/g, (m, p, c) => p + c.toUpperCase()))
        .join(' ');
};

function CiSelect({ value, onChange, options = [], idKey = 'ID', nameKey = 'Nombre',
    placeholder = 'Sin asignar', allowEmpty = true, format = capitalCase }) {
    const sel = options.find(o => String(o[idKey]) === String(value ?? ''));
    // Por defecto TODOS los desplegables normalizan a Capital Case: los catálogos
    // vienen del ERP con la caja mezclada (DAC, "Encomienda (Agencia)", "Comun",
    // nombres de vendedor en mayúscula). Solo cambia lo que se ve, no lo guardado.
    const txt = (o) => format ? format(o[nameKey]) : o[nameKey];
    return (
        <Listbox value={value ?? ''} onChange={onChange}>
            <div className="ci-lb">
                <ListboxButton className="ci-lb-btn">
                    <span className={sel ? '' : 'ci-lb-ph'}>{sel ? txt(sel) : placeholder}</span>
                    <ChevronsUpDown size={13} strokeWidth={2.2} />
                </ListboxButton>
                <ListboxOptions anchor="bottom start" className="ci-lb-panel">
                    {allowEmpty && (
                        <ListboxOption value="" className="ci-lb-opt">
                            <span className="ci-lb-ph">{placeholder}</span>
                            {!sel && <Check size={13} strokeWidth={3} />}
                        </ListboxOption>
                    )}
                    {options.map(o => (
                        <ListboxOption key={o[idKey]} value={String(o[idKey])} className="ci-lb-opt">
                            <span>{txt(o)}</span>
                            {sel && String(sel[idKey]) === String(o[idKey]) && <Check size={13} strokeWidth={3} />}
                        </ListboxOption>
                    ))}
                </ListboxOptions>
            </div>
        </Listbox>
    );
}

function ModalSelect({ label, field, options = [], idKey = 'ID', nameKey = 'Nombre', cls = '', form, onChange, format }) {
    return (
        <div className={`ci-field ${cls}`}>
            <label>{label}</label>
            {/* Listbox devuelve el valor directo; `set` espera un evento, así que se envuelve */}
            <CiSelect value={form[field]} options={options} idKey={idKey} nameKey={nameKey} format={format}
                onChange={(v) => onChange(field)({ target: { value: v } })} />
        </div>
    );
}

// ─── Modal ABM ────────────────────────────────────────────────────────────────
function ClientModal({ client, catalogs, onClose, onSaved, onDeleted }) {
    const isNew = !client?.CodCliente;
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState(false);

    // Helper: buscar IDs de defaults en catálogos
    const getDefaults = useCallback(() => {
        const dacId = (catalogs.agencias || []).find(a => a.Nombre?.toUpperCase().includes('DAC'))?.ID || '';
        const mvdDep = (catalogs.departamentos || []).find(d => d.Nombre?.toUpperCase().includes('MONTEVIDEO'));
        const mvdDepId = mvdDep?.ID || '';
        const mvdLocId = mvdDepId ? ((catalogs.localidades || []).find(l => String(l.DepartamentoID) === String(mvdDepId) && l.Nombre?.toUpperCase().includes('MONTEVIDEO'))?.ID || '') : '';
        const comunId = (catalogs.tiposClientes || []).find(t => t.Nombre?.toUpperCase().includes('COMUN') || t.Nombre?.toUpperCase().includes('COMÚN'))?.ID || '';
        return { dacId, mvdDepId, mvdLocId, comunId };
    }, [catalogs]);

    useEffect(() => {
        if (client) {
            const { dacId, mvdDepId, mvdLocId, comunId } = getDefaults();
            // Trim todos los strings (las columnas CHAR de SQL Server agregan espacios)
            const trimmed = {};
            for (const [k, v] of Object.entries(client)) {
                trimmed[k] = typeof v === 'string' ? v.trim() : v;
            }
            // Defaults para campos vacíos (solo al editar existentes)
            if (!trimmed.AgenciaID) trimmed.AgenciaID = dacId;
            if (!trimmed.ESTADO) trimmed.ESTADO = 'ACTIVO';
            if (!trimmed.DepartamentoID) trimmed.DepartamentoID = mvdDepId;
            if (!trimmed.LocalidadID) trimmed.LocalidadID = mvdLocId;
            if (!trimmed.TClIdTipoCliente) trimmed.TClIdTipoCliente = comunId;
            setForm(trimmed);
        } else {
            // Nuevo cliente: solo tipo y estado con default, el resto vacío
            const { comunId } = getDefaults();
            setForm({ Nombre: '', NombreFantasia: '', IDCliente: '', CioRuc: '', TelefonoTrabajo: '', Email: '', DireccionTrabajo: '', TClIdTipoCliente: comunId, VendedorID: '', DepartamentoID: '', LocalidadID: '', AgenciaID: '', FormaEnvioID: '', ESTADO: 'ACTIVO', WebActive: true });
        }
    }, [client, getDefaults]);

    const set = f => e => setForm(p => ({ ...p, [f]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
    const locs = useMemo(() => form.DepartamentoID ? (catalogs.localidades || []).filter(l => String(l.DepartamentoID) === String(form.DepartamentoID)) : (catalogs.localidades || []), [form.DepartamentoID, catalogs.localidades]);

    // Auto-seleccionar localidad si el departamento tiene solo una (solo al editar)
    useEffect(() => {
        if (isNew) return;
        if (locs.length === 1) {
            setForm(p => ({ ...p, LocalidadID: locs[0].ID }));
        }
    }, [locs, isNew]);

    // Auto-seleccionar forma de envío según departamento (solo al editar, si no tiene una)
    useEffect(() => {
        if (isNew || !form.DepartamentoID || form.FormaEnvioID) return;
        const dep = (catalogs.departamentos || []).find(d => String(d.ID) === String(form.DepartamentoID));
        const esMontevideo = dep?.Nombre?.toUpperCase().includes('MONTEVIDEO');
        const formas = catalogs.formasEnvio || [];
        const targetForma = esMontevideo
            ? formas.find(f => f.Nombre?.toUpperCase().includes('RETIRO'))
            : formas.find(f => f.Nombre?.toUpperCase().includes('ENCOMIENDA'));
        if (targetForma) {
            setForm(p => ({ ...p, FormaEnvioID: targetForma.ID }));
        }
    }, [form.DepartamentoID, form.FormaEnvioID, catalogs.departamentos, catalogs.formasEnvio, isNew]);

    // Auto-asignar vendedor por zona del departamento (solo al editar, si no tiene uno)
    useEffect(() => {
        if (isNew || !form.DepartamentoID || form.VendedorID) return;
        api.get(`/nomenclators/vendedores-by-department/${form.DepartamentoID}`)
            .then(r => {
                const vendedores = r.data?.data || [];
                if (vendedores.length > 0) {
                    const random = vendedores[Math.floor(Math.random() * vendedores.length)];
                    setForm(p => p.VendedorID ? p : { ...p, VendedorID: random.Cedula });
                }
            })
            .catch(() => { });
    }, [form.DepartamentoID, form.VendedorID, isNew]);

    // Trim helper: limpia espacios de todos los campos string del form
    const trimForm = (f) => {
        const trimmed = {};
        for (const [k, v] of Object.entries(f)) {
            trimmed[k] = typeof v === 'string' ? v.trim() : v;
        }
        return trimmed;
    };

    // Aplicar defaults a campos vacíos antes de guardar (para nuevos clientes)
    const applyDefaults = async (cleanForm) => {
        const { dacId, mvdDepId, mvdLocId, comunId } = getDefaults();
        if (!cleanForm.ESTADO) cleanForm.ESTADO = 'ACTIVO';
        if (!cleanForm.AgenciaID) cleanForm.AgenciaID = dacId;
        if (!cleanForm.TClIdTipoCliente) cleanForm.TClIdTipoCliente = comunId;
        if (!cleanForm.DepartamentoID) cleanForm.DepartamentoID = mvdDepId;
        if (!cleanForm.LocalidadID) {
            if (cleanForm.DepartamentoID) {
                const deptLocs = (catalogs.localidades || []).filter(l => String(l.DepartamentoID) === String(cleanForm.DepartamentoID));
                cleanForm.LocalidadID = deptLocs.length === 1 ? deptLocs[0].ID : mvdLocId;
            } else {
                cleanForm.LocalidadID = mvdLocId;
            }
        }
        if (!cleanForm.FormaEnvioID) {
            const dep = (catalogs.departamentos || []).find(d => String(d.ID) === String(cleanForm.DepartamentoID));
            const esMvd = dep?.Nombre?.toUpperCase().includes('MONTEVIDEO');
            const formas = catalogs.formasEnvio || [];
            const target = esMvd
                ? formas.find(f => f.Nombre?.toUpperCase().includes('RETIRO'))
                : formas.find(f => f.Nombre?.toUpperCase().includes('ENCOMIENDA'));
            if (target) cleanForm.FormaEnvioID = target.ID;
        }
        if (!cleanForm.VendedorID && cleanForm.DepartamentoID) {
            try {
                const r = await api.get(`/nomenclators/vendedores-by-department/${cleanForm.DepartamentoID}`);
                const vendedores = r.data?.data || [];
                if (vendedores.length > 0) {
                    cleanForm.VendedorID = vendedores[Math.floor(Math.random() * vendedores.length)].Cedula;
                }
            } catch { }
        }
        return cleanForm;
    };

    const handleSave = async () => {
        if (!form.Nombre?.trim()) return toast.error('El nombre es obligatorio');
        setSaving(true);
        let cleanForm = trimForm(form);
        try {
            // Si es nuevo, aplicar defaults a campos vacíos antes de guardar
            if (isNew) cleanForm = await applyDefaults(cleanForm);

            if (isNew) {
                const r = await api.post('/clients', {
                    nombre: cleanForm.Nombre,
                    nombreFantasia: cleanForm.NombreFantasia,
                    telefono: cleanForm.TelefonoTrabajo,
                    email: cleanForm.Email,
                    direccion: cleanForm.DireccionTrabajo,
                    ruc: cleanForm.CioRuc,
                    idCliente: cleanForm.IDCliente,
                    idReact: cleanForm.IDReact,
                    codReferencia: cleanForm.CodReferencia,
                    tipoCliente: cleanForm.TClIdTipoCliente,
                    vendedorId: cleanForm.VendedorID,
                    estado: cleanForm.ESTADO || 'ACTIVO',
                    departamentoId: cleanForm.DepartamentoID,
                    localidadId: cleanForm.LocalidadID,
                    agenciaId: cleanForm.AgenciaID,
                    formaEnvioId: cleanForm.FormaEnvioID,
                    webActive: cleanForm.WebActive ? 1 : 0,
                });
                // POST devuelve el cliente completo con OUTPUT INSERTED.*
                onSaved(r.data);
            } else {
                await api.put(`/clients/${client.CodCliente}`, cleanForm);
                // PUT solo devuelve { success: true }, así que usamos los datos locales
                onSaved({ ...client, ...cleanForm });
            }
            toast.success(isNew ? 'Cliente creado ✓' : 'Cliente actualizado ✓');
            onClose();
        } catch (e) { toast.error(e.response?.data?.error || 'Error guardando'); }
        finally { setSaving(false); }
    };

    const handleDelete = async () => {
        const { value } = await Swal.fire({
            title: '¿Eliminar cliente?',
            // Se identifica por ID CLIENTE, que es como se lo nombra en el sistema; con
            // `Nombre` el cartel decía «Estás por eliminar ""» en la mitad de los casos,
            // porque muchos clientes no lo tienen cargado.
            html: `<p style="margin-bottom:8px">Estás por eliminar <b>"${String(client.IDCliente || '').trim() || `#${client.CodCliente}`}"</b>.</p><p style="font-size:13px;color:#888">Esta acción no se puede deshacer. Escribí <b>eliminar</b> para confirmar.</p>`,
            input: 'text',
            inputPlaceholder: 'Escribí "eliminar"',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Eliminar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#dc2626',
            inputValidator: (val) => {
                if (val?.trim().toLowerCase() !== 'eliminar') return 'Debés escribir "eliminar" para confirmar';
            }
        });
        if (!value) return;
        setDeleting(true);
        try {
            await api.delete(`/clients/${client.CodCliente}`);
            toast.success('Cliente eliminado');
            onDeleted(client.CodCliente);
            onClose();
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo eliminar'); }
        finally { setDeleting(false); }
    };

    return (
        <div className="ci-overlay">
            <div className="ci-modal" onClick={e => e.stopPropagation()}>
                {/* Cabecera con la identidad del cliente (mismo lenguaje que las tarjetas):
                    avatar, ID como título y nombre debajo. Antes decía "Editar:" a secas
                    cuando el cliente no tenía Nombre cargado, que es la mitad de la base. */}
                <div className="ci-modal-header">
                    {!isNew && (
                        <div className="ci-modal-avatar" style={{ background: getAvatarGradient(nombreVisible(client)) }}>
                            {getInitials(nombreVisible(client))}
                        </div>
                    )}
                    <div className="ci-modal-headinfo">
                        <div className="ci-modal-title">
                            {isNew ? 'Nuevo cliente' : (String(client.IDCliente || '').trim() || `#${client.CodCliente}`)}
                        </div>
                        {!isNew && (
                            <div className="ci-modal-sub">
                                {nombreVisible(client) || <em style={{ color: '#cbd5e1' }}>Sin nombre</em>}
                            </div>
                        )}
                    </div>
                    {!isNew && (
                        <div className="ci-modal-tags">
                            <span className={`ci-int-pill ${client.IDReact ? 'on-planilla' : 'off'}`}
                                title={client.IDReact ? `Planilla · IDReact ${client.IDReact}` : 'Sin vincular a Planilla'}>PL</span>
                            <span className={`ci-int-pill ${client.CodReferencia ? 'on-macrosoft' : 'off'}`}
                                title={client.CodReferencia ? `Macrosoft · ${client.CodReferencia}` : 'Sin vincular a Macrosoft'}>MS</span>
                            <span className="ci-modal-cod">#{client.CodCliente}</span>
                        </div>
                    )}
                    <button className="ci-modal-close" onClick={onClose} title="Cerrar"><X size={16} strokeWidth={2.4} /></button>
                </div>
                {/* Dos columnas: a la izquierda QUIÉN es el cliente (identificación y
                    contacto), a la derecha A DÓNDE va y CÓMO se clasifica. Agrupadas en
                    wrappers y no sueltas en el grid, para que las secciones de cada lado
                    queden pegadas entre sí y no se alineen por filas. */}
                <div className="ci-modal-body">
                  <div className="ci-modal-col">
                    <div>
                        <div className="ci-modal-section-title"><IdCard size={13} strokeWidth={2.4} />Identificación</div>
                        <div className="ci-field-grid">
                            <ModalField label="Nombre y Apellido *" field="Nombre" cls="full" form={form} onChange={set} />
                            <ModalField label="Nombre Fantasía" field="NombreFantasia" form={form} onChange={set} />
                            <ModalField label="ID Cliente" field="IDCliente" form={form} onChange={set} />
                            <ModalField label="RUC / C.I." field="CioRuc" cls="full" form={form} onChange={set} />
                        </div>
                    </div>
                    <div>
                        <div className="ci-modal-section-title"><Phone size={13} strokeWidth={2.4} />Contacto</div>
                        <div className="ci-field-grid">
                            <ModalField label="Teléfono" field="TelefonoTrabajo" form={form} onChange={set} />
                            <ModalField label="Email" field="Email" type="email" form={form} onChange={set} />
                            <ModalField label="Dirección" field="DireccionTrabajo" cls="full" form={form} onChange={set} />
                        </div>
                    </div>
                  </div>

                  <div className="ci-modal-col">
                    <div>
                        <div className="ci-modal-section-title"><MapPin size={13} strokeWidth={2.4} />Ubicación y envío</div>
                        <div className="ci-field-grid">
                            <ModalSelect label="Departamento" field="DepartamentoID" options={catalogs.departamentos || []} form={form} onChange={set} />
                            <ModalSelect label="Localidad" field="LocalidadID" options={locs} form={form} onChange={set} format={capitalCase} />
                            <ModalSelect label="Agencia Envío" field="AgenciaID" options={catalogs.agencias || []} form={form} onChange={set} />
                            <ModalSelect label="Forma de Envío" field="FormaEnvioID" options={catalogs.formasEnvio || []} form={form} onChange={set} />
                        </div>
                    </div>
                    <div>
                        <div className="ci-modal-section-title"><Tags size={13} strokeWidth={2.4} />Clasificación</div>
                        <div className="ci-field-grid">
                            <ModalSelect label="Tipo de Cliente" field="TClIdTipoCliente" options={catalogs.tiposClientes || []} form={form} onChange={set} />
                            <ModalSelect label="Vendedor" field="VendedorID" options={catalogs.vendedores || []} idKey="Cedula" form={form} onChange={set} />
                            <div className="ci-field">
                                <label>Estado</label>
                                {/* Sin opción vacía: un cliente siempre tiene estado (al guardar,
                                    si viniera vacío se asume ACTIVO). */}
                                <CiSelect value={form.ESTADO} idKey="ID" nameKey="Nombre" allowEmpty={false}
                                    options={[{ ID: 'ACTIVO', Nombre: 'ACTIVO' }, { ID: 'INACTIVO', Nombre: 'INACTIVO' }, { ID: 'BLOQUEADO', Nombre: 'BLOQUEADO' }]}
                                    onChange={(v) => set('ESTADO')({ target: { value: v } })} />
                            </div>
                            <label className="ci-check" htmlFor="wa-chk">
                                <input type="checkbox" id="wa-chk" checked={!!form.WebActive} onChange={set('WebActive')} />
                                <span>Web activo</span>
                            </label>
                        </div>
                    </div>

                    {/* Vínculos con los otros sistemas: son IDs técnicos, no datos del
                        cliente — van al final y aparte para no mezclarlos con RUC o nombre.
                        SOLO LECTURA: los asigna la sincronización con Planilla/Macrosoft;
                        editarlos a mano rompe el vínculo (apunta a otro registro o a ninguno). */}
                    <div>
                        <div className="ci-modal-section-title"><Link2 size={13} strokeWidth={2.4} />Vínculos</div>
                        <div className="ci-field-grid ci-vinculos">
                            <div className="ci-field">
                                <label>IDReact <span className="ci-field-hint">Planilla</span></label>
                                <input value={form.IDReact ?? ''} readOnly placeholder="Sin vincular" title="Lo asigna la sincronización con Planilla" />
                            </div>
                            <div className="ci-field">
                                <label>CodReferencia <span className="ci-field-hint">Macrosoft</span></label>
                                <input value={form.CodReferencia ?? ''} readOnly placeholder="Sin vincular" title="Lo asigna la sincronización con Macrosoft" />
                            </div>
                        </div>
                    </div>
                  </div>
                </div>
                <div className="ci-modal-footer">
                    {!isNew && (
                        <button className="ci-btn-delete" onClick={handleDelete} disabled={deleting}>
                            <Trash2 size={14} strokeWidth={2.2} />
                            {deleting ? 'Eliminando…' : 'Eliminar cliente'}
                        </button>
                    )}
                    <button className="ci-btn-cancel" onClick={onClose}>Cancelar</button>
                    <button className="ci-btn-save" onClick={handleSave} disabled={saving}>
                        {!saving && <Check size={15} strokeWidth={2.6} />}
                        {saving ? 'Guardando…' : isNew ? 'Crear cliente' : 'Guardar cambios'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── TAB 1: Lista memoizada (NO se re-renderiza cuando el modal abre/cierra) ───
const LAZY_PAGE = 50;

const TabTablaList = React.memo(function TabTablaList({ catalogs, onEdit, clients, setClients, loading }) {
    const [search, setSearch] = useState('');
    const [filterEstado, setFilterEstado] = useState('');
    const [filterTipo, setFilterTipo] = useState('');
    const [filterVinculo, setFilterVinculo] = useState('');
    const [viewMode, setViewMode] = useState('kanban');
    const [sortCol, setSortCol] = useState('Nombre');
    const [sortDir, setSortDir] = useState('asc');
    const [filterDup, setFilterDup] = useState('');
    const [focusDup, setFocusDup] = useState(null);
    const [visibleCount, setVisibleCount] = useState(LAZY_PAGE);
    const sentinelRef = useRef(null);

    const dupSets = useMemo(() => {
        const fields = ['Email', 'TelefonoTrabajo', 'Nombre', 'IDCliente', 'IDReact'];
        const counts = {};
        fields.forEach(f => { counts[f] = {}; });
        clients.forEach(c => { fields.forEach(f => { const v = String(c[f] ?? '').trim().toLowerCase(); if (v) counts[f][v] = (counts[f][v] || 0) + 1; }); });
        const dup = {};
        clients.forEach(c => { fields.forEach(f => { const v = String(c[f] ?? '').trim().toLowerCase(); if (v && counts[f][v] > 1) { if (!dup[c.CodCliente]) dup[c.CodCliente] = new Set(); dup[c.CodCliente].add(f); } }); });
        return dup;
    }, [clients]);

    // Un solo punto por tarjeta: al pulsarlo trae TODOS los hermanos del cliente,
    // o sea los que comparten CUALQUIERA de sus campos duplicados (antes había un
    // punto por campo y cada uno filtraba solo por ese). El color de la barra
    // lateral sigue diciendo por cuál campo duplica.
    const handleDupTagClick = useCallback((e, c, fields) => {
        e.stopPropagation();
        // Pares campo→valor por los que este cliente duplica
        const criterios = [...fields]
            .map(f => ({ field: f, value: String(c[f] ?? '').trim().toLowerCase() }))
            .filter(x => x.value);
        if (!criterios.length) return;
        setFocusDup(prev =>
            (prev && prev.cod === c.CodCliente) ? null
                : { cod: c.CodCliente, criterios, label: String(c.IDCliente || '').trim() || `#${c.CodCliente}` }
        );
    }, []);

    // Borrado desde la tarjeta — misma verificación que el modal (escribir "eliminar")
    const handleCardDelete = useCallback(async (e, c) => {
        e.stopPropagation();
        const { value } = await Swal.fire({
            title: '¿Eliminar cliente?',
            // Ídem el borrado desde el modal: identificar por ID Cliente, no por Nombre.
            html: `<p style="margin-bottom:8px">Estás por eliminar <b>"${String(c.IDCliente || '').trim() || `#${c.CodCliente}`}"</b>.</p><p style="font-size:13px;color:#888">Esta acción no se puede deshacer. Escribí <b>eliminar</b> para confirmar.</p>`,
            input: 'text',
            inputPlaceholder: 'Escribí "eliminar"',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Eliminar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#dc2626',
            inputValidator: (val) => {
                if (val?.trim().toLowerCase() !== 'eliminar') return 'Debés escribir "eliminar" para confirmar';
            }
        });
        if (!value) return;
        try {
            await api.delete(`/clients/${c.CodCliente}`);
            toast.success('Cliente eliminado');
            setClients(prev => prev.filter(x => x.CodCliente !== c.CodCliente));
        } catch (err) { toast.error(err.response?.data?.error || 'No se pudo eliminar'); }
    }, [setClients]);


    const filtered = useMemo(() => {
        const t = search.toLowerCase();
        return clients.filter(c => {
            // Modo hermanitos: mostrar solo los que comparten el mismo valor en el mismo campo
            if (focusDup) {
                // Hermano = comparte AL MENOS uno de los campos duplicados del cliente elegido
                return focusDup.criterios.some(cr =>
                    String(c[cr.field] ?? '').trim().toLowerCase() === cr.value);
            }
            if (filterEstado && c.ESTADO !== filterEstado) return false;
            if (filterTipo && String(c.TClIdTipoCliente) !== filterTipo) return false;
            if (filterVinculo === 'no-react' && c.IDReact) return false;
            if (filterVinculo === 'no-macrosoft' && c.CodReferencia) return false;
            if (filterDup === 'all' && !dupSets[c.CodCliente]) return false;
            if (filterDup && filterDup !== 'all') {
                const dups = dupSets[c.CodCliente];
                if (!dups || !dups.has(filterDup)) return false;
            }
            if (!t) return true;
            return [c.Nombre, c.Email, c.TelefonoTrabajo, c.CioRuc, String(c.CodCliente), c.IDCliente].some(v => v?.toLowerCase().includes(t));
        });
    }, [clients, search, filterEstado, filterTipo, filterVinculo, filterDup, dupSets, focusDup]);

    const sorted = useMemo(() => [...filtered].sort((a, b) => {
        const cmp = String(a[sortCol] ?? '').localeCompare(String(b[sortCol] ?? ''), 'es', { numeric: true });
        return sortDir === 'asc' ? cmp : -cmp;
    }), [filtered, sortCol, sortDir]);

    const toggleSort = useCallback(col => { if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol(col); setSortDir('asc'); } }, [sortCol]);

    const dupCount = Object.keys(dupSets).length;

    // Reset visible count cuando cambian los filtros
    useEffect(() => { setVisibleCount(LAZY_PAGE); }, [sorted]);

    // IntersectionObserver: al ver el sentinel, cargar más
    useEffect(() => {
        let obs;
        const tid = setTimeout(() => {
            const el = sentinelRef.current;
            if (!el) return;
            obs = new IntersectionObserver(entries => {
                if (entries[0].isIntersecting) {
                    setVisibleCount(prev => Math.min(prev + LAZY_PAGE, sorted.length));
                }
            }, { threshold: 0.1 });
            obs.observe(el);
        }, 100);
        return () => { clearTimeout(tid); obs?.disconnect(); };
    }, [sorted.length, viewMode, visibleCount]);

    const visibleSorted = sorted.slice(0, visibleCount);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', gap: 0 }}>
            {/* Toolbar */}
            <div className="ci-toolbar">
                <span className="ci-count">
                    <strong>{sorted.length.toLocaleString('es-UY')}</strong> clientes
                </span>

                <div style={{ width: 1, height: 24, background: '#e2e8f0', flexShrink: 0 }} />

                {/* Filtros */}
                <input className="ci-search" type="text" placeholder="Buscar nombre, email, teléfono, RUC..." value={search} onChange={e => setSearch(e.target.value)} />
                <select className="ci-select" value={filterEstado} onChange={e => setFilterEstado(e.target.value)}>
                    <option value="">Estado: Todos</option>
                    {['ACTIVO', 'INACTIVO', 'BLOQUEADO'].map(s => <option key={s}>{s}</option>)}
                </select>
                <select className="ci-select" value={filterTipo} onChange={e => setFilterTipo(e.target.value)}>
                    <option value="">Tipo: Todos</option>
                    {(catalogs.tiposClientes || []).map(t => <option key={t.ID} value={t.ID}>{t.Nombre}</option>)}
                </select>
                <select className="ci-select" value={filterVinculo} onChange={e => setFilterVinculo(e.target.value)}>
                    <option value="">Vínculos: Todos</option>
                    <option value="no-react">⚠ Sin React</option>
                    <option value="no-macrosoft">⚠ Sin Macrosoft</option>
                </select>
                <select className="ci-select" value={filterDup} onChange={e => setFilterDup(e.target.value)}
                    style={filterDup ? { borderColor: '#dc2626', color: '#dc2626', fontWeight: 700 } : {}}>
                    <option value="">Duplicados: Todos</option>
                    <option value="all">⚠ Solo duplicados</option>
                    {Object.keys(DUP_COLORS).map(f => <option key={f} value={f}>Dup por {f}</option>)}
                </select>
                {/* Duplicados: chip con el conteo (antes era una banda amarilla fija bajo la
                    toolbar). Clic = filtrar solo duplicados; la leyenda de colores aparece al
                    pasar el mouse, que es cuando hace falta. */}
                {dupCount > 0 && (
                    <div className={`ci-dup-chip ${filterDup ? 'activo' : ''}`}
                        onClick={() => setFilterDup(filterDup ? '' : 'all')}
                        title={filterDup ? 'Quitar el filtro de duplicados' : 'Ver solo los duplicados'}>
                        <span className="ci-dup-dot" style={{ background: '#f59e0b' }} />
                        {dupCount} duplicados
                        <div className="ci-dup-pop" onClick={e => e.stopPropagation()}>
                            <div className="ci-dup-pop-title">Duplicado por</div>
                            {Object.entries(DUP_COLORS).map(([f, col]) => (
                                <div key={f} className="ci-dup-pop-row">
                                    <span className="ci-dup-dot" style={{ background: col }} />{f}
                                </div>
                            ))}
                            <div className="ci-dup-pop-title" style={{ marginTop: 3 }}>Clic en un punto de la tarjeta para ver sus hermanitos</div>
                        </div>
                    </div>
                )}
                <div className="ci-view-toggle">
                    <button className={`ci-view-btn ${viewMode === 'kanban' ? 'active' : ''}`} onClick={() => setViewMode('kanban')}>⊞ Tarjetas</button>
                    <button className={`ci-view-btn ${viewMode === 'table' ? 'active' : ''}`} onClick={() => setViewMode('table')}>☰ Tabla</button>
                </div>
                <button className="ci-btn-primary" onClick={() => onEdit({})}>+ Nuevo Cliente</button>
            </div>

            {/* Banner modo hermanitos: ahora el foco es UN CLIENTE y se listan todos los
                que comparten alguno de sus campos duplicados (antes era un campo suelto). */}
            {focusDup && (
                <div className="ci-hermanos">
                    <span className="ci-hermanos-lbl">Hermanitos de</span>
                    <span className="ci-hermanos-cli">{focusDup.label}</span>
                    <span className="ci-hermanos-por">
                        por
                        {focusDup.criterios.map(cr => (
                            <span key={cr.field} className="ci-hermanos-campo" style={{ background: `${DUP_COLORS[cr.field]}26`, color: DUP_COLORS[cr.field], borderColor: `${DUP_COLORS[cr.field]}66` }}>
                                {cr.field}
                            </span>
                        ))}
                    </span>
                    <span className="ci-hermanos-n">{sorted.length} clientes</span>
                    <button className="ci-hermanos-x" onClick={() => setFocusDup(null)}>
                        <X size={13} strokeWidth={2.6} /> Limpiar
                    </button>
                </div>
            )}

            {/* Content */}
            <div className="ci-content">
                {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><LottieSpinner size={64} /></div>}

                {/* KANBAN */}
                {!loading && viewMode === 'kanban' && (
                    <div className="ci-kanban">
                        {sorted.length === 0 && <p style={{ gridColumn: '1/-1', textAlign: 'center', padding: 40, color: '#aaa' }}>Sin resultados</p>}
                        {visibleSorted.map(c => {
                            const dups = dupSets[c.CodCliente];
                            const firstDupField = dups ? [...dups][0] : null;
                            return (
                                <div key={c.CodCliente} className={`ci-card ${dups ? 'dup-card' : ''}`}
                                    style={dups ? { '--dup-color': DUP_COLORS[firstDupField] } : {}}
                                    onClick={() => onEdit(c)}>
                                    {/* Cabecera: el ID DEL CLIENTE es el dato principal (es con lo
                                        que se lo busca y se lo nombra); el nombre va debajo. */}
                                    <div className="ci-card-header">
                                        <div className="ci-avatar-wrap">
                                            <div className="ci-avatar" style={{ background: getAvatarGradient(nombreVisible(c)) }}>
                                                {getInitials(nombreVisible(c))}
                                            </div>
                                        </div>
                                        <div className="ci-card-info">
                                            <div className="ci-card-id">
                                                {c.IDCliente ? String(c.IDCliente).trim() : `#${c.CodCliente}`}
                                            </div>
                                            <div className={`ci-card-name ${nombreVisible(c) ? '' : 'sin-nombre'}`}>
                                                {nombreVisible(c) || 'Sin nombre'}
                                            </div>
                                        </div>
                                        {/* UN punto por tarjeta: al pulsarlo trae todos los hermanos.
                                            Por qué campo duplica lo dice la barra lateral de color. */}
                                        {dups && (
                                            <span className="ci-dup-tag"
                                                onClick={e => handleDupTagClick(e, c, dups)}
                                                style={{ background: DUP_COLORS[firstDupField] }}
                                                title={`Duplicado por ${[...dups].join(', ')} — clic para ver sus hermanitos`} />
                                        )}
                                        {c.ESTADO && c.ESTADO !== 'ACTIVO' && <Badge color={statusColor(c.ESTADO)}>{c.ESTADO}</Badge>}
                                    </div>

                                    {/* Contacto: alto fijo, así todas las tarjetas miden igual
                                        aunque al cliente le falte el teléfono o el mail. */}
                                    <div className="ci-card-body">
                                        <div className={`ci-card-row ${c.TelefonoTrabajo ? '' : 'vacia'}`}>
                                            <Phone size={12} strokeWidth={2.2} className="ci-card-row-icon" />
                                            <span>{c.TelefonoTrabajo || '—'}</span>
                                        </div>
                                        <div className={`ci-card-row ${c.Email ? '' : 'vacia'}`}>
                                            <Mail size={12} strokeWidth={2.2} className="ci-card-row-icon" />
                                            <span>{c.Email || '—'}</span>
                                        </div>
                                    </div>

                                    {/* Tipo y vendedor: datos de contexto, en una sola línea chica */}
                                    {(c.TipoClienteNombre || c.VendedorNombre) && (
                                        <div className="ci-card-meta">
                                            {c.TipoClienteNombre && <span>{c.TipoClienteNombre}</span>}
                                            {c.TipoClienteNombre && c.VendedorNombre && <span className="sep">·</span>}
                                            {c.VendedorNombre && <span>{c.VendedorNombre}</span>}
                                        </div>
                                    )}

                                    {/* Sin footer: los chips PL/MS y el #CodCliente son datos de
                                        sistema, no del cliente — se ven en el modal al abrirlo.
                                        Eliminar pasa a la esquina, visible al pasar el mouse. */}
                                    <button className="ci-card-del" onClick={e => handleCardDelete(e, c)} title="Eliminar cliente">
                                        <Trash2 size={13} strokeWidth={2.2} />
                                    </button>
                                </div>
                            );
                        })}
                        {/* Sentinel kanban: dentro del scroll de ci-content */}
                        {visibleCount < sorted.length && (
                            <div ref={sentinelRef} style={{ gridColumn: '1/-1', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0', color: '#888', fontSize: 12, fontWeight: 600 }}>
                                <LottieSpinner size={40} />
                                Cargando más clientes…
                            </div>
                        )}
                    </div>
                )}

                {/* TABLE */}
                {!loading && viewMode === 'table' && (
                    <div className="ci-table-wrap">
                        <table className="ci-table">
                            <thead>
                                <tr>
                                    {[['CodCliente', 'Cód', 'w-16'], ['Nombre', 'Nombre', ''], ['IDCliente', 'ID Cliente', ''], ['CioRuc', 'RUC', ''], ['TelefonoTrabajo', 'Teléfono', ''], ['Email', 'Email', ''], ['TipoClienteNombre', 'Tipo', ''], ['VendedorNombre', 'Vendedor', ''], ['ESTADO', 'Estado', '']].map(([col, lbl]) => (
                                        <th key={col} onClick={() => toggleSort(col)}>{lbl}{sortCol === col ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</th>
                                    ))}
                                    <th>Vínculos</th><th />
                                </tr>
                            </thead>
                            <tbody>
                                {sorted.length === 0 && <tr><td colSpan={11} style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>Sin resultados</td></tr>}
                                {visibleSorted.map((c, i) => {
                                    const dups = dupSets[c.CodCliente];
                                    const firstDup = dups ? [...dups][0] : null;
                                    return (
                                        <tr key={c.CodCliente} onClick={() => onEdit(c)}
                                            className={dups ? 'dup-row' : ''} style={dups ? { '--dup-color': DUP_COLORS[firstDup] } : { background: i % 2 ? '#fafafe' : '#fff' }}>
                                            <td style={{ color: '#999', fontFamily: 'monospace', fontSize: 11 }}>{c.CodCliente}</td>
                                            <td>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    <Avatar name={c.Nombre} size={28} />
                                                    <div>
                                                        <div style={{ fontWeight: 600, fontSize: 13 }}>{c.Nombre}</div>
                                                        {dups && (
                                                            <div className="ci-dup-tags">
                                                                {[...dups].map(f => (
                                                                    <span key={f} className="ci-dup-tag"
                                                                        onClick={e => handleDupTagClick(e, c, f)}
                                                                        style={{ background: `${DUP_COLORS[f]}22`, color: DUP_COLORS[f], cursor: 'pointer', border: `1px solid ${DUP_COLORS[f]}55` }}
                                                                        title={`Clic para ver todos con el mismo ${f}`}>
                                                                        🔍 {f}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                            <td style={{ fontSize: 12, color: '#666' }}>{c.IDCliente || '—'}</td>
                                            <td style={{ fontSize: 12, color: '#666' }}>{c.CioRuc || '—'}</td>
                                            <td style={{ fontSize: 12, color: '#666' }}>{c.TelefonoTrabajo || '—'}</td>
                                            <td style={{ fontSize: 12, color: '#666', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.Email || '—'}</td>
                                            <td style={{ fontSize: 12 }}>{c.TipoClienteNombre || '—'}</td>
                                            <td style={{ fontSize: 12 }}>{c.VendedorNombre || '—'}</td>
                                            <td>{c.ESTADO ? <Badge color={statusColor(c.ESTADO)}>{c.ESTADO}</Badge> : '—'}</td>
                                            <td><div style={{ display: 'flex', gap: 4 }}><span style={{ fontSize: 13, color: c.IDReact ? '#7c3aed' : '#e2e8f0' }} title="React">⚛</span><span style={{ fontSize: 13, color: c.CodReferencia ? '#059669' : '#e2e8f0' }} title="Macrosoft">🖧</span></div></td>
                                            <td onClick={e => e.stopPropagation()}>
                                                <button onClick={async e => {
                                                    e.stopPropagation();
                                                    if (!confirm(`¿Eliminar "${c.Nombre}"?`)) return;
                                                    try {
                                                        await api.delete(`/clients/${c.CodCliente}`);
                                                        toast.success('Eliminado');
                                                        setClients(prev => prev.filter(x => x.CodCliente !== c.CodCliente));
                                                    } catch (err) { toast.error(err.response?.data?.error || 'No se pudo eliminar'); }
                                                }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#fca5a5', fontSize: 14, padding: 4 }} title="Eliminar">🗑</button>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {visibleCount < sorted.length && (
                                    <tr ref={sentinelRef}>
                                        <td colSpan={11} style={{ padding: '10px 0' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: '#888', fontSize: 12, fontWeight: 600 }}>
                                                <LottieSpinner size={36} />
                                                Cargando más clientes…
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}

            </div>

        </div>
    );
});

// ─── TAB 1: WRAPPER liviano (solo maneja editing + clientes) ──────────────────
// Al cambiar editing solo este wrapper re-renderiza.
// TabTablaList (React.memo) no se toca → CERO parpadeo de cards.
function TabTabla({ catalogs }) {
    const [clients, setClients] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(null);

    const load = useCallback(async (silent = false) => {
        if (!silent) setLoading(true);
        try { const r = await api.get('/clients'); setClients(r.data || []); }
        catch { toast.error('Error cargando clientes'); }
        finally { if (!silent) setLoading(false); }
    }, []);

    useEffect(() => { load(false); }, [load]);

    const handleSaved = useCallback((savedClient) => {
        if (!savedClient) { load(true); return; }
        setClients(prev => {
            const idx = prev.findIndex(c => c.CodCliente === savedClient.CodCliente);
            if (idx >= 0) { const next = [...prev]; next[idx] = savedClient; return next; }
            return [savedClient, ...prev];
        });
    }, [load]);

    const handleDeleted = useCallback((codCliente) => {
        setClients(prev => prev.filter(c => c.CodCliente !== codCliente));
    }, []);

    const onEdit = useCallback((c) => setEditing(c), []);

    return (
        <>
            <TabTablaList
                catalogs={catalogs}
                onEdit={onEdit}
                clients={clients}
                setClients={setClients}
                loading={loading}
            />
            {editing !== null && (
                <ClientModal
                    client={Object.keys(editing).length === 0 ? null : editing}
                    catalogs={catalogs}
                    onClose={() => setEditing(null)}
                    onSaved={handleSaved}
                    onDeleted={handleDeleted}
                />
            )}
        </>
    );
}

// ─── TAB 2: ÁRBOL ─────────────────────────────────────────────────────────────
function TabArbol({ catalogs }) {
    const [groupBy, setGroupBy] = useState('vendedor');
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState(new Set());
    const [search, setSearch] = useState('');
    const [quickEdit, setQuickEdit] = useState(null);
    const [quickVal, setQuickVal] = useState('');
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get(`/clients/tree?group=${groupBy}`);
            setGroups(r.data.groups || []);
            if (r.data.groups?.length) setExpanded(new Set([r.data.groups[0].label]));
        } catch { toast.error('Error cargando árbol'); }
        finally { setLoading(false); }
    }, [groupBy]);

    useEffect(() => { load(); }, [load]);

    const filteredGroups = useMemo(() => {
        if (!search) return groups;
        const t = search.toLowerCase();
        return groups.map(g => ({ ...g, clients: g.clients.filter(c => [c.Nombre, c.Email, c.TelefonoTrabajo].some(v => v?.toLowerCase().includes(t))) })).filter(g => g.clients.length > 0);
    }, [groups, search]);

    const toggle = label => setExpanded(p => { const n = new Set(p); n.has(label) ? n.delete(label) : n.add(label); return n; });

    const opts = groupBy === 'vendedor' ? (catalogs.vendedores || []).map(v => ({ id: v.Cedula, label: v.Nombre })) : (catalogs.tiposClientes || []).map(t => ({ id: t.ID, label: t.Nombre }));

    const saveQuick = async () => {
        setSaving(true);
        try {
            await api.patch(`/clients/${quickEdit.CodCliente}/quick`, groupBy === 'vendedor' ? { VendedorID: quickVal } : { TClIdTipoCliente: quickVal });
            toast.success('Actualizado ✓'); setQuickEdit(null); load();
        } catch (e) { toast.error(e.response?.data?.error || 'Error'); }
        finally { setSaving(false); }
    };

    const totalClients = groups.reduce((s, g) => s + g.clients.length, 0);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', gap: 0 }}>
            <div className="ci-toolbar">
                <div className="ci-view-toggle">
                    {[['vendedor', '👤 Por Vendedor'], ['tipo', '🏷 Por Tipo']].map(([v, l]) => (
                        <button key={v} className={`ci-view-btn ${groupBy === v ? 'active' : ''}`} onClick={() => setGroupBy(v)}>{l}</button>
                    ))}
                </div>
                <input className="ci-search" type="text" placeholder="Buscar cliente..." value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 280 }} />
                <button onClick={load} style={{ background: 'none', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '7px 12px', cursor: 'pointer', color: '#666', fontSize: 13 }} title="Recargar">↺ Recargar</button>
            </div>
            <div className="ci-content">
                <div className="ci-tree">
                    {loading && <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><LottieSpinner size={64} /></div>}
                    {!loading && filteredGroups.map(g => (
                        <div key={g.label} className="ci-tree-group">
                            <div className={`ci-tree-header ${expanded.has(g.label) ? 'open' : ''}`} onClick={() => toggle(g.label)}>
                                <div className="ci-tree-label">
                                    <span className={`ci-tree-arrow ${expanded.has(g.label) ? 'open' : ''}`}>▶</span>
                                    <Avatar name={g.label} size={30} />
                                    {g.label}
                                </div>
                                <span className="ci-tree-count">{g.clients.length} clientes</span>
                            </div>
                            {expanded.has(g.label) && g.clients.map(c => (
                                <div key={c.CodCliente} className="ci-tree-client">
                                    <div className="ci-tree-client-info">
                                        <Avatar name={c.Nombre} size={32} />
                                        <div>
                                            <div style={{ fontWeight: 600, fontSize: 13, color: '#1e1b4b' }}>{c.Nombre}</div>
                                            <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 8, marginTop: 2 }}>
                                                {c.TelefonoTrabajo && <span>📞 {c.TelefonoTrabajo}</span>}
                                                {c.Email && <span>✉ {c.Email}</span>}
                                                {c.ESTADO && <Badge color={statusColor(c.ESTADO)}>{c.ESTADO}</Badge>}
                                            </div>
                                        </div>
                                    </div>
                                    <button className="ci-tree-edit-btn" onClick={() => { setQuickEdit(c); setQuickVal(groupBy === 'vendedor' ? (c.VendedorID || '') : (c.TClIdTipoCliente || '')); }}>
                                        ✏ Cambiar {groupBy === 'vendedor' ? 'Vendedor' : 'Tipo'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {quickEdit && (
                <div className="ci-overlay" onClick={() => setQuickEdit(null)}>
                    <div style={{ background: '#fff', borderRadius: 16, padding: 28, width: 340, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontWeight: 800, fontSize: 16, color: '#1e1b4b', marginBottom: 4 }}>Cambiar {groupBy === 'vendedor' ? 'Vendedor' : 'Tipo'}</div>
                        <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>{quickEdit.Nombre}</div>
                        <select value={quickVal} onChange={e => setQuickVal(e.target.value)} style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: 13, marginBottom: 16, outline: 'none', fontFamily: 'Inter,sans-serif' }}>
                            <option value="">— Sin asignar —</option>
                            {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                        </select>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button className="ci-btn-cancel" onClick={() => setQuickEdit(null)}>Cancelar</button>
                            <button className="ci-btn-save" onClick={saveQuick} disabled={saving}>{saving ? '…' : 'Guardar'}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── TAB 3: PLANILLA ──────────────────────────────────────────────────────────
function TabPlanilla() {
    const [auth, setAuth] = useState(null);   // null=checking, true, false
    const [sheetRows, setSheetRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [q, setQ] = useState('');

    const loadAll = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/clients/sheets/all');
            setSheetRows(r.data || []);
        } catch (e) {
            const msg = e.response?.data?.error || 'Error cargando planilla';
            if (e.response?.status === 401) setAuth(false);
            else toast.error(msg);
        } finally { setLoading(false); }
    }, []);

    useEffect(() => {
        api.get('/google/status')
            .then(r => { setAuth(r.data.authorized); if (r.data.authorized) loadAll(); })
            .catch(() => setAuth(false));
    }, [loadAll]);

    const doAuth = async () => {
        const r = await api.get('/google/auth');
        window.open(r.data.authUrl, '_blank', 'width=600,height=700');
        toast.info('Autorizá en la ventana nueva, luego presioná ↺ Recargar.');
    };

    const filtered = useMemo(() => {
        if (!q) return sheetRows;
        const t = q.toLowerCase();
        return sheetRows.filter(r =>
            [r.IDCliente, r.Nombre, r.Telefono, r.Email, r.CioRuc, r.IDReact, r.Departamento, r.Localidad]
                .some(v => String(v || '').toLowerCase().includes(t))
        );
    }, [sheetRows, q]);

    // Stats
    const conEmail = sheetRows.filter(r => r.Email).length;
    const conRuc = sheetRows.filter(r => r.CioRuc).length;
    const conIDReact = sheetRows.filter(r => r.IDReact).length;

    if (auth === null) return <div style={{ textAlign: 'center', padding: 60, color: '#888' }}>Verificando conexión Google…</div>;

    if (!auth) return (
        <div className="ci-auth-prompt">
            <div style={{ fontSize: 56 }}>📊</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#1e1b4b' }}>Google Sheets no autorizado</div>
            <div style={{ fontSize: 13, color: '#888', maxWidth: 340, textAlign: 'center' }}>
                Necesitás autorizar el acceso para poder leer la planilla de clientes.
            </div>
            <button className="ci-btn-primary" style={{ marginLeft: 0 }} onClick={doAuth}>
                🔐 Autorizar Google Sheets
            </button>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Stats */}
            <div className="ci-stats">
                <div className="ci-stat-card">
                    <span className="ci-stat-num">{sheetRows.length}</span>
                    <span className="ci-stat-label">📋 Total filas</span>
                </div>
                <div className="ci-stat-card" style={{ borderColor: '#bfdbfe', background: '#eff6ff' }}>
                    <span className="ci-stat-num" style={{ color: '#1d4ed8' }}>{conIDReact}</span>
                    <span className="ci-stat-label">🔗 Con IDReact</span>
                </div>
                <div className="ci-stat-card" style={{ borderColor: '#bbf7d0', background: '#f0fdf4' }}>
                    <span className="ci-stat-num" style={{ color: '#15803d' }}>{conEmail}</span>
                    <span className="ci-stat-label">📧 Con Email</span>
                </div>
                <div className="ci-stat-card" style={{ borderColor: '#fde68a', background: '#fefce8' }}>
                    <span className="ci-stat-num" style={{ color: '#b45309' }}>{conRuc}</span>
                    <span className="ci-stat-label">🪪 Con RUC/CI</span>
                </div>
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#fff', borderRadius: 12, padding: 14, border: '1.5px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
                <input className="ci-search" value={q} onChange={e => setQ(e.target.value)}
                    placeholder="Buscar nombre, teléfono, email, RUC, IDReact…"
                    style={{ flex: 1, maxWidth: 'none' }} />
                <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap', fontWeight: 600 }}>
                    {filtered.length} / {sheetRows.length} filas
                </span>
                {!auth && (
                    <button onClick={doAuth} style={{ background: '#fef9c3', border: '1.5px solid #fde68a', borderRadius: 8, padding: '7px 14px', fontWeight: 700, fontSize: 12, color: '#b45309', cursor: 'pointer' }}>
                        🔐 Re-autorizar
                    </button>
                )}
                <button onClick={loadAll} disabled={loading}
                    style={{ background: '#f0eeff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, fontSize: 13, color: '#4f46e5', cursor: 'pointer', opacity: loading ? .6 : 1 }}>
                    {loading ? '…' : '↺ Recargar'}
                </button>
            </div>

            {loading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><LottieSpinner size={64} /></div>
            ) : (
                <div style={{ background: '#fff', borderRadius: 12, border: '1.5px solid #e2e8f0', overflow: 'auto', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
                    <table className="ci-table">
                        <thead><tr>
                            <th>IDReact</th>
                            <th>ID Cliente</th>
                            <th>Nombre</th>
                            <th>Teléfono</th>
                            <th>Email</th>
                            <th>RUC/CI</th>
                            <th>Departamento</th>
                            <th>Localidad</th>
                            <th>Forma Envío</th>
                        </tr></thead>
                        <tbody>
                            {filtered.length === 0 && (
                                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 30, color: '#aaa' }}>
                                    {sheetRows.length === 0 ? 'La planilla está vacía o no se cargaron los datos.' : 'Sin resultados para esa búsqueda.'}
                                </td></tr>
                            )}
                            {filtered.map((r, i) => (
                                <tr key={i} style={{ background: i % 2 ? '#fafafe' : '#fff' }}>
                                    <td>
                                        <span style={{ fontSize: 11, fontFamily: 'monospace', background: '#ede9fe', color: '#7c3aed', padding: '2px 7px', borderRadius: 4, fontWeight: 700 }}>
                                            {r.IDReact || '—'}
                                        </span>
                                    </td>
                                    <td style={{ fontSize: 12, color: '#666' }}>{r.IDCliente || '—'}</td>
                                    <td style={{ fontWeight: 600, fontSize: 13 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 28, height: 28, borderRadius: 7, background: AVATAR_COLORS[(r.Nombre?.charCodeAt(0) || 0) % AVATAR_COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                                                {r.Nombre?.[0]?.toUpperCase() || '?'}
                                            </div>
                                            {r.Nombre || '—'}
                                        </div>
                                    </td>
                                    <td style={{ fontSize: 12, color: '#666' }}>{r.Telefono || '—'}</td>
                                    <td style={{ fontSize: 12, color: '#666', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {r.Email ? <a href={`mailto:${r.Email}`} style={{ color: '#4f46e5', textDecoration: 'none' }}>{r.Email}</a> : '—'}
                                    </td>
                                    <td style={{ fontSize: 12, color: '#666' }}>{r.CioRuc || '—'}</td>
                                    <td style={{ fontSize: 12, color: '#666' }}>{r.Departamento || '—'}</td>
                                    <td style={{ fontSize: 12, color: '#666' }}>{r.Localidad || '—'}</td>
                                    <td style={{ fontSize: 12, color: '#666' }}>
                                        {r.FormaEnvio
                                            ? <span style={{ background: '#f0f9ff', color: '#0369a1', padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 600 }}>{r.FormaEnvio}</span>
                                            : '—'}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─── TAB 4: MACROSOFT ─────────────────────────────────────────────────────────
function TabMacrosoft({ msClients = [], loading = false, onReload }) {
    const [q, setQ] = useState('');
    const [moneda, setMoneda] = useState('all');   // 'all' | 'uy' | 'usd'
    const [vinculo, setVinculo] = useState('all');   // 'all' | 'si' | 'no'

    const filtered = useMemo(() => {
        let list = msClients;
        // Filtro moneda
        if (moneda === 'uy') list = list.filter(c => c.Moneda === 1);
        if (moneda === 'usd') list = list.filter(c => c.Moneda === 2);
        // Filtro vínculo
        if (vinculo === 'si') list = list.filter(c => c.EsVinculado);
        if (vinculo === 'no') list = list.filter(c => !c.EsVinculado);
        // Filtro texto
        if (q) {
            const t = q.toLowerCase();
            list = list.filter(c =>
                [c.Nombre, c.NombreFantasia, c.CioRuc, c.TelefonoTrabajo, c.Email, String(c.CodCliente || ''), String(c.CodClienteLocal || '')]
                    .some(v => String(v || '').toLowerCase().includes(t))
            );
        }
        return list;
    }, [msClients, q, moneda, vinculo]);

    // Campos de la API real
    const gn = c => c.Nombre || c.NombreFantasia || '—';
    const gr = c => c.CioRuc || '—';
    const gt = c => c.TelefonoTrabajo || '—';
    const gc = c => String(c.CodCliente || '');


    // Helper para botones pill
    const Pill = ({ active, onClick, children, color = '#4f46e5', bg = '#eef0ff', activeBg, activeColor }) => (
        <button onClick={onClick} style={{
            padding: '5px 13px', borderRadius: 20, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
            background: active ? (activeBg || color) : bg,
            color: active ? (activeColor || '#fff') : color,
            transition: 'all .15s', boxShadow: active ? `0 2px 6px ${color}55` : 'none',
        }}>{children}</button>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Toolbar: buscador + filtros pill */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', background: '#fff', borderRadius: 12, padding: '12px 14px', border: '1.5px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
                <input className="ci-search" value={q} onChange={e => setQ(e.target.value)}
                    placeholder="Buscar nombre, fantasía, RUC, teléfono…"
                    style={{ flex: 1, minWidth: 200, maxWidth: 'none' }} />

                {/* Separador */}
                <div style={{ width: 1, height: 22, background: '#e2e8f0', margin: '0 4px' }} />

                {/* Filtro moneda */}
                <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: .5 }}>Moneda:</span>
                <Pill active={moneda === 'all'} onClick={() => setMoneda('all')} color='#6366f1' bg='#f5f3ff'>Todos</Pill>
                <Pill active={moneda === 'uy'} onClick={() => setMoneda('uy')} color='#1d4ed8' bg='#eff6ff' activeBg='#1d4ed8'>🇺🇾 UY</Pill>
                <Pill active={moneda === 'usd'} onClick={() => setMoneda('usd')} color='#15803d' bg='#f0fdf4' activeBg='#15803d'>💵 USD</Pill>

                {/* Separador */}
                <div style={{ width: 1, height: 22, background: '#e2e8f0', margin: '0 4px' }} />

                {/* Filtro vínculo */}
                <span style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: .5 }}>Vínculo:</span>
                <Pill active={vinculo === 'all'} onClick={() => setVinculo('all')} color='#6366f1' bg='#f5f3ff'>Todos</Pill>
                <Pill active={vinculo === 'si'} onClick={() => setVinculo('si')} color='#15803d' bg='#f0fdf4' activeBg='#15803d'>✓ Vinculados</Pill>
                <Pill active={vinculo === 'no'} onClick={() => setVinculo('no')} color='#dc2626' bg='#fff5f5' activeBg='#dc2626'>✗ Sin vínculo</Pill>

                <span style={{ fontSize: 12, color: '#888', whiteSpace: 'nowrap', fontWeight: 600 }}>{filtered.length} / {msClients.length}</span>
            </div>
            {loading ? <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}><LottieSpinner size={64} /></div> : (
                <div style={{ background: '#fff', borderRadius: 12, border: '1.5px solid #e2e8f0', overflow: 'auto', boxShadow: '0 1px 4px rgba(0,0,0,.05)' }}>
                    <table className="ci-table">
                        <thead><tr><th>Cód MS</th><th>CodRef</th><th>Nombre</th><th style={{ color: '#9ca3af' }}>Fantasía</th><th>RUC/CI</th><th>Teléfono</th><th>Email</th><th>Dirección</th></tr></thead>
                        <tbody>
                            {filtered.length === 0 && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 30, color: '#aaa' }}>Sin resultados</td></tr>}
                            {filtered.map((c, i) => (
                                <tr key={i} style={{ background: i % 2 ? '#fafafe' : '#fff' }}>
                                    <td><span style={{ fontSize: 11, fontFamily: 'monospace', color: '#999' }}>{gc(c) || '—'}</span></td>
                                    <td>
                                        {c.EsVinculado
                                            ? <span style={{ fontSize: 11, background: '#dcfce7', color: '#15803d', padding: '2px 8px', borderRadius: 4, fontWeight: 700 }}>✓ local</span>
                                            : <span style={{ fontSize: 11, color: '#d1d5db', fontStyle: 'italic' }}>sin vínculo</span>}
                                    </td>
                                    <td style={{ fontWeight: 600, fontSize: 13 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                            <div style={{ width: 28, height: 28, borderRadius: 7, background: AVATAR_COLORS[(gn(c).charCodeAt(0) || 0) % AVATAR_COLORS.length], display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                                                {gn(c)[0]?.toUpperCase() || '?'}
                                            </div>
                                            {gn(c)}
                                        </div>
                                    </td>
                                    <td style={{ fontSize: 11, color: '#9ca3af', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.NombreFantasia || ''}>
                                        {c.NombreFantasia || <span style={{ color: '#e5e7eb' }}>—</span>}
                                    </td>
                                    <td style={{ fontSize: 12, color: '#666' }}>{gr(c)}</td>
                                    <td style={{ fontSize: 12, color: '#666' }}>{gt(c)}</td>
                                    <td style={{ fontSize: 12, color: '#666', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.Email || '—'}</td>
                                    <td style={{ fontSize: 12, color: '#666', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.DireccionTrabajo || c.Direccion || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─── PRINCIPAL ────────────────────────────────────────────────────────────────
export default function ClientsIntegration() {
    const [tab, setTab] = useState('tabla');
    const [catalogs, setCatalogs] = useState({ localidades: [], departamentos: [], agencias: [], formasEnvio: [], tiposClientes: [], vendedores: [] });

    useEffect(() => {
        api.get('/clients/catalogs')
            .then(r => setCatalogs(r.data || {}))
            .catch(() => toast.error('Error cargando catálogos'));
    }, []);

    const TABS = [
        { id: 'tabla', icon: '📋', label: 'Clientes' },
        { id: 'arbol', icon: '👤', label: 'Vendedores/Tipo' },
    ];

    return (
        <div className="ci-root">
            <div className="ci-header">
                <div className="ci-header-top">
                    <span style={{ fontSize: 24 }}>👥</span>
                    <span className="ci-title">Gestión de Clientes</span>
                </div>
                <div className="ci-tabs">
                    {TABS.map(t => (
                        <button key={t.id} className={`ci-tab ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
                            {t.icon} {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {tab === 'tabla' && <TabTabla catalogs={catalogs} />}
                {tab === 'arbol' && <TabArbol catalogs={catalogs} />}
            </div>
        </div>
    );
}
