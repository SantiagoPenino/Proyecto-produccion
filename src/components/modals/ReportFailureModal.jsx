import React, { useState, useEffect, useRef } from 'react';
import { failuresService } from '../../services/api';

const ReportFailureModal = ({ isOpen, onClose, areaName, areaCode }) => {
    const [activeTab, setActiveTab] = useState('new');
    const [loading, setLoading] = useState(false);

    // Datos
    const [machines, setMachines] = useState([]);
    const [history, setHistory] = useState([]);

    // Autocompletado Falla (Combo Inteligente)
    const [suggestions, setSuggestions] = useState([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const dropdownRef = useRef(null);

    const [formData, setFormData] = useState({
        maquinaId: '',
        titulo: '',
        descripcion: '',
        prioridad: 'Media'
    });

    // 1. Carga Inicial
    useEffect(() => {
        if (isOpen && areaCode) {
            loadMachines();
            // Cargar sugerencias iniciales (las más frecuentes)
            loadSuggestions('');
            setActiveTab('new');
        }
    }, [isOpen, areaCode]);

    // 2. Cargar Historial al cambiar tab
    useEffect(() => {
        if (isOpen && activeTab === 'history') loadHistory();
    }, [activeTab, isOpen]);

    const loadMachines = async () => {
        try {
            const data = await failuresService.getMachines(areaCode);
            setMachines(data);
        } catch (e) { console.error(e); }
    };

    const loadHistory = async () => {
        setLoading(true);
        try {
            const data = await failuresService.getHistory(areaCode);
            setHistory(data);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    const loadSuggestions = async (query) => {
        try {
            const results = await failuresService.searchTitles(query, areaCode);
            setSuggestions(results);
        } catch (e) { }
    };

    // --- LÓGICA COMBOBOX (Igual que Insumos) ---
    const handleTitleInput = (e) => {
        const val = e.target.value;
        setFormData({ ...formData, titulo: val });
        loadSuggestions(val);
        setShowDropdown(true);
    };

    const selectTitle = (title) => {
        setFormData({ ...formData, titulo: title });
        setShowDropdown(false);
    };

    const createNewFailureType = async () => {
        if (!formData.titulo) return;

        setLoading(true);
        try {
            await failuresService.createType({
                areaId: areaCode,
                titulo: formData.titulo
            });

            alert(`✅ "${formData.titulo}" agregado al catálogo.`);
            setShowDropdown(false);
            // Recargar sugerencias para que ya aparezca como existente
            loadSuggestions(formData.titulo);
        } catch (error) {
            alert("Error al agregar al catálogo: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    // Cerrar dropdown click fuera
    useEffect(() => {
        const handleClick = (e) => { if (dropdownRef.current && !dropdownRef.current.contains(e.target)) setShowDropdown(false); };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);


    const handleSubmit = async () => {
        if (!formData.maquinaId || !formData.titulo) {
            alert("Seleccione máquina y tipo de falla.");
            return;
        }

        setLoading(true);
        try {
            await failuresService.create({
                ...formData,
                reportadoPor: 'Operario'
            });

            alert("✅ Ticket creado.");
            setFormData({ maquinaId: '', titulo: '', descripcion: '', prioridad: 'Media' });
            setActiveTab('history');
            loadHistory();
        } catch (error) {
            alert("Error creando ticket");
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    // -- Clases Reutilizables --
    const inputClass = "w-full px-3 py-2 border border-red-200 rounded-lg text-sm text-zinc-800 bg-white outline-none focus:border-red-500 focus:ring-2 focus:ring-red-500/10 transition-all placeholder:text-zinc-400";
    const labelClass = "block mb-1.5 text-xs font-bold text-zinc-500 uppercase tracking-wide";
    const tabBtnClass = (active) => `px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${active ? 'text-red-600 border-red-600 bg-red-50/50' : 'text-zinc-500 border-transparent hover:text-zinc-700 hover:bg-zinc-50'}`;

    return (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-zinc-900/60 p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border-t-4 border-red-500">

                {/* HEADER ROJO */}
                <div className="px-6 py-4 bg-red-50 border-b border-red-100 flex justify-between items-center shrink-0">
                    <div className="flex flex-col">
                        <h2 className="text-lg font-bold text-red-700 flex items-center gap-2">
                            <i className="fa-solid fa-triangle-exclamation"></i> Reporte de Falla: {areaName}
                        </h2>
                        <div className="flex gap-1 mt-3 -mb-4">
                            <button className={tabBtnClass(activeTab === 'new')} onClick={() => setActiveTab('new')}>Nuevo Reporte</button>
                            <button className={tabBtnClass(activeTab === 'history')} onClick={() => setActiveTab('history')}>Historial</button>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-red-400 hover:bg-red-100 hover:text-red-700 transition-colors">
                        <i className="fa-solid fa-xmark text-lg"></i>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6 bg-white">

                    {activeTab === 'new' && (
                        <div className="flex flex-col gap-5">

                            {/* 1. MÁQUINA (Select Fijo) */}
                            <div>
                                <label className={labelClass}>Máquina Afectada</label>
                                <select
                                    className={inputClass}
                                    value={formData.maquinaId}
                                    onChange={(e) => setFormData({ ...formData, maquinaId: e.target.value })}
                                >
                                    <option value="">-- Seleccionar Equipo --</option>
                                    {machines.map(m => (
                                        <option key={m.MaquinaID} value={m.MaquinaID}>{m.Nombre}</option>
                                    ))}
                                </select>
                            </div>

                            {/* 2. TÍTULO FALLA (Combo Inteligente) */}
                            <div className="relative" ref={dropdownRef}>
                                <label className={labelClass}>Tipo de Falla</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        className={`${inputClass} font-bold`}
                                        placeholder="Buscar o escribir nueva..."
                                        value={formData.titulo}
                                        onChange={handleTitleInput}
                                        onFocus={() => { loadSuggestions(formData.titulo); setShowDropdown(true); }}
                                        autoComplete="off"
                                    />
                                    <i className="fa-solid fa-chevron-down absolute right-3 top-2.5 text-zinc-400 pointer-events-none"></i>
                                </div>

                                {showDropdown && (
                                    <ul className="absolute top-[105%] left-0 w-full bg-white border border-zinc-200 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto divide-y divide-zinc-50 animate-in slide-in-from-top-1">
                                        {suggestions.length > 0 ? (
                                            suggestions.map((s, i) => (
                                                <li key={i} onClick={() => selectTitle(s.Titulo)} className="px-4 py-3 cursor-pointer hover:bg-red-50 flex justify-between items-center text-sm text-zinc-700 transition-colors">
                                                    <span className="font-semibold">{s.Titulo}</span>
                                                    {/* Badge opcional para frecuentes */}
                                                    {s.EsFrecuente && <span className="text-[10px] font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full uppercase tracking-wider">Común</span>}
                                                </li>
                                            ))
                                        ) : (
                                            <li className="p-3 text-center text-red-600 font-bold bg-red-50 hover:bg-red-100 cursor-pointer transition-colors" onClick={createNewFailureType}>
                                                <div className="flex flex-col items-center gap-1">
                                                    <i className="fa-solid fa-plus-circle text-lg"></i>
                                                    <div>
                                                        Agregar <strong className="underline">"{formData.titulo}"</strong> al catálogo
                                                    </div>
                                                    <div className="text-red-400 text-xs font-normal">Se guardará para futuros reportes</div>
                                                </div>
                                            </li>
                                        )}
                                    </ul>
                                )}
                            </div>

                            {/* 3. PRIORIDAD (Stepper Visual) */}
                            <div>
                                <label className={labelClass}>Prioridad</label>
                                <div className="flex bg-zinc-100 p-1 rounded-lg gap-1">
                                    {['Baja', 'Media', 'Alta', 'Crítica'].map((prio, idx) => (
                                        <div
                                            key={prio}
                                            className={`flex-1 flex flex-col items-center justify-center py-2 rounded-md cursor-pointer transition-all ${formData.prioridad === prio
                                                    ? (prio === 'Crítica' ? 'bg-red-700 text-white shadow-md' :
                                                        prio === 'Alta' ? 'bg-red-500 text-white shadow-md' :
                                                            prio === 'Media' ? 'bg-yellow-500 text-white shadow-md' :
                                                                'bg-green-500 text-white shadow-md')
                                                    : 'text-zinc-400 hover:bg-white/50'
                                                }`}
                                            onClick={() => setFormData({ ...formData, prioridad: prio })}
                                        >
                                            <div className="text-[10px] opacity-70 mb-0.5">{idx + 1}</div>
                                            <span className="text-xs font-bold uppercase tracking-wide">{prio}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className={labelClass}>Descripción Adicional (Opcional)</label>
                                <textarea className={`${inputClass} min-h-[80px]`} placeholder="Detalles específicos para el técnico..." value={formData.descripcion} onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}></textarea>
                            </div>

                            <div className="flex justify-end pt-4 border-t border-zinc-100">
                                <button onClick={onClose} className="px-4 py-2 mr-2 text-zinc-500 hover:text-zinc-800 font-semibold transition-colors">Cancelar</button>
                                <button className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg shadow-lg shadow-red-500/30 transition-all flex items-center gap-2" onClick={handleSubmit} disabled={loading}>
                                    {loading ? 'Procesando...' : <><i className="fa-solid fa-triangle-exclamation"></i> Crear Ticket</>}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* VISTA HISTORIAL */}
                    {activeTab === 'history' && (
                        <div className="border border-zinc-200 rounded-lg overflow-hidden">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-zinc-50 text-zinc-500 font-semibold border-b border-zinc-200 text-xs uppercase tracking-wide">
                                    <tr><th className="p-3">Fecha</th><th className="p-3">Falla / Equipo</th><th className="p-3">Estado</th></tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {history.length === 0 ? (
                                        <tr><td colSpan="3" className="p-8 text-center text-zinc-400 italic">Sin historial reciente.</td></tr>
                                    ) : (
                                        history.map(t => (
                                            <tr key={t.TicketID} className="hover:bg-zinc-50 transition-colors">
                                                <td className="p-3 text-zinc-500">{new Date(t.FechaReporte).toLocaleDateString()}</td>
                                                <td className="p-3">
                                                    <div className="font-bold text-zinc-800">{t.Titulo}</div>
                                                    <div className="text-xs text-zinc-500 flex items-center gap-1"><i className="fa-solid fa-server text-[10px]"></i> {t.MaquinaNombre}</div>
                                                </td>
                                                <td className="p-3">
                                                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border ${t.Estado === 'Abierto' ? 'bg-red-50 text-red-600 border-red-100' : 'bg-zinc-100 text-zinc-500 border-zinc-200'
                                                        }`}>
                                                        {t.Estado}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
};

export default ReportFailureModal;
