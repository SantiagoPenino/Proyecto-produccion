import React, { useState, useEffect, useCallback, Children, isValidElement, Fragment } from 'react';
import { Users, UserPlus, UserX, Search, Loader2, ShieldCheck, Building2, Mail, Pencil, Trash2, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import { usersService, rolesService, areasService } from '../../services/api';
import Selector from '../ui/Selector';
import useConfirmar from '../ui/useConfirmar';

const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ENTRADA = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 outline-none transition-colors hover:border-zinc-300 focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block mb-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-400';

// Valores de los <option> (también los que vienen de un .map).
const valoresDe = (hijos) => {
    const salida = [];
    Children.forEach(hijos, (h) => {
        if (!isValidElement(h)) return;
        if (h.type === Fragment) { salida.push(...valoresDe(h.props.children)); return; }
        if (h.type === 'option') salida.push(String(h.props.value ?? ''));
    });
    return salida;
};

// <select> del formulario con el Selector propio. El valor viaja en un input con el mismo name, así handleSave lo
// sigue leyendo con FormData. Como el nativo, si el valor inicial no está entre las opciones vale la primera. Con
// `required` el input no es hidden (esos no se validan): queda invisible debajo del botón para que el navegador
// frene el envío sin rol, igual que con el <select required> de antes.
const SelectorCampo = ({ name, defaultValue, required = false, children, ...props }) => {
    const [valor, setValor] = useState(String(defaultValue ?? ''));
    const valores = valoresDe(children);
    const efectivo = valores.includes(valor) ? valor : (valores[0] ?? '');
    return (
        <div className="relative">
            <Selector value={efectivo} onChange={(e) => setValor(e.target.value)} className="w-full" {...props}>{children}</Selector>
            {required
                ? <input name={name} value={efectivo} required onChange={() => {}} tabIndex={-1} aria-hidden="true"
                    className="absolute left-3 bottom-0 w-px h-px opacity-0 pointer-events-none" />
                : <input type="hidden" name={name} value={efectivo} />}
        </div>
    );
};

// Estética nueva (22/10/2026): fondo claro, tarjetas blancas con borde ordenadas (nombre y estado arriba, datos en un
// recuadro, acciones al pie), íconos de Lucide en brand-cyan sin fondo, Selector propio en el filtro y en el
// formulario, y confirmación/avisos del sistema (antes window.confirm y alert).
const UsersPage = () => {
    const [usuarios, setUsuarios] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editando, setEditando] = useState(null);
    const [nuevoUsuario, setNuevoUsuario] = useState(null);

    const [areas, setAreas] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterArea, setFilterArea] = useState('');
    const [confirmar, ventanaConfirmar] = useConfirmar();

    const filteredUsuarios = usuarios.filter(u => {
        const matchesSearch = u.Nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
            u.Usuario.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (u.Email && u.Email.toLowerCase().includes(searchTerm.toLowerCase()));

        let matchesArea = true;
        if (filterArea) {
            const selectedArea = areas.find(a => String(a.AreaID) === String(filterArea));
            if (selectedArea) {
                const userArea = u.AreaUsuario ? String(u.AreaUsuario).trim() : '';
                matchesArea = userArea === String(selectedArea.AreaID) ||
                    userArea === selectedArea.Nombre ||
                    (selectedArea.RenderKey && userArea === selectedArea.RenderKey);
            } else {
                matchesArea = u.AreaUsuario === filterArea;
            }
        }

        return matchesSearch && matchesArea;
    });

    const cargarDatos = useCallback(async () => {
        setLoading(true);
        try {
            const [dataUsers, dataRoles, dataAreas] = await Promise.all([
                usersService.getAll(),
                rolesService.getAll(),
                areasService.getAll()
            ]);
            setUsuarios(Array.isArray(dataUsers) ? dataUsers : []);
            setRoles(Array.isArray(dataRoles) ? dataRoles : []);
            setAreas(Array.isArray(dataAreas) ? dataAreas : []);
        } catch (error) {
            console.error("Error cargando usuarios", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        cargarDatos();
    }, [cargarDatos]);

    const handleSave = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const itemData = {
            Nombre: formData.get('Nombre'),
            Usuario: formData.get('Usuario'),
            Email: formData.get('Email'),
            IdRol: parseInt(formData.get('IdRol')),
            AreaUsuario: formData.get('AreaUsuario'),
            Activo: formData.get('Activo') === 'on'
        };

        const pass = formData.get('Contrasena');
        if (pass) itemData.Contrasena = pass;

        try {
            if (editando) {
                await usersService.update(editando.IdUsuario, itemData);
            } else {
                if (!itemData.Contrasena) {
                    toast.error("La contraseña es obligatoria para nuevos usuarios");
                    return;
                }
                await usersService.create(itemData);
            }
            setEditando(null);
            setNuevoUsuario(null);
            cargarDatos();
        } catch (error) {
            toast.error("Error al guardar: " + (error.response?.data?.error || error.message || 'Error desconocido'));
        }
    };

    const handleDelete = async (id) => {
        if (await confirmar({ titulo: '¿Deseas eliminar este usuario?', confirmar: 'Eliminar', peligro: true })) {
            try {
                await usersService.delete(id);
                cargarDatos();
            } catch (error) {
                toast.error("Error al eliminar: " + (error.response?.data?.error || error.message || 'Error desconocido'));
            }
        }
    };

    const cerrarModal = () => { setEditando(null); setNuevoUsuario(null); };

    const UserCard = ({ item }) => {
        const rolNombre = roles.find(r => r.IdRol === item.IdRol)?.NombreRol || 'Rol Desconocido';

        return (
            <div className={`${CARD} p-4 flex flex-col gap-3 hover:border-zinc-300 transition-colors`}>
                {/* Nombre y estado */}
                <div className="flex items-start gap-3">
                    <span className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-sm uppercase shrink-0 ${item.Activo ? 'bg-zinc-100 text-zinc-600' : 'bg-zinc-50 text-zinc-300'}`}>
                        {(item.Nombre || item.Usuario || '?').trim().slice(0, 2)}
                    </span>
                    <div className="min-w-0 flex-1">
                        <h3 className={`text-sm font-black leading-tight truncate ${item.Activo ? 'text-zinc-900' : 'text-zinc-400'}`} title={item.Nombre}>{item.Nombre}</h3>
                        <p className="text-xs text-zinc-400 font-mono mt-0.5 truncate">@{item.Usuario}</p>
                    </div>
                    {!item.Activo && (
                        <span className="shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full border bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20">Inactivo</span>
                    )}
                </div>

                {/* Datos */}
                <div className="rounded-xl bg-zinc-50 px-3 py-2.5 space-y-1.5 text-xs">
                    {item.AreaUsuario && (
                        <div className="flex items-center gap-2 min-w-0">
                            <Building2 size={14} className="text-brand-cyan shrink-0" aria-hidden="true" />
                            <span className="text-zinc-600 truncate">{item.AreaUsuario}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 min-w-0">
                        <Mail size={14} className="text-brand-cyan shrink-0" aria-hidden="true" />
                        <span className={`truncate ${item.Email ? 'text-zinc-600' : 'text-zinc-400 italic'}`} title={item.Email || ''}>{item.Email || 'Sin email'}</span>
                    </div>
                </div>

                {/* Pie: el rol y las acciones */}
                <div className="flex items-center justify-between gap-2 mt-auto">
                    <span className="inline-flex items-center gap-1.5 min-w-0 text-xs font-bold text-zinc-700" title="Rol">
                        <ShieldCheck size={14} className="text-brand-cyan shrink-0" aria-hidden="true" />
                        <span className="truncate">{rolNombre}</span>
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            type="button"
                            onClick={() => setEditando(item)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors"
                            title="Editar"
                        >
                            <Pencil size={13} /> Editar
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDelete(item.IdUsuario)}
                            className="w-[30px] h-[30px] inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-400 hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5 transition-colors"
                            title="Eliminar"
                            aria-label="Eliminar"
                        >
                            <Trash2 size={13} />
                        </button>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700">

            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
                <Users size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Gestión de Usuarios</h1>
                    <p className="text-sm text-zinc-500 mt-1">Administración de acceso y perfiles</p>
                </div>
                <button
                    type="button"
                    onClick={() => setNuevoUsuario(true)}
                    className={`${BTN_PRINCIPAL} w-full sm:w-auto`}
                >
                    <UserPlus size={16} />
                    <span>Nuevo Usuario</span>
                </button>
            </div>

            {/* Filtros */}
            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
                <div className="relative flex-1 min-w-0">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Buscar usuarios..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={`${CAMPO} sm:py-2`}
                    />
                </div>
                <div className="w-full sm:w-64">
                    <Selector filtro className="w-full" value={filterArea} onChange={(e) => setFilterArea(e.target.value)} aria-label="Área" anchoLista={260}>
                        <option value="">Todas las Áreas</option>
                        {areas.map(area => (
                            <option key={area.AreaID} value={area.AreaID}>
                                {area.Nombre}
                            </option>
                        ))}
                    </Selector>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 mb-3 px-1">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                    Directorio de usuarios
                    {loading && <Loader2 size={14} className="animate-spin text-brand-cyan" />}
                </h3>
                {!loading && (
                    <span className="text-xs font-bold text-zinc-400 tabular-nums">
                        {filteredUsuarios.length === usuarios.length ? `${usuarios.length} usuarios` : `${filteredUsuarios.length} de ${usuarios.length} usuarios`}
                    </span>
                )}
            </div>

            {!loading && filteredUsuarios.length === 0 ? (
                <div className={`${CARD} flex flex-col items-center justify-center text-center py-16 px-4`}>
                    <UserX size={40} className="mb-3 text-brand-cyan" />
                    <p className="text-sm font-bold text-zinc-700">No hay usuarios encontrados</p>
                    <p className="text-xs text-zinc-400 mt-1">Intenta ajustar los filtros</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 pb-10">
                    {filteredUsuarios.map(u => (
                        <UserCard key={u.IdUsuario} item={u} />
                    ))}
                </div>
            )}

            {(editando || nuevoUsuario) && (
                <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="usuario-titulo">
                    <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between gap-3 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                {editando ? <Pencil size={20} className="text-brand-cyan shrink-0" /> : <UserPlus size={20} className="text-brand-cyan shrink-0" />}
                                <div className="min-w-0">
                                    <h2 id="usuario-titulo" className="text-lg font-black text-zinc-800 leading-tight truncate">
                                        {editando ? 'Editar Usuario' : 'Nuevo Usuario'}
                                    </h2>
                                    <p className="text-[11px] font-black uppercase tracking-widest text-zinc-400 mt-0.5">Credenciales y Acceso</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={cerrarModal}
                                title="Cerrar"
                                className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors shrink-0"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="flex flex-col min-h-0 flex-1">
                            <div className="p-5 overflow-y-auto">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="sm:col-span-2">
                                        <label htmlFor="usuario-nombre" className={ETIQUETA}>Nombre Completo</label>
                                        <input
                                            id="usuario-nombre"
                                            name="Nombre"
                                            required
                                            defaultValue={editando?.Nombre || ''}
                                            placeholder="Ej: Juan Pérez"
                                            className={`${ENTRADA} font-bold`}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="usuario-usuario" className={ETIQUETA}>Usuario</label>
                                        <input
                                            id="usuario-usuario"
                                            name="Usuario"
                                            required
                                            defaultValue={editando?.Usuario || ''}
                                            placeholder="juan.perez"
                                            className={`${ENTRADA} font-mono`}
                                        />
                                    </div>

                                    <div>
                                        <label htmlFor="usuario-contrasena" className={ETIQUETA}>Contraseña</label>
                                        <input
                                            id="usuario-contrasena"
                                            name="Contrasena"
                                            type="password"
                                            placeholder={editando ? "Dejar en blanco si no cambia" : "Obligatoria"}
                                            className={ENTRADA}
                                        />
                                    </div>

                                    <div className="sm:col-span-2">
                                        <label htmlFor="usuario-email" className={ETIQUETA}>Correo Electrónico</label>
                                        <input
                                            id="usuario-email"
                                            name="Email"
                                            type="email"
                                            defaultValue={editando?.Email || ''}
                                            placeholder="juan@macrosoft.com"
                                            className={ENTRADA}
                                        />
                                    </div>

                                    <div>
                                        <span className={ETIQUETA}>Rol</span>
                                        <SelectorCampo
                                            name="IdRol"
                                            required
                                            defaultValue={editando?.IdRol || ''}
                                            aria-label="Rol"
                                        >
                                            <option value="">-- Seleccionar --</option>
                                            {roles.map(r => (
                                                <option key={r.IdRol} value={r.IdRol}>{r.NombreRol}</option>
                                            ))}
                                        </SelectorCampo>
                                    </div>

                                    <div>
                                        <span className={ETIQUETA}>Área</span>
                                        <SelectorCampo
                                            name="AreaUsuario"
                                            defaultValue={editando?.AreaUsuario || ''}
                                            aria-label="Área"
                                            anchoLista={260}
                                        >
                                            <option value="">-- Sin Área Específica --</option>
                                            {areas.map(area => (
                                                <option key={area.AreaID} value={area.AreaID}>
                                                    {area.Nombre} ({area.AreaID})
                                                </option>
                                            ))}
                                        </SelectorCampo>
                                    </div>

                                    <div className="sm:col-span-2">
                                        <label className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-zinc-200 bg-zinc-50 cursor-pointer hover:bg-zinc-100 transition-colors">
                                            <input
                                                type="checkbox"
                                                name="Activo"
                                                defaultChecked={editando ? editando.Activo : true}
                                                className="w-4 h-4 rounded accent-brand-cyan cursor-pointer"
                                            />
                                            <span className="font-bold text-zinc-700 text-sm">Usuario Activo</span>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-100 flex flex-wrap justify-end gap-2 shrink-0">
                                <button type="button" onClick={cerrarModal} className={BTN_SECUNDARIO}>Cancelar</button>
                                <button type="submit" className={BTN_PRINCIPAL}>
                                    <Save size={15} />
                                    <span>Guardar Usuario</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {ventanaConfirmar}
        </div>
    );
};

export default UsersPage;
