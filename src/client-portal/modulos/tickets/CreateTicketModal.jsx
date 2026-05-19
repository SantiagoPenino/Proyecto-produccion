import React, { useState, useEffect } from 'react';
import { Dialog } from '@headlessui/react';
import { X, UploadCloud, AlertCircle, Loader2 } from 'lucide-react';
import { apiClient } from '../../api/apiClient';
import { CustomButton } from '../../pautas/CustomButton';
import { CustomSelect } from '../../pautas/CustomSelect';

export default function CreateTicketModal({ isOpen, onClose, onCreated }) {
    const [asunto, setAsunto] = useState('');
    const [descripcion, setDescripcion] = useState('');
    const [departamentoId, setDepartamentoId] = useState('');
    const [ordenId, setOrdenId] = useState('');
    const [archivos, setArchivos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const [departamentos, setDepartamentos] = useState([]);
    const [ordenes, setOrdenes] = useState([]);

    useEffect(() => {
        if (!isOpen) return;
        setAsunto('');
        setDescripcion('');
        setDepartamentoId('');
        setOrdenId('');
        setArchivos([]);
        setErrorMsg('');
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            apiClient.get('/tickets/categorias')
                .then(res => {
                    if (res.success) setDepartamentos(res.data || []);
                })
                .catch(err => console.error(err));
                
            apiClient.get('/web-orders/my-orders')
                .then(res => {
                    if (res.success && res.data) {
                        setOrdenes(res.data.slice(0, 10));
                    }
                })
                .catch(err => console.error(err));
        }
    }, [isOpen]);

    const handleFileChange = (e) => {
        const files = Array.from(e.target.files);
        const validFiles = files.filter(f => f.size <= 5 * 1024 * 1024);
        if (validFiles.length !== files.length) {
            setErrorMsg('Algunos archivos superan el límite de 5MB y no fueron agregados.');
        } else {
            setErrorMsg('');
        }
        setArchivos(prev => [...prev, ...validFiles].slice(0, 5));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMsg('');
        
        if (!asunto.trim() || !descripcion.trim() || !departamentoId) {
            setErrorMsg('Por favor completá los campos obligatorios (*).');
            return;
        }

        setLoading(true);
        try {
            const formData = new FormData();
            formData.append('asunto', asunto);
            formData.append('descripcion', descripcion);
            formData.append('departamentoId', departamentoId);
            
            if (ordenId && ordenId !== 'otra') {
                formData.append('ordenId', ordenId);
            }

            archivos.forEach(file => {
                formData.append('evidencia', file);
            });

            const data = await apiClient.postFormData('/tickets', formData);
            if (data.success) {
                onCreated();
            } else {
                setErrorMsg(data.error || 'Error al crear el ticket.');
            }
        } catch (error) {
            setErrorMsg('Error de conexión.');
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    return (
        <Dialog open={isOpen} onClose={!loading ? onClose : () => {}} className="relative z-[10000]">
            <div className="fixed inset-0 bg-black/80" aria-hidden="true" />
            <div className="fixed inset-0 flex items-center justify-center p-0 md:p-4">
                <Dialog.Panel className="flex flex-col w-full h-[100dvh] md:h-auto max-w-2xl transform overflow-y-auto md:rounded-2xl bg-[#0d0d0d] sm:bg-zinc-900 border-y sm:border border-zinc-800 p-5 sm:p-6 text-left shadow-2xl transition-all">
                    
                    <div className="flex justify-between items-center mb-6 shrink-0">
                        <Dialog.Title as="h3" className="text-xl font-bold leading-6 text-zinc-100 uppercase">
                            Nueva <span className="text-custom-cyan">Consulta o Reclamo</span>
                        </Dialog.Title>
                        <button type="button" onClick={onClose} disabled={loading} className="text-zinc-500 hover:text-white transition-colors">
                            <X size={24} />
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-4">
                        
                        <div className="relative z-30">
                            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Departamento *</label>
                            <CustomSelect
                                value={departamentoId}
                                onChange={setDepartamentoId}
                                placeholder="Selecciona el Area..."
                                options={departamentos.map(d => ({ value: String(d.ID), label: d.Nombre }))}
                                disabled={loading}
                                className="w-full"
                            />
                        </div>
                        
                        <div className="relative z-20">
                            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Orden Asociada (Opcional)</label>
                            <CustomSelect
                                value={ordenId}
                                onChange={setOrdenId}
                                placeholder="Selecciona Pedido"
                                options={[
                                    ...ordenes.map(o => ({ value: String(o.OrdenID), label: o.CodigoOrden || o.NoDocERP || String(o.OrdenID) })),
                                    { value: 'otra', label: 'Otra...' }
                                ]}
                                disabled={loading}
                                className="w-full"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Asunto / Resumen *</label>
                            <input 
                                type="text"
                                placeholder="Ej. Faltaron metros de tela en el pedido / Pago no verificado"
                                className="w-full bg-zinc-800/50 border border-zinc-700 text-white rounded-lg p-3 text-sm focus:ring-1 focus:ring-custom-cyan outline-none"
                                value={asunto}
                                onChange={(e) => setAsunto(e.target.value)}
                                disabled={loading}
                                maxLength={200}
                            />
                        </div>

                        <div className="flex flex-col flex-1">
                            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Descripción Detallada *</label>
                            <textarea 
                                className="w-full flex-1 bg-zinc-800/50 border border-zinc-700 text-white rounded-lg p-3 text-sm focus:ring-1 focus:ring-custom-cyan outline-none resize-none min-h-[120px]"
                                placeholder="Describí tu problema al detalle para que el equipo pueda resolverlo lo antes posible..."
                                value={descripcion}
                                onChange={(e) => setDescripcion(e.target.value)}
                                disabled={loading}
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-2">Adjuntar fotos o archivos (Opcional)</label>
                            <div className="relative border-2 border-dashed border-zinc-700 rounded-lg p-6 hover:border-custom-cyan/50 transition-colors bg-zinc-800/30 text-center">
                                <input 
                                    type="file" 
                                    multiple
                                    accept="image/*,.pdf"
                                    onChange={handleFileChange}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                    disabled={loading}
                                />
                                <UploadCloud className="mx-auto h-6 w-6 text-zinc-500 mb-2" />
                                <div className="text-sm text-zinc-400">
                                    <span className="font-semibold text-custom-cyan">Presioná para subir</span> o arrastrá
                                </div>
                                <p className="text-[10px] uppercase font-bold text-zinc-500 mt-1">PNG, JPG o PDF hasta 5MB</p>
                            </div>
                            {archivos.length > 0 && (
                                <div className="mt-2 text-xs text-brand-cyan font-medium">
                                    {archivos.length} archivo(s) seleccionado(s).
                                </div>
                            )}
                        </div>

                        {errorMsg && (
                            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-lg text-sm shrink-0">
                                <AlertCircle size={16} /> {errorMsg}
                            </div>
                        )}

                        <div className="mt-auto shrink-0 flex w-full gap-3 pt-4 border-t border-zinc-800">
                            <button
                                type="button"
                                onClick={onClose}
                                disabled={loading}
                                className="w-1/2 py-3 rounded-lg text-sm font-semibold text-zinc-400 bg-zinc-800/50 hover:bg-zinc-800 hover:text-white transition-colors"
                            >
                                Cancelar
                            </button>
                            <button 
                                type="submit" 
                                disabled={loading} 
                                className="w-1/2 flex items-center justify-center gap-2 border border-brand-cyan text-brand-cyan text-sm font-semibold hover:bg-brand-cyan/10 transition-all shadow-[0_0_12px_rgba(6,182,212,0.2)] hover:shadow-[0_0_18px_rgba(6,182,212,0.35)] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg py-3"
                                style={{
                                    background: 'rgba(0, 174, 239, 0.08)'
                                }}
                            >
                                {loading && <Loader2 size={16} className="animate-spin" />}
                                {loading ? 'Enviando...' : 'Crear Ticket'}
                            </button>
                        </div>
                    </form>
                </Dialog.Panel>
            </div>
        </Dialog>
    );
}
