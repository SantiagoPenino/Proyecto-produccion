import React, { useState, useEffect, useCallback } from 'react';
import { ShieldCheck, Plus, Loader2, Pencil, Trash2, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import { rolesService, menuService } from '../../services/api';
import useConfirmar from '../ui/useConfirmar';

const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const ENTRADA = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 outline-none transition-colors hover:border-zinc-300 focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block mb-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-400';

// Estética nueva (22/10/2026): fondo claro, tarjetas blancas con borde (nombre arriba, descripción, acciones al pie),
// íconos de Lucide en brand-cyan sin fondo y confirmación/avisos del sistema (antes window.confirm y alert). En los
// permisos, el ícono de cada módulo sigue siendo el de FontAwesome guardado en el menú (campo Icono).
const RolesPage = () => {
    const [roles, setRoles] = useState([]);
    const [modulos, setModulos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editando, setEditando] = useState(null);
    const [nuevoRol, setNuevoRol] = useState(null);
    const [permisosSeleccionados, setPermisosSeleccionados] = useState(new Set());
    const [confirmar, ventanaConfirmar] = useConfirmar();

    const cargarDatos = useCallback(async () => {
        setLoading(true);
        try {
            const [dataRoles, dataModulos] = await Promise.all([
                rolesService.getAll(),
                menuService.getAll()
            ]);
            setRoles(Array.isArray(dataRoles) ? dataRoles : []);
            setModulos(Array.isArray(dataModulos) ? dataModulos : []);
        } catch (error) {
            console.error("Error cargando datos", error);
            setRoles([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        cargarDatos();
    }, [cargarDatos]);

    // Cargar permisos al editar un rol
    useEffect(() => {
        if (editando) {
            const fetchPermissions = async () => {
                try {
                    const existingPermissions = await rolesService.getPermissions(editando.IdRol);
                    setPermisosSeleccionados(new Set(existingPermissions));
                } catch (error) {
                    console.error("Error cargando permisos del rol", error);
                    setPermisosSeleccionados(new Set());
                }
            };
            fetchPermissions();
        } else if (nuevoRol) {
            setPermisosSeleccionados(new Set());
        }
    }, [editando, nuevoRol]);

    const handleSave = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const itemData = {
            NombreRol: formData.get('NombreRol'),
            Descripcion: formData.get('Descripcion')
        };

        try {
            let roleId;
            if (editando) {
                roleId = editando.IdRol;
                await rolesService.update(roleId, itemData);
            } else {
                const response = await rolesService.create(itemData);
                roleId = response.IdRol;
            }

            if (roleId) {
                await rolesService.updatePermissions(roleId, Array.from(permisosSeleccionados));
            }

            setEditando(null);
            setNuevoRol(null);
            cargarDatos();
        } catch (error) {
            toast.error("Error al guardar: " + (error.message || 'Error desconocido'));
        }
    };

    const handleDelete = async (id) => {
        if (await confirmar({ titulo: '¿Deseas eliminar este rol?', confirmar: 'Eliminar', peligro: true })) {
            try {
                await rolesService.delete(id);
                cargarDatos();
            } catch (error) {
                toast.error("Error al eliminar: " + (error.message || 'Error desconocido'));
            }
        }
    };

    const togglePermiso = (idModulo) => {
        const nuevosPermisos = new Set(permisosSeleccionados);
        if (nuevosPermisos.has(idModulo)) {
            nuevosPermisos.delete(idModulo);
        } else {
            nuevosPermisos.add(idModulo);
        }
        setPermisosSeleccionados(nuevosPermisos);
    };

    const cerrarModal = () => { setEditando(null); setNuevoRol(null); };

    const PermisoItem = ({ modulo, level = 0 }) => {
        const isSelected = permisosSeleccionados.has(modulo.IdModulo);
        const children = modulos.filter(m => m.IdPadre === modulo.IdModulo).sort((a, b) => (a.IndiceOrden || 0) - (b.IndiceOrden || 0));

        return (
            <div style={{ marginLeft: level * 20 + 'px' }}>
                <label className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-zinc-50 transition-colors min-w-0">
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => togglePermiso(modulo.IdModulo)}
                        className="w-4 h-4 shrink-0 rounded accent-brand-cyan cursor-pointer"
                    />
                    <span className={`w-5 shrink-0 inline-flex items-center justify-center ${isSelected ? 'text-brand-cyan' : 'text-zinc-300'}`} aria-hidden="true">
                        <i className={`fa-solid ${modulo.Icono || 'fa-circle'} text-sm`}></i>
                    </span>
                    <span className={`max-w-[70%] truncate text-sm ${isSelected ? 'font-bold text-zinc-800' : 'text-zinc-600'}`}>
                        {modulo.Titulo || modulo.Nombre}
                    </span>
                    {modulo.Ruta && <span className="flex-1 min-w-0 pl-2 text-right truncate text-[11px] text-zinc-400 font-mono">{modulo.Ruta}</span>}
                </label>
                {children.map(child => <PermisoItem key={child.IdModulo} modulo={child} level={level + 1} />)}
            </div>
        );
    };

    const RoleCard = ({ item }) => (
        <div className={`${CARD} p-4 flex flex-col gap-3 hover:border-zinc-300 transition-colors`}>
            <div className="flex items-start gap-3">
                <ShieldCheck size={22} className="text-brand-cyan shrink-0 mt-0.5" aria-hidden="true" />
                <h3 className="min-w-0 flex-1 text-base font-black text-zinc-900 leading-tight break-words">{item.NombreRol}</h3>
            </div>

            <p className={`text-sm line-clamp-3 ${item.Descripcion ? 'text-zinc-500' : 'text-zinc-400 italic'}`}>{item.Descripcion || 'Sin descripción'}</p>

            <div className="flex items-center justify-between gap-2 mt-auto pt-1">
                <span className="text-[11px] font-mono text-zinc-400 tabular-nums">#{item.IdRol}</span>
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
                        onClick={() => handleDelete(item.IdRol)}
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

    const rootModules = modulos.filter(m => !m.IdPadre).sort((a, b) => (a.IndiceOrden || 0) - (b.IndiceOrden || 0));

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700">

            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
                <ShieldCheck size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Gestión de Roles</h1>
                    <p className="text-sm text-zinc-500 mt-1">Administración de roles y permisos</p>
                </div>
                <button
                    type="button"
                    onClick={() => setNuevoRol(true)}
                    className={`${BTN_PRINCIPAL} w-full sm:w-auto`}
                >
                    <Plus size={16} />
                    <span>Nuevo Rol</span>
                </button>
            </div>

            <div className="flex items-center justify-between gap-3 mb-3 px-1">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                    Listado de roles
                    {loading && <Loader2 size={14} className="animate-spin text-brand-cyan" />}
                </h3>
                {!loading && roles.length > 0 && (
                    <span className="text-xs font-bold text-zinc-400 tabular-nums">{roles.length} roles</span>
                )}
            </div>

            {!loading && roles.length === 0 ? (
                <div className={`${CARD} flex flex-col items-center justify-center text-center py-16 px-4`}>
                    <ShieldCheck size={40} className="mb-3 text-brand-cyan" />
                    <p className="text-sm font-bold text-zinc-700">No hay roles registrados</p>
                    <p className="text-xs text-zinc-400 mt-1">Crea el primer rol para comenzar</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 pb-10">
                    {roles.map(rol => (
                        <RoleCard key={rol.IdRol} item={rol} />
                    ))}
                </div>
            )}

            {(editando || nuevoRol) && (
                <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="rol-titulo">
                    <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between gap-3 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                {editando ? <Pencil size={20} className="text-brand-cyan shrink-0" /> : <ShieldCheck size={20} className="text-brand-cyan shrink-0" />}
                                <div className="min-w-0">
                                    <h2 id="rol-titulo" className="text-lg font-black text-zinc-800 leading-tight truncate">
                                        {editando ? 'Editar Rol' : 'Nuevo Rol'}
                                    </h2>
                                    <p className="text-[11px] font-black uppercase tracking-widest text-zinc-400 mt-0.5">Definición de Perfiles</p>
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

                        <form onSubmit={handleSave} className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
                            {/* Left: Role Info */}
                            <div className="w-full md:w-1/3 shrink-0 p-5 border-b md:border-b-0 md:border-r border-zinc-100 space-y-4 overflow-y-auto">
                                <div>
                                    <label htmlFor="rol-nombre" className={ETIQUETA}>Nombre del Rol</label>
                                    <input
                                        id="rol-nombre"
                                        name="NombreRol"
                                        required
                                        defaultValue={editando?.NombreRol || ''}
                                        placeholder="Ej: Admin"
                                        className={`${ENTRADA} font-bold`}
                                    />
                                </div>
                                <div>
                                    <label htmlFor="rol-descripcion" className={ETIQUETA}>Descripción</label>
                                    <textarea
                                        id="rol-descripcion"
                                        name="Descripcion"
                                        rows="4"
                                        defaultValue={editando?.Descripcion || ''}
                                        placeholder="..."
                                        className={`${ENTRADA} resize-none`}
                                    />
                                </div>

                                <div className="pt-2 hidden md:flex gap-2">
                                    <button type="button" onClick={cerrarModal} className={BTN_SECUNDARIO}>Cancelar</button>
                                    <button type="submit" className={`${BTN_PRINCIPAL} flex-1`}>
                                        <Save size={15} />
                                        <span>Guardar</span>
                                    </button>
                                </div>
                            </div>

                            {/* Right: Permissions */}
                            <div className="w-full md:w-2/3 flex-1 min-h-0 bg-zinc-50/70 flex flex-col">
                                <div className="px-5 py-3 border-b border-zinc-100 bg-zinc-50 flex justify-between items-center gap-3 shrink-0">
                                    <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400">Permisos de Módulos</h3>
                                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full border bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20 tabular-nums">{permisosSeleccionados.size} seleccionados</span>
                                </div>
                                <div className="flex-1 min-h-0 overflow-y-auto p-3 sm:p-4 space-y-3 custom-scrollbar">
                                    {rootModules.map(root => (
                                        <div key={root.IdModulo} className="bg-white p-2 rounded-xl border border-zinc-200">
                                            <PermisoItem modulo={root} />
                                        </div>
                                    ))}
                                </div>

                                <div className="p-3 md:hidden border-t border-zinc-200 bg-white flex gap-2 shrink-0">
                                    <button type="button" onClick={cerrarModal} className={BTN_SECUNDARIO}>Cancelar</button>
                                    <button
                                        type="submit"
                                        className={`${BTN_PRINCIPAL} flex-1`}
                                    >
                                        <Save size={15} />
                                        <span>Guardar</span>
                                    </button>
                                </div>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {ventanaConfirmar}
        </div>
    );
};

export default RolesPage;
