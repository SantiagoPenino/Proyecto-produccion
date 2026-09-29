import React, { useState, useEffect } from 'react';
import { Users, Trash2, Search, Loader2, AlertTriangle, UserMinus, CheckCircle2, Save } from 'lucide-react';
import { toast } from 'sonner';
import api from '../../../services/api';

const EDITABLE_FIELDS = [
    { key: 'Nombre', label: 'Nombre Comercial', minW: 'min-w-[200px]', place: 'Sin nombre...' },
    { key: 'NombreFantasia', label: 'Nombre Fantasía', minW: 'min-w-[150px]', place: 'Sin fantasía...' },
    { key: 'CioRuc', label: 'RUC / CI', minW: 'min-w-[120px]', center: true, place: '-' },
    { key: 'Cedula', label: 'Cédula', minW: 'min-w-[120px]', center: true, place: '-' },
    { key: 'IDCliente', label: 'ID Cliente (Str)', minW: 'min-w-[120px]', center: true, place: '-' },
    { key: 'TelefonoTrabajo', label: 'Teléfono', minW: 'min-w-[150px]', center: true, place: '-' },
    { key: 'Email', label: 'Email', minW: 'min-w-[200px]', place: 'user@mail.com' },
    { key: 'CliDireccion', label: 'Dirección (CliDireccion)', minW: 'min-w-[250px]', place: 'Sin dirección...' },
    { key: 'DireccionTrabajo', label: 'Dirección Trabajo', minW: 'min-w-[250px]', place: 'Sin dirección...' },
    { key: 'Localidad', label: 'Localidad', minW: 'min-w-[150px]', place: '-' },
    { key: 'Agencia', label: 'Agencia', minW: 'min-w-[150px]', place: '-' },
    { key: 'Moneda', label: 'Moneda', minW: 'min-w-[100px]', center: true, place: '1' },
    { key: 'Tipo', label: 'Tipo', minW: 'min-w-[100px]', center: true, place: '-' },
    { key: 'TiposPrecios', label: 'Tipo Precio', minW: 'min-w-[100px]', center: true, place: '-' },
    { key: 'DepartamentoID', label: 'Depto ID', minW: 'min-w-[100px]', center: true, place: '-' },
    { key: 'LocalidadID', label: 'Loc ID', minW: 'min-w-[100px]', center: true, place: '-' },
    { key: 'AgenciaID', label: 'Agencia ID', minW: 'min-w-[100px]', center: true, place: '-' },
    { key: 'FormaEnvioID', label: 'Forma Envío', minW: 'min-w-[120px]', center: true, place: '-' },
    { key: 'ESTADO', label: 'Estado', minW: 'min-w-[120px]', center: true, place: '-' },
    { key: 'VendedorID', label: 'Vendedor', minW: 'min-w-[120px]', center: true, place: '-' },
    { key: 'CodigoReact', label: 'Cód. React', minW: 'min-w-[120px]', center: true, mono: true, color: 'text-purple-700', place: '-' },
    { key: 'IDReact', label: 'ID React', minW: 'min-w-[120px]', center: true, mono: true, color: 'text-purple-700', place: '-' },
    { key: 'CodReferencia', label: 'ID Macrosoft', minW: 'min-w-[120px]', center: true, mono: true, color: 'text-emerald-700', place: '-' },
];

