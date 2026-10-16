import React, { useState, useEffect, useCallback } from 'react';
import { usersService, rolesService, areasService } from '../../services/api';

const UsersPage = () => {
    const [usuarios, setUsuarios] = useState([]);
    const [roles, setRoles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editando, setEditando] = useState(null);
    const [nuevoUsuario, setNuevoUsuario] = useState(null);

    const [areas, setAreas] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterArea, setFilterArea] = useState('');

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
                    alert("La contraseña es obligatoria para nuevos usuarios");
                    return;
                }
                await usersService.create(itemData);
            }
            setEditando(null);
            setNuevoUsuario(null);
            cargarDatos();
        } catch (error) {
            alert("Error al guardar: " + (error.response?.data?.error || error.message || 'Error desconocido'));
        }
    };

    const handleDelete = async (id) => {
        if (window.confirm('¿Deseas eliminar este usuario?')) {
            try {
                await usersService.delete(id);
                cargarDatos();
            } catch (error) {
                alert("Error al eliminar: " + (error.response?.data?.error || error.message || 'Error desconocido'));
            }
        }
    };

    const UserCard = ({ item }) => {
        const rolNombre = roles.find(r => r.IdRol === item.IdRol)?.NombreRol || 'Rol Desconocido';

        return (
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 hover:shadow-md transition-all duration-200 flex flex-col justify-between group relative overflow-hidden">
                {!item.Activo && <div className="absolute top-0 right-0 bg-red-100 text-red-600 text-[10px] font-bold px-2 py-1 rounded-bl-xl uppercase tracking-wider">Inactivo</div>}

                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                        <div className={`w-12 h-12 flex items-center justify-center rounded-2xl text-xl shadow-sm ${item.Activo ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                            <i className="fa-solid fa-user"></i>
                        </div>
                        <div>
                            <h3 className="text-base font-bold text-slate-800 leading-tight">{item.Nombre}</h3>
                            <p className="text-xs text-slate-400 font-mono mt-0.5">@{item.Usuario}</p>
                        </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                        <button
                            onClick={() => setEditando(item)}
                            className="w-8 h-8 flex items-center justify-center text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                            title="Editar"
                        >
                            <i className="fa-solid fa-pencil"></i>
                        </button>
                        <button
                            onClick={() => handleDelete(item.IdUsuario)}
                            className="w-8 h-8 flex items-center justify-center text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                            title="Eliminar"
                        >
                            <i className="fa-solid fa-trash"></i>
                        </button>
                    </div>
                </div>

                <div className="space-y-2 mt-2">
                    <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 p-2 rounded-lg">
                        <i className="fa-solid fa-id-badge text-indigo-400 w-4 text-center"></i>
                        <span className="font-semibold">{rolNombre}</span>
                    </div>
                    {item.AreaUsuario && (
                        <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 p-2 rounded-lg">
                            <i className="fa-solid fa-building text-indigo-400 w-4 text-center"></i>
                            <span>{item.AreaUsuario}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-slate-600 bg-slate-50 p-2 rounded-lg truncate">
                        <i className="fa-solid fa-envelope text-indigo-400 w-4 text-center"></i>
                        <span>{item.Email || 'Sin email'}</span>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans text-slate-900">
            <div className="max-w-6xl mx-auto">

                <header className="flex flex-col md:flex-row md:items-center justify-between mb-8 bg-white p-6 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100">
                    <div className="mb-4 md:mb-0">
                        <div className="flex items-center gap-4">
                            <div className="w-14 h-14 flex items-center justify-center bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-200">
                                <i className="fa-solid fa-users text-2xl"></i>
                            </div>
                            <div>
                                <h1 className="text-2xl font-black text-slate-800 tracking-tight leading-none">Gestión de Usuarios</h1>
                                <p className="text-slate-400 text-sm mt-1 font-medium italic">Administración de acceso y perfiles</p>
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={() => setNuevoUsuario(true)}
                        className="flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 transition-all hover:-translate-y-0.5 active:scale-95"
                    >
                        <i className="fa-solid fa-user-plus"></i>
                        <span>Nuevo Usuario</span>
                    </button>
                </header>

                <div className="space-y-6">
                    <div className="flex items-center justify-between px-2">
                        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                            <span className="w-2 h-2 bg-indigo-400 rounded-full animate-pulse"></span>
                            Directorio de Usuarios
                        </h3>
                        {loading && <i className="fa-solid fa-circle-notch fa-spin text-indigo-500 text-lg"></i>}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-4 mb-6">
                        <div className="relative flex-1">
                            <i className="fa-solid fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"></i>
                            <input
                                type="text"
                                placeholder="Buscar usuarios..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all"
                            />
                        </div>
                        <div className="w-full sm:w-64">
                            <select
                                value={filterArea}
                                onChange={(e) => setFilterArea(e.target.value)}
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all cursor-pointer"
                            >
                                <option value="">Todas las Áreas</option>
                                {areas.map(area => (
                                    <option key={area.AreaID} value={area.AreaID}>
                                        {area.Nombre}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {!loading && filteredUsuarios.length === 0 ? (
                        <div className="text-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-200">
                            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                                <i className="fa-solid fa-users-slash text-slate-300 text-3xl"></i>
                            </div>
                            <p className="text-slate-500 font-bold text-lg">No hay usuarios encontrados</p>
                            <p className="text-slate-400 text-sm">Intenta ajustar los filtros</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 pb-20">
                            {filteredUsuarios.map(u => (
                                <UserCard key={u.IdUsuario} item={u} />
                            ))}
                        </div>
                    )}
                </div>

                {(editando || nuevoUsuario) && (
                    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-[1200] animate-in fade-in duration-200">
                        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200">
                            <div className="px-8 py-6 bg-slate-50 border-b border-slate-100 flex justify-between items-center shrink-0">
                                <div>
                                    <h2 className="text-xl font-black text-slate-800 tracking-tight">
                                        {editando ? 'Editar Usuario' : 'Nuevo Usuario'}
                                    </h2>
                                    <p className="text-[10px] text-indigo-500 font-black uppercase tracking-widest mt-1">Credenciales y Acceso</p>
                                </div>
                                <button
                                    onClick={() => { setEditando(null); setNuevoUsuario(null); }}
                                    className="w-10 h-10 flex items-center justify-center hover:bg-white hover:text-rose-500 rounded-xl transition-all text-slate-400"
                                >
                                    <i className="fa-solid fa-xmark text-xl"></i>
                                </button>
                            </div>

                            <form onSubmit={handleSave} className="p-8 space-y-4 overflow-y-auto">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5 col-span-2">
                                        <label className="text-xs font-black text-slate-500 uppercase tracking-widest ml-1">Nombre Completo</label>
                                        <input
                                            name="Nombre"
                                            required
                                            defaultValue={editando?.Nombre || ''}
                                            placeholder="Ej: Juan Pérez"
                                            className="w-full px-5 py-3 bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-xl outline-none transition-all font-bold text-slate-700 placeholder:text-slate-400 text-sm"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-black text-slate-500 uppercase tracking-widest ml-1">Usuario</label>
                                        <input
                                            name="Usuario"
                                            required
                                            defaultValue={editando?.Usuario || ''}
                                            placeholder="juan.perez"
                                            className="w-full px-5 py-3 bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-xl outline-none transition-all text-sm font-semibold text-slate-700"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-black text-slate-500 uppercase tracking-widest ml-1">Contraseña</label>
                                        <input
                                            name="Contrasena"
                                            type="password"
                                            placeholder={editando ? "Dejar en blanco si no cambia" : "Obligatoria"}
                                            className="w-full px-5 py-3 bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-xl outline-none transition-all text-sm font-semibold text-slate-700"
                                        />
                                    </div>

                                    <div className="space-y-1.5 col-span-2">
                                        <label className="text-xs font-black text-slate-500 uppercase tracking-widest ml-1">Correo Electrónico</label>
                                        <input
                                            name="Email"
                                            type="email"
                                            defaultValue={editando?.Email || ''}
                                            placeholder="juan@macrosoft.com"
                                            className="w-full px-5 py-3 bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-xl outline-none transition-all text-sm font-semibold text-slate-700"
                                        />
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-black text-slate-500 uppercase tracking-widest ml-1">Rol</label>
                                        <select
                                            name="IdRol"
                                            required
                                            defaultValue={editando?.IdRol || ''}
                                            className="w-full px-5 py-3 bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-xl outline-none font-bold text-slate-700 text-sm cursor-pointer"
                                        >
                                            <option value="">-- Seleccionar --</option>
                                            {roles.map(r => (
                                                <option key={r.IdRol} value={r.IdRol}>{r.NombreRol}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="space-y-1.5">
                                        <label className="text-xs font-black text-slate-500 uppercase tracking-widest ml-1">Área</label>
                                        <select
                                            name="AreaUsuario"
                                            defaultValue={editando?.AreaUsuario || ''}
                                            className="w-full px-5 py-3 bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white rounded-xl outline-none font-bold text-slate-700 text-sm cursor-pointer uppercase"
                                        >
                                            <option value="">-- Sin Área Específica --</option>
                                            {areas.map(area => (
                                                <option key={area.AreaID} value={area.AreaID}>
                                                    {area.Nombre} ({area.AreaID})
                                                </option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="col-span-2 pt-2">
                                        <label className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl cursor-pointer hover:bg-slate-100 transition-colors">
                                            <input
                                                type="checkbox"
                                                name="Activo"
                                                defaultChecked={editando ? editando.Activo : true}
                                                className="w-5 h-5 text-indigo-600 rounded focus:ring-indigo-500"
                                            />
                                            <span className="font-bold text-slate-700 text-sm">Usuario Activo</span>
                                        </label>
                                    </div>
                                </div>

                                <div className="pt-4">
                                    <button
                                        type="submit"
                                        className="w-full relative group bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-4 rounded-2xl font-black text-base shadow-xl shadow-indigo-200 transition-all hover:-translate-y-0.5 active:scale-95 overflow-hidden"
                                    >
                                        <div className="flex items-center justify-center gap-2 relative z-10">
                                            <i className="fa-solid fa-floppy-disk group-hover:rotate-12 transition-transform"></i>
                                            <span>Guardar Usuario</span>
                                        </div>
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default UsersPage;
