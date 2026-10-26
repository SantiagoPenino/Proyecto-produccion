import React, { useState, useEffect } from 'react';
import api from '../../../services/api';
import { toast } from 'sonner';
import { MapPin, MapPinned, Truck, Plus, Edit2, Trash2, Search, Save, X, Loader2, SearchX } from 'lucide-react';
import Selector from '../../ui/Selector';
import useConfirmar from '../../ui/useConfirmar';

// Estética nueva (22/10/2026): encabezado con ícono brand-cyan sin fondo, pestañas en pastillas (la elegida en
// negro), tarjetas blancas zinc, Selector propio para los departamentos y la confirmación del sistema al eliminar.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CAMPO_MODAL = 'w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-bold text-zinc-800 placeholder:text-zinc-400 placeholder:font-normal focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ROTULO = 'block mb-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-400';
const TH = 'px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400';
const BTN_ICONO = 'w-8 h-8 inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-400 transition-colors';

const NomenclatorsABM = () => {
    const [activeTab, setActiveTab] = useState('agencias'); // 'agencias' | 'localidades'
    const [agencias, setAgencias] = useState([]);
    const [localidades, setLocalidades] = useState([]);
    const [departamentos, setDepartamentos] = useState([]);

    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filtroDepartamento, setFiltroDepartamento] = useState(''); // '' = Todos

    // Modal state
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null); // null = nuevo
    const [formData, setFormData] = useState({ nombre: '', departamentoId: '' });
    const [confirmar, ventanaConfirmar] = useConfirmar();

    useEffect(() => {
        loadData();
    }, [activeTab]);

    const loadData = async () => {
        setLoading(true);
        try {
            if (activeTab === 'agencias') {
                const res = await api.get('/nomenclators/agencies');
                setAgencias(res.data.data);
            } else {
                const [locRes, depRes] = await Promise.all([
                    api.get('/nomenclators/localities'),
                    api.get('/nomenclators/departments')
                ]);
                setLocalidades(locRes.data.data);
                setDepartamentos(depRes.data.data);
            }
        } catch (error) {
            toast.error("Error al cargar datos");
        } finally {
            setLoading(false);
        }
    };

    const handleOpenModal = (item = null) => {
        setEditingItem(item);
        if (item) {
            setFormData({
                nombre: item.Nombre,
                departamentoId: item.DepartamentoID || ''
            });
        } else {
            setFormData({
                nombre: '',
                departamentoId: activeTab === 'localidades' ? filtroDepartamento : ''
            });
        }
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingItem(null);
        setFormData({ nombre: '', departamentoId: '' });
    };

    const handleSave = async () => {
        if (!formData.nombre.trim()) {
            return toast.warning("El nombre es obligatorio");
        }
        if (activeTab === 'localidades' && !formData.departamentoId) {
            return toast.warning("Debes seleccionar un departamento");
        }

        const endpoint = activeTab === 'agencias' ? '/nomenclators/agencies' : '/nomenclators/localities';

        try {
            if (editingItem) {
                await api.put(`${endpoint}/${editingItem.ID}`, formData);
                toast.success(`${activeTab === 'agencias' ? 'Agencia' : 'Localidad'} actualizada`);
            } else {
                await api.post(endpoint, formData);
                toast.success(`${activeTab === 'agencias' ? 'Agencia' : 'Localidad'} creada`);
            }
            handleCloseModal();
            loadData();
        } catch (error) {
            console.error(error);
            toast.error("Error al guardar");
        }
    };

    const handleDelete = async (item) => {
        const ok = await confirmar({
            titulo: '¿Eliminar registro?',
            texto: `Vas a eliminar "${item.Nombre}". Esta acción no se puede deshacer.`,
            confirmar: 'Sí, eliminar',
            peligro: true,
        });

        if (ok) {
            try {
                const endpoint = activeTab === 'agencias' ? '/nomenclators/agencies' : '/nomenclators/localities';
                await api.delete(`${endpoint}/${item.ID}`);
                toast.success("Eliminado correctamente");
                loadData();
            } catch (error) {
                toast.error("Error al eliminar. Puede estar en uso.");
            }
        }
    };

    const filteredItems = (activeTab === 'agencias' ? agencias : localidades).filter(item => {
        const matchText = item.Nombre.toLowerCase().includes(searchTerm.toLowerCase());
        if (activeTab === 'localidades' && filtroDepartamento) {
            return matchText && String(item.DepartamentoID) === String(filtroDepartamento);
        }
        return matchText;
    });

    const esAgencias = activeTab === 'agencias';
    const TABS = [['agencias', 'Agencias', Truck], ['localidades', 'Localidades', MapPin]];

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700">
            {/* Cabecera */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
                <MapPinned size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">ABM Nomencladores</h1>
                    <p className="text-sm text-zinc-500 mt-1">Gestión rápida de Agencias de Envío y Localidades.</p>
                </div>
                <div className="w-full sm:w-auto inline-flex rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                    {TABS.map(([k, label, Icono]) => (
                        <button key={k} type="button" onClick={() => setActiveTab(k)}
                            className={`flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === k ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>
                            <Icono size={15} className={activeTab === k ? 'text-white' : 'text-brand-cyan'} /> {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Toolbar */}
            <div className={`${CARD} p-3 sm:p-4 mb-4 flex flex-wrap items-center gap-2 sm:gap-3`}>
                <div className="relative w-full sm:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" size={16} />
                    <input
                        type="text"
                        placeholder={`Buscar ${activeTab}...`}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className={CAMPO}
                    />
                </div>

                {!esAgencias && (
                    <Selector filtro value={filtroDepartamento} onChange={(e) => setFiltroDepartamento(e.target.value)} aria-label="Departamento" anchoLista={260}>
                        <option value="">Todos los departamentos</option>
                        {departamentos.map(dep => (
                            <option key={dep.ID} value={dep.ID}>{dep.Nombre}</option>
                        ))}
                    </Selector>
                )}

                <button onClick={() => handleOpenModal()} className={`${BTN_PRINCIPAL} w-full sm:w-auto sm:ml-auto`}>
                    <Plus size={16} /> Nueva {esAgencias ? 'Agencia' : 'Localidad'}
                </button>
            </div>

            {/* Tabla */}
            <div className={`${CARD} overflow-hidden`}>
                <div className="px-4 sm:px-5 py-3 border-b border-zinc-100 flex items-center justify-between gap-3">
                    <span className="text-sm font-black uppercase tracking-wide text-zinc-800">{esAgencias ? 'Agencias de envío' : 'Localidades'}</span>
                    {!loading && <span className="text-xs font-bold text-zinc-400 tabular-nums">{filteredItems.length} registro{filteredItems.length !== 1 ? 's' : ''}</span>}
                </div>
                {loading ? (
                    <div className="flex justify-center items-center gap-2 py-16 text-sm text-zinc-500">
                        <Loader2 size={18} className="animate-spin text-brand-cyan" /> Cargando...
                    </div>
                ) : filteredItems.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-center py-14 px-6">
                        <SearchX size={40} className="mb-3 text-brand-cyan" />
                        <span className="text-sm font-bold text-zinc-700">No se encontraron registros.</span>
                        <span className="text-xs text-zinc-400 mt-1">Probá con otra búsqueda{!esAgencias ? ' u otro departamento' : ''}.</span>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-zinc-50 border-b border-zinc-200">
                                <tr>
                                    <th className={`${TH} w-16`}>ID</th>
                                    <th className={TH}>Nombre</th>
                                    {!esAgencias && <th className={TH}>Departamento</th>}
                                    <th className={`${TH} text-right w-28`}>Acciones</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100">
                                {filteredItems.map(item => (
                                    <tr key={item.ID} className="hover:bg-zinc-50 transition-colors">
                                        <td className="px-4 py-2.5 text-xs text-zinc-400 font-mono tabular-nums">{item.ID}</td>
                                        <td className="px-4 py-2.5 text-sm font-bold text-zinc-800">{item.Nombre}</td>
                                        {!esAgencias && (
                                            <td className="px-4 py-2.5 text-sm text-zinc-600">{item.DepartamentoNombre}</td>
                                        )}
                                        <td className="px-4 py-2.5">
                                            <div className="flex justify-end gap-1.5">
                                                <button onClick={() => handleOpenModal(item)} className={`${BTN_ICONO} hover:text-brand-cyan hover:border-brand-cyan/30 hover:bg-brand-cyan/5`} title="Editar">
                                                    <Edit2 size={14} />
                                                </button>
                                                <button onClick={() => handleDelete(item)} className={`${BTN_ICONO} hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5`} title="Eliminar">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/40 z-[6000] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl border border-zinc-200 shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                        <div className="px-5 py-4 border-b border-zinc-100 flex justify-between items-center gap-3">
                            <h3 className="text-lg font-black text-zinc-900 inline-flex items-center gap-2">
                                {esAgencias ? <Truck size={18} className="text-brand-cyan" /> : <MapPin size={18} className="text-brand-cyan" />}
                                {editingItem ? 'Editar' : 'Nueva'} {esAgencias ? 'Agencia' : 'Localidad'}
                            </h3>
                            <button onClick={handleCloseModal} className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors" title="Cerrar">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-5 flex flex-col gap-4">
                            <div>
                                <label htmlFor="nomenclador-nombre" className={ROTULO}>Nombre</label>
                                <input
                                    id="nomenclador-nombre"
                                    type="text"
                                    value={formData.nombre}
                                    onChange={e => setFormData({ ...formData, nombre: e.target.value })}
                                    className={CAMPO_MODAL}
                                    autoFocus
                                />
                            </div>

                            {!esAgencias && (
                                <div>
                                    <span className={ROTULO}>Departamento</span>
                                    <Selector
                                        value={formData.departamentoId}
                                        onChange={e => setFormData({ ...formData, departamentoId: e.target.value })}
                                        aria-label="Departamento"
                                        className="w-full"
                                    >
                                        <option value="">Seleccione...</option>
                                        {departamentos.map(dep => (
                                            <option key={dep.ID} value={dep.ID}>{dep.Nombre}</option>
                                        ))}
                                    </Selector>
                                </div>
                            )}

                            <div className="flex gap-3 mt-2">
                                <button onClick={handleCloseModal} className={`${BTN_SECUNDARIO} flex-1`}>
                                    Cancelar
                                </button>
                                <button onClick={handleSave} className={`${BTN_PRINCIPAL} flex-1`}>
                                    <Save size={16} /> Guardar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {ventanaConfirmar}
        </div>
    );
};

export default NomenclatorsABM;