const DuplicateClientsPage = () => {
    const [clients, setClients] = useState([]);
    const [reactClients, setReactClients] = useState([]);
    const [formAnswers, setFormAnswers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [saving, setSaving] = useState({});

    useEffect(() => {
        fetchDuplicates();
    }, []);

    const fetchDuplicates = async () => {
        try {
            setLoading(true);
            const res = await api.get('/clients/admin/duplicates');
            const data = (res.data?.clients || []).map(c => ({ ...c, _original: { ...c }, _dirty: false }));
            setClients(data);
            setReactClients(res.data?.reactClients || []);
            setFormAnswers(res.data?.formAnswers || []);
        } catch (error) {
            console.error(error);
            toast.error('Error al cargar clientes duplicados');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (codCliente, nombre) => {
        if (!window.confirm(`¿Estás seguro de que deseas ELIMINAR permanentemente al cliente "${nombre}"? Esta acción no se puede deshacer.`)) {
            return;
        }

        try {
            await api.delete(`/clients/${codCliente}`);
            toast.success('Cliente eliminado correctamente');
            setClients(prev => prev.filter(c => c.CodCliente !== codCliente));
        } catch (error) {
            toast.error(error.response?.data?.error || 'Error al eliminar cliente');
        }
    };

    const handleFieldChange = (codCliente, field, value) => {
        setClients(prev => prev.map(c => {
            if (c.CodCliente === codCliente) {
                const newValue = value;
                const isDirty = c._original[field] !== newValue || Object.keys(c).some(k => k !== field && !k.startsWith('_') && c[k] !== c._original[k]);
                return { ...c, [field]: newValue, _dirty: isDirty };
            }
            return c;
        }));
    };

    const handleSave = async (client) => {
        try {
            setSaving(prev => ({ ...prev, [client.CodCliente]: true }));

            const payload = {};
            EDITABLE_FIELDS.forEach(f => {
                payload[f.key] = client[f.key];
            });

            await api.put(`/clients/${client.CodCliente}`, payload);
            toast.success(`Cambios guardados en cliente ID: ${client.CodCliente}`);

            setClients(prev => prev.map(c => {
                if (c.CodCliente === client.CodCliente) {
                    return { ...c, _original: { ...c }, _dirty: false };
                }
                return c;
            }));
        } catch (error) {
            console.error(error);
            // El server explica el rechazo (ej. IDCliente que ya tiene otro cliente)
            toast.error(error.response?.data?.error || 'Error al guardar cambios');
        } finally {
            setSaving(prev => ({ ...prev, [client.CodCliente]: false }));
        }
    };

    const groupedClients = clients.reduce((acc, client) => {
        const id = client.IDCliente || 'Sin IDCliente';
        if (!acc[id]) acc[id] = [];
        acc[id].push(client);
        return acc;
    }, {});

    const filteredGroups = Object.keys(groupedClients).filter(idCliente => {
        const term = searchTerm.toLowerCase();
        return idCliente.toLowerCase().includes(term) ||
            groupedClients[idCliente].some(c => (c.Nombre || '').toLowerCase().includes(term));
    });

    return (
        <div className="p-4 lg:p-6 w-full mx-auto min-h-[85vh] bg-[#f8fafc]">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
                <div>
                    <h1 className="text-3xl font-black text-slate-800 flex items-center gap-3">
                        <Users className="text-blue-600" size={32} />
                        Depuración Extendida de Clientes
                    </h1>
                    <p className="text-slate-500 mt-2 font-medium max-w-2xl">
                        Desplázate hacia la derecha para ver todos los campos de la base. Cruza datos entre filas y elimina los obsoletos.
                    </p>
                </div>

                <div className="relative w-full md:w-80 shrink-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        placeholder="Buscar por nombre o IDReact..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all font-medium text-slate-700"
                    />
                </div>
            </div>

            {loading ? (
                <div className="flex flex-col items-center justify-center h-[50vh]">
                    <Loader2 size={48} className="animate-spin text-blue-500 mb-4" />
                    <span className="text-slate-500 font-medium animate-pulse">Analizando registros y buscando duplicados...</span>
                </div>
            ) : filteredGroups.length === 0 ? (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-16 flex flex-col items-center justify-center text-center">
                    <div className="w-24 h-24 bg-emerald-50 rounded-full flex items-center justify-center mb-6">
                        <CheckCircle2 size={48} className="text-emerald-500" />
                    </div>
                    <h2 className="text-2xl font-black text-slate-800 mb-2">¡Todo limpio!</h2>
                    <p className="text-slate-500 max-w-md font-medium">No existen más registros duplicados bajo un mismo IDReact.</p>
                </div>
            ) : (
                <div className="flex flex-col gap-8">
                    {filteredGroups.map((idCliente, idx) => (
                        <div key={idCliente} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex flex-col relative max-w-[calc(100vw-120px)] mx-auto">
                            {/* Cabecera Grup */}
                            <div className="bg-slate-50 px-6 py-4 border-b border-slate-200 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 sticky left-0 z-20">
                                <div className="flex items-center gap-3">
                                    <div className="bg-blue-600 text-white w-8 h-8 rounded-full flex items-center justify-center font-black">
                                        {idx + 1}
                                    </div>
                                    <span className="bg-blue-100 text-blue-800 px-3 py-1 font-bold rounded-lg border border-blue-200 tracking-wide text-sm flex items-center gap-2">
                                        <i className="fa-solid fa-id-card"></i> IDCliente #{idCliente}
                                    </span>
                                    <span className="text-slate-500 text-sm font-semibold">
                                        ({groupedClients[idCliente].length} registros chocando)
                                    </span>
                                </div>
                                <div className="flex items-center gap-2 text-amber-600 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200 text-xs font-bold shrink-0">
                                    <AlertTriangle size={16} /> Fusiónales la info y deja solo 1
                                </div>
                            </div>

                            {/* Reference external data sources */}
                            {(() => {
                                const idsReactDelGrupo = [...new Set(groupedClients[idCliente].map(c => c.IDReact).filter(id => id && String(id).trim() !== ''))];
                                const reactMatch = reactClients.filter(rc => idsReactDelGrupo.includes(String(rc.CliIdCliente)));
                                const formMatch = formAnswers.filter(fa => idsReactDelGrupo.includes(String(fa['ID react'])));

                                if (reactMatch.length === 0 && formMatch.length === 0) return null;

                                return (
                                    <div className="bg-blue-50/50 p-4 border-b border-slate-200 grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <h4 className="text-xs font-black uppercase tracking-wider text-blue-800 mb-3 flex items-center gap-2">
                                                <i className="fa-brands fa-react"></i> Referencia de Clientes React
                                            </h4>
                                            {reactMatch.map(rc => (
                                                <div key={rc.CliIdCliente} className="bg-white p-3 rounded-xl shadow-sm border border-blue-100 text-xs text-slate-600 flex flex-col gap-1.5 mb-2">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className="font-bold text-slate-800 text-sm">{rc.CliNombreApellido}</span>
                                                        <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">Cód: {rc.CliCodigoCliente}</span>
                                                    </div>
                                                    <p><span className="font-semibold text-slate-500">Fantasia:</span> {rc.CliNombreEmpresa || rc.CliCodigoClienteFantasia}</p>
                                                    <p><span className="font-semibold text-slate-500">Docs:</span> {rc.CliDocumento}</p>
                                                    <p><span className="font-semibold text-slate-500">Contacto:</span> {rc.CliCelular} | {rc.CliMail}</p>
                                                    <p><span className="font-semibold text-slate-500">Ubicación:</span> {rc.CliDireccion}, {rc.CliLocalidad}</p>
                                                </div>
                                            ))}
                                        </div>

                                        <div>
                                            <h4 className="text-xs font-black uppercase tracking-wider text-emerald-800 mb-3 flex items-center gap-2">
                                                <i className="fa-solid fa-file-invoice"></i> Referencia de Formularios Web
                                            </h4>
                                            {formMatch.map(fa => (
                                                <div key={fa.ID} className="bg-white p-3 rounded-xl shadow-sm border border-emerald-100 text-xs text-slate-600 flex flex-col gap-1.5 mb-2">
                                                    <div className="flex justify-between items-center mb-1">
                                                        <span className="font-bold text-slate-800 text-sm">{fa.Nombre || fa['Empresa o marca']}</span>
                                                        <span className="bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded text-[10px] font-bold">Form ID: {fa.ID}</span>
                                                    </div>
                                                    <p><span className="font-semibold text-slate-500">Docs:</span> {fa['Cedula o rut']}</p>
                                                    <p><span className="font-semibold text-slate-500">Contacto:</span> {fa.Contacto} | {fa.Mail}</p>
                                                    <p><span className="font-semibold text-slate-500">Ubicación:</span> {fa.Direccion}</p>
                                                    <p><span className="font-semibold text-slate-500">Ciudad:</span> {fa.Ciudad}, {fa.Departamento}</p>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })()}


                            {/* Grilla Scrollable */}
                            <div className="w-full overflow-x-auto relative custom-scrollbar pb-2">
                                <table className="w-full text-left whitespace-nowrap min-w-max border-collapse">
                                    <thead className="bg-white border-b border-slate-300 text-xs uppercase tracking-wider font-extrabold text-slate-400 select-none">
                                        <tr>
                                            <th className="p-4 min-w-[100px] sticky left-0 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-10 box-border border-r border-slate-200">
                                                Acciones
                                            </th>
                                            <th className="p-4 min-w-[100px] sticky left-[100px] bg-slate-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-10 box-border border-r border-slate-200">
                                                ID Local
                                            </th>
                                            {EDITABLE_FIELDS.map(f => (
                                                <th key={f.key} className={`p-4 ${f.minW}`}>
                                                    {f.label}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {groupedClients[idCliente].map(client => (
                                            <tr key={client.CodCliente} className={`transition-colors hover:bg-slate-50 ${client._dirty ? 'bg-amber-50/20' : ''}`}>

                                                {/* COLUMNAS FIJAS: Acciones y Código Local */}
                                                <td className="p-3 text-center align-middle sticky left-0 bg-white/95  shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-10 border-r border-slate-200">
                                                    <div className="flex items-center gap-2 justify-center">
                                                        <button
                                                            onClick={() => handleSave(client)}
                                                            disabled={!client._dirty || saving[client.CodCliente]}
                                                            className={`p-2 rounded-lg flex items-center justify-center transition-all ${client._dirty
                                                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow focus:ring-2 ring-emerald-300'
                                                                : 'bg-slate-100 text-slate-400 cursor-not-allowed opacity-50'
                                                                }`}
                                                            title={client._dirty ? "Guardar cambios" : "Registro sin cambios"}
                                                        >
                                                            {saving[client.CodCliente] ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDelete(client.CodCliente, client.Nombre)}
                                                            className="p-2 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-500 hover:text-white transition-colors group border border-rose-100"
                                                            title="Eliminar registro sobrante"
                                                        >
                                                            <Trash2 size={16} className="group-hover:scale-110 transition-transform" />
                                                        </button>
                                                    </div>
                                                </td>

                                                <td className="p-3 align-middle sticky left-[100px] bg-slate-50/95  shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] z-10 border-r border-slate-200">
                                                    <span className="font-mono font-bold text-slate-600 bg-slate-200 px-2.5 py-1 rounded text-sm select-all">
                                                        {client.CodCliente}
                                                    </span>
                                                </td>

                                                {/* COLUMNAS MÓVILES GENERADAS DINÁMICAMENTE */}
                                                {EDITABLE_FIELDS.map(f => {
                                                    const isDirty = client._original[f.key] !== client[f.key];
                                                    return (
                                                        <td key={`${client.CodCliente}-${f.key}`} className="p-2 align-middle border-r border-slate-50 last:border-r-0">
                                                            <input
                                                                type="text"
                                                                value={client[f.key] !== null && client[f.key] !== undefined ? client[f.key] : ''}
                                                                onChange={(e) => handleFieldChange(client.CodCliente, f.key, e.target.value)}
                                                                className={`
                                                                    w-full bg-transparent border rounded-md px-3 py-2 outline-none focus:border-blue-500 focus:bg-white focus:shadow-sm transition-all text-sm
                                                                    ${isDirty ? 'border-amber-400 bg-amber-50 font-semibold' : 'border-transparent hover:border-slate-300'}
                                                                    ${f.center ? 'text-center' : ''}
                                                                    ${f.mono ? 'font-mono' : ''}
                                                                    ${f.color ? f.color : 'text-slate-800'}
                                                                `}
                                                                placeholder={f.place}
                                                            />
                                                        </td>
                                                    );
                                                })}

                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default DuplicateClientsPage;

