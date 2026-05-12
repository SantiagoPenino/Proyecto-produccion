import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import api from '../../../services/apiClient';
import WebContentList from './WebContentList';

const ConfigWebServicesModal = ({ isOpen, onClose }) => {
    const [activeTab, setActiveTab] = useState('services');
    const [services, setServices] = useState({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Load configuration when modal opens
    useEffect(() => {
        if (isOpen) {
            loadConfig();
        }
    }, [isOpen]);

    const loadConfig = async () => {
        setLoading(true);
        setError(null);
        try {
            // Reusing existing endpoint
            const res = await api.get('/web-orders/area-mapping');
            if (res.data && res.data.success) {
                processData(res.data.data);
            } else if (res.data?.data) {
                // Handling direct response format just in case
                processData(res.data.data);
            }
        } catch (err) {
            console.error(err);
            setError("Error cargando configuración.");
        } finally {
            setLoading(false);
        }
    };

    const processData = (data) => {
        const combined = {};
        const names = data.names || {};
        const visibilityData = data.visibility || {};

        Object.keys(names).forEach(code => {
            const visInfo = visibilityData[code]; // Puede ser boolean (antiguo) o Object (nuevo)

            if (typeof visInfo === 'object' && visInfo !== null) {
                // Nuevo formato: { visible, description, image }
                combined[code] = {
                    name: names[code],
                    visible: visInfo.visible !== false, // Default true si undefined
                    description: visInfo.description || '',
                    image: visInfo.image || ''
                };
            } else {
                // Formato antiguo o simple boolean
                combined[code] = {
                    name: names[code],
                    visible: visInfo !== false,
                    description: '',
                    image: ''
                };
            }
        });
        setServices(combined);
    };

    const [expandedCode, setExpandedCode] = useState(null);
    const [editForm, setEditForm] = useState({ description: '', image: '' });
    const fileInputRef = useRef(null);
    const [uploading, setUploading] = useState(false);

    const handleExpandWrapper = (code, data) => {
        if (expandedCode === code) {
            setExpandedCode(null);
        } else {
            setExpandedCode(code);
            setEditForm({
                description: data.description || '',
                image: data.image || '',
                complementarios: data.complementarios // null or array
            });
        }
    };

    const handleSaveDetails = async (code) => {
        try {
            await api.put(`/web-orders/area-mapping/${code}`, {
                description: editForm.description,
                image: editForm.image,
                complementarios: editForm.complementarios // Enviar array o null
            });


            // Also update original state structure if needed (prev[code] direct update)
            setServices(prev => ({
                ...prev,
                [code]: {
                    ...prev[code],
                    description: editForm.description,
                    image: editForm.image,
                    complementarios: editForm.complementarios
                }
            }));

            setExpandedCode(null);
        } catch (err) {
            console.error(err);
            setError("Error al guardar detalles.");
        }
    };

    const triggerFileUpload = () => {
        fileInputRef.current?.click();
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('image', file);

        try {
            const res = await api.post('/web-orders/config-image-upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });

            if (res.data && res.data.success) {
                // Construct absolute URL based on API config
                // api.defaults.baseURL usually is like "http://localhost:5000/api"
                let baseUrl = api.defaults.baseURL || '';
                if (baseUrl.endsWith('/api')) {
                    baseUrl = baseUrl.slice(0, -4); // Remove /api
                }

                // If relative URL returned (starts with /), append to base
                let finalUrl = res.data.url;
                if (finalUrl.startsWith('/')) {
                    finalUrl = `${baseUrl}${finalUrl}`;
                }

                setEditForm(prev => ({ ...prev, image: finalUrl }));
            }
        } catch (err) {
            console.error("Upload error:", err);
            setError("Error al subir imagen.");
        } finally {
            setUploading(false);
            // Reset input
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const toggleComplementario = (srvId) => {
        setEditForm(prev => {
            const currentList = prev.complementarios || ['EST', 'EMB', 'TWC', 'TWT', 'TPU']; // Default ALL if null
            if (currentList.includes(srvId)) {
                return { ...prev, complementarios: currentList.filter(id => id !== srvId) };
            } else {
                return { ...prev, complementarios: [...currentList, srvId] };
            }
        });
    };

    const toggleService = async (code, currentState) => {
        const newState = !currentState;

        // Optimistic update
        setServices(prev => ({
            ...prev,
            [code]: { ...prev[code], visible: newState }
        }));

        try {
            await api.put(`/web-orders/area-mapping/${code}`, { visible: newState });
        } catch (err) {
            console.error(err);
            setError("Error al guardar cambio.");
            // Revert
            setServices(prev => ({
                ...prev,
                [code]: { ...prev[code], visible: currentState }
            }));
        }
    };

    if (!isOpen) return null;

    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-900/50 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-zinc-200 transform transition-all scale-100 flex flex-col max-h-[90vh]">

                {/* Header */}
                <div className="bg-zinc-900 px-6 pt-4 pb-0 flex flex-col gap-4 shrink-0">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-white">
                            <div className="p-2 bg-white/10 rounded-lg">
                                <i className="fa-solid fa-globe text-amber-400"></i>
                            </div>
                            <div>
                                <h3 className="text-lg font-bold">Servicios Web</h3>
                                <p className="text-xs text-zinc-400">Configuración</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-zinc-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 p-2 rounded-full w-8 h-8 flex items-center justify-center"
                        >
                            <i className="fa-solid fa-times"></i>
                        </button>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-1 overflow-x-auto">
                        <button onClick={() => setActiveTab('services')} className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-colors border-b-2 ${activeTab === 'services' ? 'text-amber-400 border-amber-400 bg-white/5' : 'text-zinc-400 border-transparent hover:text-white'}`}>
                            Servicios
                        </button>
                        <button onClick={() => setActiveTab('sidebar')} className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-colors border-b-2 ${activeTab === 'sidebar' ? 'text-amber-400 border-amber-400 bg-white/5' : 'text-zinc-400 border-transparent hover:text-white'}`}>
                            Lat. Promocional
                        </button>
                        <button onClick={() => setActiveTab('popup')} className={`px-4 py-2 text-sm font-bold rounded-t-lg transition-colors border-b-2 ${activeTab === 'popup' ? 'text-amber-400 border-amber-400 bg-white/5' : 'text-zinc-400 border-transparent hover:text-white'}`}>
                            Popups
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto bg-zinc-50 flex-1">
                    {activeTab === 'sidebar' && <WebContentList type="SIDEBAR" />}
                    {activeTab === 'popup' && <WebContentList type="POPUP" />}

                    {activeTab === 'services' && (
                        loading ? (
                            <div className="flex justify-center py-8 text-zinc-400">
                                <i className="fa-solid fa-circle-notch fa-spin text-2xl"></i>
                            </div>
                        ) : error ? (
                            <div className="bg-red-50 text-red-600 p-4 rounded-xl text-center text-sm font-bold mb-4">
                                {error}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {Object.keys(services).length === 0 ? (
                                    <p className="text-center text-zinc-500 py-4">No hay servicios configurados.</p>
                                ) : (
                                    Object.entries(services).map(([code, data]) => (
                                        <div key={code} className={`rounded-xl border transition-all shadow-sm overflow-hidden ${data.visible ? 'bg-white border-zinc-200' : 'bg-zinc-100 border-dashed border-zinc-300 opacity-90'}`}>

                                            {/* Row Principal */}
                                            <div className="p-4 flex items-center justify-between">
                                                <div className="flex items-center gap-4 flex-1 cursor-pointer" onClick={() => handleExpandWrapper(code, data)}>
                                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-black text-xs border shrink-0 ${data.visible ? 'bg-indigo-50 text-indigo-600 border-indigo-100' : 'bg-zinc-200 text-zinc-500 border-zinc-300'}`}>
                                                        {code}
                                                    </div>
                                                    <div>
                                                        <p className={`font-bold text-sm ${data.visible ? 'text-zinc-800' : 'text-zinc-500'}`}>
                                                            {data.name}
                                                        </p>
                                                        <div className="flex gap-2 text-[10px] font-bold tracking-widest uppercase mt-0.5">
                                                            <span className={data.visible ? 'text-emerald-500' : 'text-zinc-400'}>{data.visible ? 'VISIBLE' : 'OCULTO'}</span>
                                                            {(data.description || data.image) && <span className="text-amber-500">• CON INFO EXTRA</span>}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-4">
                                                    <button
                                                        onClick={() => handleExpandWrapper(code, data)}
                                                        className={`text-zinc-400 hover:text-indigo-600 transition-colors ${expandedCode === code ? 'text-indigo-600 rotate-180' : ''}`}
                                                    >
                                                        <i className="fa-solid fa-chevron-down"></i>
                                                    </button>

                                                    {/* Toggle Switch */}
                                                    <label className="relative inline-flex items-center cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            className="sr-only peer"
                                                            checked={data.visible}
                                                            onChange={() => toggleService(code, data.visible)}
                                                        />
                                                        <div className="w-11 h-6 bg-zinc-300 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                                                    </label>
                                                </div>
                                            </div>

                                            {/* Editor Expandible */}
                                            {expandedCode === code && (
                                                <div className="bg-zinc-50 border-t border-zinc-100 p-4 animate-fade-in-down">
                                                    <div className="space-y-4">
                                                        <div>
                                                            <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">Texto Aclaratorio / Guía</label>
                                                            <textarea
                                                                className="w-full p-3 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none resize-none h-24 text-zinc-700 bg-white"
                                                                placeholder="Escribe aquí instrucciones importantes para el cliente..."
                                                                value={editForm.description}
                                                                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                                                            />
                                                        </div>

                                                        <div>
                                                            <label className="block text-xs font-bold text-zinc-500 mb-1 uppercase">URL de Imagen (Opcional)</label>
                                                            <div className="flex gap-2">
                                                                <div className="relative flex-1">
                                                                    <input
                                                                        type="text"
                                                                        className="w-full p-2 text-sm border border-zinc-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none text-zinc-700 bg-white pr-10"
                                                                        placeholder="https://..."
                                                                        value={editForm.image}
                                                                        onChange={(e) => setEditForm({ ...editForm, image: e.target.value })}
                                                                    />
                                                                    <button
                                                                        onClick={triggerFileUpload}
                                                                        disabled={uploading}
                                                                        className="absolute right-1 top-1 bottom-1 px-3 bg-zinc-100 text-zinc-600 hover:text-indigo-600 rounded-md transition-colors text-xs font-bold flex items-center gap-2 border border-zinc-200"
                                                                        title="Subir imagen desde PC"
                                                                    >
                                                                        {uploading ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-upload"></i>}
                                                                    </button>
                                                                    <input
                                                                        type="file"
                                                                        ref={fileInputRef}
                                                                        className="hidden"
                                                                        accept="image/*"
                                                                        onChange={handleFileUpload}
                                                                    />
                                                                </div>
                                                                <button
                                                                    onClick={() => handleSaveDetails(code)}
                                                                    className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 text-xs shadow-md active:scale-95 transition-transform"
                                                                >
                                                                    <i className="fa-solid fa-save mr-2"></i> GUARDAR
                                                                </button>
                                                            </div>
                                                        </div>

                                                        <div className="pt-4 border-t border-zinc-200">
                                                            <label className="block text-xs font-bold text-zinc-500 mb-2 uppercase">Servicios Complementarios Habilitados</label>
                                                            <div className="flex flex-wrap gap-2">
                                                                {[{ id: 'EST', label: 'Estampado' }, { id: 'EMB', label: 'Bordado' }, { id: 'TWC', label: 'Corte' }, { id: 'TWT', label: 'Confección' }, { id: 'TPU', label: 'TPU' }].map(srv => {
                                                                    const isEnabled = !editForm.complementarios || editForm.complementarios.includes(srv.id);
                                                                    return (
                                                                        <button
                                                                            key={srv.id}
                                                                            onClick={() => toggleComplementario(srv.id)}
                                                                            className={`px-3 py-1.5 text-xs font-bold rounded-lg border transition-all flex items-center gap-2 ${isEnabled ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-zinc-50 border-zinc-200 text-zinc-400 grayscale opacity-70'}`}
                                                                        >
                                                                            {isEnabled ? <i className="fa-solid fa-check text-indigo-500"></i> : <i className="fa-solid fa-ban"></i>}
                                                                            {srv.label}
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                            <p className="text-[10px] text-zinc-400 mt-2 italic">
                                                                Nota: Si no seleccionas ninguno, se bloquearán todos. Si es la primera vez (todos activos por defecto), puedes desactivar los que no apliquen.
                                                            </p>
                                                        </div>

                                                        {editForm.image && (
                                                            <div className="mt-2 relative h-32 w-full bg-zinc-200 rounded-lg overflow-hidden border border-zinc-300">
                                                                <img
                                                                    src={editForm.image}
                                                                    alt="Preview"
                                                                    className="absolute inset-0 w-full h-full object-cover"
                                                                    onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; }}
                                                                />
                                                                <div className="absolute inset-0 flex items-center justify-center text-zinc-400 font-bold text-xs pointer-events-none mix-blend-multiply">VISTA PREVIA</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        )
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 bg-white border-t border-zinc-100 flex justify-end shrink-0">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-zinc-900 text-white font-bold rounded-xl text-sm hover:bg-zinc-800 transition-colors shadow-lg shadow-zinc-300/50"
                    >
                        Cerrar
                    </button>
                </div>

            </div>
        </div>,
        document.body
    );
};

export default ConfigWebServicesModal;


