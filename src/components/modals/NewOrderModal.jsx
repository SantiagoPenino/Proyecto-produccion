import React, { useState, useEffect } from 'react';
import { ordersService, stockService, areasService } from '../../services/api';
import axios from 'axios';

// Componente botón Drive
const DriveButton = () => (
    <button type="button" className="flex items-center gap-2 px-3 py-2 bg-white border border-zinc-300 rounded-lg text-zinc-600 text-sm font-semibold hover:bg-zinc-50 hover:text-green-600 hover:border-green-500 transition-all" onClick={() => window.open('https://drive.google.com', '_blank')}>
        <i className="fa-brands fa-google-drive text-lg text-green-500"></i> Abrir Drive
    </button>
);

const NewOrderModal = ({ isOpen, onClose, areaName, areaCode }) => {
    const [activeTab, setActiveTab] = useState('info');
    const [loading, setLoading] = useState(false);

    // Datos Maestros
    const [prioritiesConfig, setPrioritiesConfig] = useState([]);
    const [availableAreas, setAvailableAreas] = useState([]);

    // Estados del Formulario
    const [orderData, setOrderData] = useState({
        cliente: '',
        descripcion: '',
        prioridad: 'Normal',
        material: '',
        magnitud: '0.00m', // Se calculará automático
        fechaEntrega: '',
        nota: ''
    });

    // Clientes Combo
    const [clientSuggestions, setClientSuggestions] = useState([]);
    const [showClientDropdown, setShowClientDropdown] = useState(false);

    // Materiales
    const [materials, setMaterials] = useState([]);
    const [matSearch, setMatSearch] = useState('');
    const [matQty, setMatQty] = useState(1);
    const [matSuggestions, setMatSuggestions] = useState([]);

    // Flujo
    const [workflow, setWorkflow] = useState([]);

    // Archivos
    const [files, setFiles] = useState([]);
    const [newFile, setNewFile] = useState({
        nombre: '',
        link: '',
        tipo: 'Impresión', // Tipo por defecto más común
        copias: 1,
        metros: 0
    });

    // Configuración de archivos requeridos según área
    const fileReqs = [
        { type: 'Impresión', label: 'Impresión', required: true },
        { type: 'Boceto', label: 'Boceto', required: false },
        { type: 'Guía', label: 'Guía', required: false }
    ];

    // 1. CARGA INICIAL
    useEffect(() => {
        if (isOpen && areaCode) {
            loadConfig();
            // Reset completo al abrir
            setOrderData({ cliente: '', descripcion: '', prioridad: 'Normal', material: '', magnitud: '0.00m', fechaEntrega: '', nota: '' });
            setFiles([]);
            setMaterials([]);
            setWorkflow([]);
            setActiveTab('info');
        }
    }, [isOpen, areaCode]);

    // 2. CÁLCULO AUTOMÁTICO DE MAGNITUD
    // Cada vez que cambia la lista de archivos, recalculamos el total
    useEffect(() => {
        const totalMetros = files.reduce((acc, file) => {
            return acc + (parseFloat(file.metros || 0) * parseInt(file.copias || 1));
        }, 0);

        // Actualizamos el campo magnitud visualmente
        setOrderData(prev => ({
            ...prev,
            magnitud: totalMetros > 0 ? `${totalMetros.toFixed(2)}m` : ''
        }));
    }, [files]);

    const loadConfig = async () => {
        try {
            const responsePrio = await ordersService.getPriorities(areaCode);
            setPrioritiesConfig(responsePrio);
            const responseAreas = await areasService.getAll();
            setAvailableAreas(responseAreas.filter(a => a.code !== areaCode));
        } catch (e) { console.error(e); }
    };

    // --- CLIENTES ---
    const handleClientSearch = async (val) => {
        setOrderData({ ...orderData, cliente: val });
        if (val.length > 1) {
            try {
                // Asumiendo ruta directa o servicio
                // const res = await clientsService.search(val); 
                // setClientSuggestions(res);
                // setShowClientDropdown(true);
            } catch (e) { }
        } else setShowClientDropdown(false);
    };

    // --- ARCHIVOS ---
    const addFileToList = () => {
        if (!newFile.nombre || !newFile.link) return alert("Nombre y Link son obligatorios");
        if (newFile.metros <= 0 && newFile.tipo === 'Impresión') return alert("Indica la medida del archivo");

        setFiles([...files, { ...newFile, id: Date.now() }]);
        // Resetear inputs, manteniendo el link por si sube varios del mismo folder
        setNewFile({ ...newFile, nombre: '', copias: 1, metros: 0 });
    };

    const removeFile = (id) => {
        setFiles(files.filter(f => f.id !== id));
    };

    // --- SUBMIT ---
    const handleSubmit = async () => {
        if (!orderData.cliente || !orderData.descripcion) return alert("Faltan datos básicos");

        // Validar si hay archivos de impresión
        if (files.length === 0) {
            const confirmNoFiles = confirm("⚠️ No has cargado archivos. ¿Crear orden sin archivos?");
            if (!confirmNoFiles) return setActiveTab('files');
        }

        setLoading(true);
        try {
            const payload = {
                areaId: areaCode,
                clienteNombre: orderData.cliente,
                ...orderData, // Incluye la magnitud calculada
                materiales: materials,
                flujo: workflow,
                archivos: files
            };

            await ordersService.create(payload);
            alert("✅ Orden creada con éxito");
            onClose();
        } catch (error) {
            alert("Error: " + error.message);
        } finally { setLoading(false); }
    };

    if (!isOpen) return null;

    // -- Clases Tailwind Reutilizables --
    const inputClass = "w-full px-3 py-2 border border-zinc-300 rounded-lg text-sm text-zinc-800 bg-white outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all placeholder:text-zinc-400";
    const labelClass = "block mb-1.5 text-xs font-bold text-zinc-500 uppercase tracking-wide";
    const tabBtnClass = (active) => `px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${active ? 'text-blue-600 border-blue-600 bg-blue-50/50' : 'text-zinc-500 border-transparent hover:text-zinc-700 hover:bg-zinc-50'}`;

    return (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-zinc-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 duration-300">

                {/* HEADER */}
                <div className="px-6 py-4 bg-zinc-50 border-b border-zinc-200 flex justify-between items-center shrink-0">
                    <div className="flex flex-col">
                        <h2 className="text-lg font-bold text-zinc-800 flex items-center gap-2">
                            <i className="fa-solid fa-plus-circle text-blue-500"></i> Nueva Orden: {areaName}
                        </h2>
                        <div className="flex gap-1 mt-3 -mb-4">
                            <button className={tabBtnClass(activeTab === 'info')} onClick={() => setActiveTab('info')}>Información</button>
                            <button className={tabBtnClass(activeTab === 'files')} onClick={() => setActiveTab('files')}>
                                Archivos ({files.length})
                            </button>
                            <button className={tabBtnClass(activeTab === 'mats')} onClick={() => setActiveTab('mats')}>Materiales</button>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-red-50 hover:text-red-500 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                {/* CONTENT */}
                <div className="flex-1 overflow-y-auto p-6 bg-white">

                    {/* TAB 1: INFO */}
                    {activeTab === 'info' && (
                        <div className="flex flex-col gap-5">
                            <div className="flex gap-4">
                                <div className="flex-[2]">
                                    <label className={labelClass}>Cliente</label>
                                    <div className="relative">
                                        <i className="fa-solid fa-user absolute left-3 top-2.5 text-zinc-400"></i>
                                        <input type="text" className={`${inputClass} pl-9 font-bold`} placeholder="Buscar cliente..."
                                            value={orderData.cliente} onChange={(e) => handleClientSearch(e.target.value)} autoFocus />
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <label className={labelClass}>Total Calculado</label>
                                    <input type="text" readOnly
                                        className={`${inputClass} font-black text-center text-blue-600 bg-blue-50 border-blue-200`}
                                        value={orderData.magnitud}
                                        placeholder="Suma archivos"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className={labelClass}>Descripción del Trabajo</label>
                                <input type="text" className={inputClass} placeholder="Ej: 50 Remeras Logo Espalda" value={orderData.descripcion} onChange={e => setOrderData({ ...orderData, descripcion: e.target.value })} />
                            </div>

                            <div>
                                <label className={labelClass}>Material</label>
                                <div className="relative">
                                    <i className="fa-solid fa-layer-group absolute left-3 top-2.5 text-zinc-400"></i>
                                    <input type="text" className={`${inputClass} pl-9`} placeholder="Ej: DTF UV, DryFit..." value={orderData.material} onChange={e => setOrderData({ ...orderData, material: e.target.value })} />
                                </div>
                            </div>

                            <div>
                                <label className={labelClass}>Prioridad</label>
                                <div className="flex bg-zinc-100 p-1 rounded-lg gap-1">
                                    {['Normal', 'Alta', 'Urgente'].map((prio) => (
                                        <div key={prio}
                                            className={`flex-1 text-center py-2 rounded-md text-sm font-bold cursor-pointer transition-all ${orderData.prioridad === prio
                                                    ? (prio === 'Urgente' ? 'bg-red-500 text-white shadow-md shadow-red-500/30' :
                                                        prio === 'Alta' ? 'bg-orange-500 text-white shadow-md shadow-orange-500/30' :
                                                            'bg-white text-zinc-700 shadow-sm')
                                                    : 'text-zinc-500 hover:bg-white/50'
                                                }`}
                                            onClick={() => setOrderData({ ...orderData, prioridad: prio })}
                                        >
                                            {prio}
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className={labelClass}>Notas Internas</label>
                                <textarea className={`${inputClass} min-h-[80px]`} placeholder="Observaciones importantes para producción..." value={orderData.nota} onChange={e => setOrderData({ ...orderData, nota: e.target.value })}></textarea>
                            </div>
                        </div>
                    )}

                    {/* TAB 2: ARCHIVOS CON MEDIDAS */}
                    {activeTab === 'files' && (
                        <div className="flex flex-col h-full">

                            <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-4 mb-6 relative overflow-hidden">
                                <div className="absolute top-0 left-0 w-1 h-full bg-blue-500"></div>
                                <h4 className="text-sm font-bold text-zinc-700 mb-3 flex items-center gap-2">
                                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xs"><i className="fa-solid fa-plus"></i></span>
                                    Agregar Archivo
                                </h4>

                                <div className="flex gap-3 mb-3">
                                    <div className="flex-[2]">
                                        <label className="text-[10px] font-bold text-zinc-500 uppercase mb-1 block">Nombre Archivo</label>
                                        <input type="text" className={inputClass} placeholder="Ej: logo_final.pdf"
                                            value={newFile.nombre} onChange={e => setNewFile({ ...newFile, nombre: e.target.value })}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <label className="text-[10px] font-bold text-zinc-500 uppercase mb-1 block">Tipo</label>
                                        <select className={inputClass} value={newFile.tipo} onChange={e => setNewFile({ ...newFile, tipo: e.target.value })}>
                                            {fileReqs.map(req => <option key={req.type} value={req.type}>{req.type}</option>)}
                                            <option value="General">General</option>
                                        </select>
                                    </div>
                                </div>

                                <div className="mb-3">
                                    <label className="text-[10px] font-bold text-zinc-500 uppercase mb-1 block">Enlace (Drive/Nube)</label>
                                    <div className="flex gap-2">
                                        <input type="text" className={inputClass} placeholder="Pegar enlace de Google Drive o Dropbox..."
                                            value={newFile.link} onChange={e => setNewFile({ ...newFile, link: e.target.value })}
                                        />
                                        <DriveButton />
                                    </div>
                                </div>

                                <div className="flex items-end gap-3">
                                    <div className="w-24">
                                        <label className="text-[10px] font-bold text-zinc-500 uppercase mb-1 block">Copias</label>
                                        <input type="number" min="1" className={`${inputClass} text-center font-bold`} value={newFile.copias} onChange={e => setNewFile({ ...newFile, copias: e.target.value })} />
                                    </div>
                                    <div className="w-32">
                                        <label className="text-[10px] font-bold text-blue-600 uppercase mb-1 block">Largo (m)</label>
                                        <input type="number" step="0.1" className={`${inputClass} text-center font-bold border-blue-200 bg-blue-50 text-blue-700 placeholder:text-blue-300`}
                                            placeholder="0.00"
                                            value={newFile.metros} onChange={e => setNewFile({ ...newFile, metros: e.target.value })}
                                        />
                                    </div>
                                    <div className="flex-1 pb-2 pl-2 text-xs font-bold text-zinc-500">
                                        Subtotal: <span className="text-blue-600">{(newFile.copias * newFile.metros).toFixed(2)}m</span>
                                    </div>
                                    <button className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-lg shadow-blue-500/30 transition-all flex items-center gap-2 mb-[1px]" onClick={addFileToList}>
                                        <i className="fa-solid fa-plus"></i> Agregar
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 border border-zinc-200 rounded-lg overflow-hidden bg-white shadow-sm">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-zinc-50 text-zinc-500 font-semibold border-b border-zinc-200 text-xs uppercase tracking-wide">
                                        <tr>
                                            <th className="p-3">Archivo</th>
                                            <th className="p-3">Tipo</th>
                                            <th className="p-3 text-center">Cant.</th>
                                            <th className="p-3 text-center">Medida</th>
                                            <th className="p-3 text-right">Subtotal</th>
                                            <th className="p-3 w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100">
                                        {files.map(f => (
                                            <tr key={f.id} className="hover:bg-zinc-50/80 transition-colors">
                                                <td className="p-3 font-semibold text-zinc-700">{f.nombre}</td>
                                                <td className="p-3"><span className="px-2 py-1 rounded text-xs font-bold bg-zinc-100 text-zinc-500 border border-zinc-200">{f.tipo}</span></td>
                                                <td className="p-3 text-center font-medium text-zinc-600">{f.copias}</td>
                                                <td className="p-3 text-center text-zinc-500">{f.metros}m</td>
                                                <td className="p-3 text-right font-bold text-blue-600">
                                                    {(f.copias * f.metros).toFixed(2)}m
                                                </td>
                                                <td className="p-3 text-center">
                                                    <button onClick={() => removeFile(f.id)} className="w-8 h-8 rounded hover:bg-red-50 text-zinc-400 hover:text-red-500 transition-colors"><i className="fa-solid fa-trash"></i></button>
                                                </td>
                                            </tr>
                                        ))}
                                        {files.length === 0 && (
                                            <tr>
                                                <td colSpan="6" className="p-8 text-center text-zinc-400 italic">
                                                    <div className="mb-2 text-2xl opacity-20"><i className="fa-solid fa-file-circle-plus"></i></div>
                                                    Agrega archivos para calcular el total.
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* TAB 3: MATERIALES */}
                    {activeTab === 'mats' && (
                        <div className="flex flex-col items-center justify-center h-40 text-zinc-400">
                            <i className="fa-solid fa-box-open text-3xl mb-3 opacity-30"></i>
                            <p>Funcionalidad de materiales ya implementada anteriormente.</p>
                        </div>
                    )}

                </div>

                {/* FOOTER */}
                <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-200 flex justify-end items-center gap-4 shrink-0">
                    <div className="mr-auto font-bold text-zinc-500 text-sm">
                        Total Orden: <span className="text-xl text-blue-600 ml-2">{orderData.magnitud}</span>
                    </div>

                    <button onClick={onClose} className="px-5 py-2.5 rounded-lg border border-zinc-300 text-zinc-600 font-bold hover:bg-zinc-100 transition-colors">
                        Cancelar
                    </button>
                    <button
                        className={`px-6 py-2.5 rounded-lg font-bold text-white shadow-lg transition-all flex items-center gap-2 ${loading ? 'bg-zinc-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700 hover:-translate-y-0.5 shadow-blue-500/30'}`}
                        onClick={handleSubmit}
                        disabled={loading}
                    >
                        {loading ? (
                            <><i className="fa-solid fa-circle-notch fa-spin"></i> Guardando...</>
                        ) : (
                            <><i className="fa-solid fa-check"></i> Crear Orden</>
                        )}
                    </button>
                </div>

            </div>
        </div>
    );
};

export default NewOrderModal;

