import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../../services/api';
import { logisticsService } from '../../services/modules/logisticsService';
import { toast } from 'sonner';

import {
    Truck, RefreshCw, Search, Tag, Clock, Printer,
    ListChecks, Navigation, History, FileDown, FileImage,
    File, Camera, X, PackageCheck, Loader2, Plus, Trash2
} from 'lucide-react';

const TransportView = () => {
    const [transports, setTransports] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('ACTIVE'); // 'ACTIVE' | 'ALL'
    const [filterTipo, setFilterTipo] = useState('TODOS'); // 'TODOS' | 'PRODUCCION' | 'ENCOMIENDA'

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await logisticsService.getActiveTransports();
            setTransports(data);
        } catch (error) {
            console.error(error);
            toast.error('Error al cargar transportes');
        } finally {
            setLoading(false);
        }
    };

    // MODAL STATE
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalData, setModalData] = useState(null);
    const [bultoMappings, setBultoMappings] = useState({}); // { [bultoId]: { checked: boolean, file: File | null } }
    const [activeBultoId, setActiveBultoId] = useState(null);
    const hiddenFileInputRef = useRef(null);

    const openUploadModal = async (transport) => {
        setLoading(true);
        try {
            const details = await logisticsService.getRemitoByCode(transport.CodigoRemito);
            
            const initialMap = {};
            details.items.forEach(i => {
                if (i.BultoEstado !== 'ENTREGADO') {
                    initialMap[i.BultoID] = { checked: false, file: null };
                }
            });
            setModalData({ transport, items: details.items });
            setBultoMappings(initialMap);
            setIsModalOpen(true);
        } catch (err) {
            console.error(err);
            toast.error('Error al cargar detalle del remito');
        } finally {
            setLoading(false);
        }
    };

    const handleFileSelected = (e) => {
        const file = e.target.files[0];
        if (file && activeBultoId) {
            setBultoMappings(prev => ({
                ...prev,
                [activeBultoId]: { ...prev[activeBultoId], file, checked: true }
            }));
        }
        e.target.value = null; // reset
        setActiveBultoId(null);
    };

    const handleConfirmDelivery = async () => {
        const checkedBultos = Object.entries(bultoMappings).filter(([k, v]) => v.checked);
        if (checkedBultos.length === 0) return toast.error('Debes seleccionar al menos un bulto');

        setLoading(true);
        try {
            // Send sequentially (1 file per bulto)
            for (const [bultoId, map] of checkedBultos) {
                const formData = new FormData();
                if (map.file) {
                    formData.append('comprobante', map.file);
                }
                formData.append('bultosIds', JSON.stringify([parseInt(bultoId)]));
                // Incluir la orden de retiro asociada para el nombre del archivo
                const itemRef = modalData.items.find(i => i.BultoID === parseInt(bultoId));
                formData.append('ordenDeRetiro', itemRef?.RetiroAsociado || itemRef?.CodigoEtiqueta || '');
                
                await logisticsService.confirmDeliveryWithProof(modalData.transport.CodigoRemito, formData);
            }

            toast.success('Entregas procesadas con éxito ✅');
            setIsModalOpen(false);
            loadData();
        } catch (error) {
            console.error(error);
            toast.error('Error al procesar entregas');
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = async (transport) => {
        try {
            const resApi = await api.get('/apiordenesRetiro/remito/' + transport.CodigoRemito);
            const sel = resApi.data;
            
            if (!sel || sel.length === 0) {
                return toast.warning('No se encontraron órdenes en este remito para imprimir.');
            }
            
            const remitoCode = transport.CodigoRemito;
            const fecha = new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' });
            const grupos = {};
            sel.forEach(enc => {
                const agKey = enc.agenciaNombre || enc.lugarRetiro || 'Sin Agencia / Retiro Local';
                if (!grupos[agKey]) grupos[agKey] = [];
                grupos[agKey].push(enc);
            });

            const renderFila = (enc) => {
                const ordenesList = (enc.orders || []).map((o, i) =>
                    `<tr>
                        <td style="padding:5px 8px;font-size:12px;">${i + 1}</td>
                        <td style="padding:5px 8px;font-size:12px;font-weight:700;">${o.orderNumber || '-'}</td>
                        <td style="padding:5px 8px;font-size:12px;color:#475569;">${o.orderEstado || '-'}</td>
                        <td style="padding:5px 8px;font-size:12px;text-align:right;font-weight:700;color:#0070bc;">${o.orderCosto || '-'}</td>
                    </tr>`).join('');
                
                const ordTable = enc.orders?.length > 0
                    ? `<table style="width:100%;border-collapse:collapse;margin-top:6px;">
                        <thead><tr style="background:#f8fafc;">
                            <th style="padding:5px 8px;font-size:11px;text-align:left;color:#64748b;border-bottom:1px solid #e2e8f0;">#</th>
                            <th style="padding:5px 8px;font-size:11px;text-align:left;color:#64748b;border-bottom:1px solid #e2e8f0;">Cód. Orden</th>
                            <th style="padding:5px 8px;font-size:11px;text-align:left;color:#64748b;border-bottom:1px solid #e2e8f0;">Estado</th>
                            <th style="padding:5px 8px;font-size:11px;text-align:right;color:#64748b;border-bottom:1px solid #e2e8f0;">Importe</th>
                        </tr></thead><tbody>${ordenesList}</tbody>
                    </table>`
                    : '<span style="font-size:12px;color:#aaa;">Sin órdenes registradas</span>';

                return `<tr style="border-bottom:1px solid #e2e8f0;vertical-align:top;">
                    <td style="padding:10px 8px;font-size:13px;font-weight:900;color:#1e293b;white-space:nowrap;">${enc.ordenDeRetiro}</td>
                    <td style="padding:10px 8px;">
                        <div style="font-size:13px;font-weight:700;">${enc.CliNombre || '-'}</div>
                        <div style="font-size:11px;color:#64748b;">${enc.CliCodigoCliente || ''} &bull; ${enc.TClDescripcion || ''}</div>
                    </td>
                    <td style="padding:10px 8px;">
                        ${enc.departamentoEnvio ? `<div style="font-size:12px;"><strong>Dpto:</strong> ${enc.departamentoEnvio}</div>` : ''}
                        ${enc.localidadEnvio ? `<div style="font-size:12px;"><strong>Localidad:</strong> ${enc.localidadEnvio}</div>` : ''}
                        ${enc.direccionEnvio ? `<div style="font-size:12px;"><strong>Dir:</strong> ${enc.direccionEnvio}</div>` : ''}
                        ${(!enc.departamentoEnvio && !enc.localidadEnvio && !enc.direccionEnvio) ? `<span style="color:#aaa;font-size:11px;">—</span>` : ''}
                    </td>
                    <td style="padding:10px 8px;">${ordTable}</td>
                    <td style="padding:10px 8px;text-align:center;">
                        <span style="display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;font-weight:700;
                            border:1.5px solid ${enc.pagorealizado === 1 ? '#16a34a' : '#dc2626'};
                            color:${enc.pagorealizado === 1 ? '#16a34a' : '#dc2626'};">
                            ${enc.pagorealizado === 1 ? 'PAGADO' : 'PENDIENTE'}
                        </span>
                    </td>
                </tr>`;
            };

            const seccionesHtml = Object.entries(grupos).map(([agencia, ordenes]) => `
                <div style="margin-bottom:24px;page-break-inside:avoid;">
                    <div style="background:#0070bc;color:#fff;padding:8px 14px;border-radius:6px 6px 0 0;font-size:13px;font-weight:900;">
                        &#128666; ${agencia} (${ordenes.length})
                    </div>
                    <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;">
                        <thead><tr style="background:#f1f5f9;">
                            <th style="padding:7px 8px;font-size:11px;text-align:left;color:#334155;border-bottom:2px solid #e2e8f0;">Retiro</th>
                            <th style="padding:7px 8px;font-size:11px;text-align:left;color:#334155;border-bottom:2px solid #e2e8f0;">Cliente</th>
                            <th style="padding:7px 8px;font-size:11px;text-align:left;color:#334155;border-bottom:2px solid #e2e8f0;">Destino</th>
                            <th style="padding:7px 8px;font-size:11px;text-align:left;color:#334155;border-bottom:2px solid #e2e8f0;">Órdenes</th>
                            <th style="padding:7px 8px;font-size:11px;text-align:center;color:#334155;border-bottom:2px solid #e2e8f0;">Pago</th>
                        </tr></thead>
                        <tbody>${ordenes.map(renderFila).join('')}</tbody>
                    </table>
                </div>`).join('');

            const firmasHtml = `
                <div style="margin-top:40px;page-break-inside:avoid;">
                    <div style="display:flex;justify-content:space-around;gap:24px;">
                        <div style="flex:1;text-align:center;">
                            <div style="border-top:1.5px solid #334155;padding-top:8px;margin-top:50px;">
                                <div style="font-size:13px;font-weight:700;">Firma Entrega</div>
                                <div style="font-size:11px;color:#64748b;margin-top:2px;">Responsable despacho</div>
                            </div>
                        </div>
                        <div style="flex:1;text-align:center;">
                            <div style="border-top:1.5px solid #334155;padding-top:8px;margin-top:50px;">
                                <div style="font-size:13px;font-weight:700;">Firma Recibe</div>
                                <div style="font-size:11px;color:#64748b;margin-top:2px;">Transportista / Agencia</div>
                            </div>
                        </div>
                        <div style="flex:1;text-align:center;">
                            <div style="border-top:1.5px solid #334155;padding-top:8px;margin-top:50px;">
                                <div style="font-size:13px;font-weight:700;">Confirma Comprobante</div>
                                <div style="font-size:11px;color:#64748b;margin-top:2px;">Aclaración y sello</div>
                            </div>
                        </div>
                    </div>
                </div>`;

            const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
            <title>Reporte Despacho &mdash; USER</title>
            <style>
                *{box-sizing:border-box;margin:0;padding:0;}
                body{font-family:'Segoe UI',Calibri,sans-serif;padding:28px 32px;color:#1e293b;font-size:13px;}
                @media print{body{padding:14px 16px;} button{display:none!important;}}
            </style></head><body>
            <div style="border-bottom:3px solid #0070bc;padding-bottom:14px;margin-bottom:22px;display:flex;justify-content:space-between;align-items:flex-end;">
                <div style="display:flex;align-items:center;gap:20px;">
                    <div>
                        <div style="font-size:24px;font-weight:900;color:#0070bc;letter-spacing:1px;">USER</div>
                        <div style="font-size:15px;font-weight:700;color:#475569;">Logística &mdash; Hoja de Despacho</div>
                    </div>
                    ${remitoCode ?
                    `<div style="text-align:center;border-left:2px solid #e2e8f0;padding-left:20px;margin-left:5px;">
                        <img src="https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=${encodeURIComponent(remitoCode)}" style="width:60px;height:60px;mix-blend-mode:multiply;" />
                        <div style="font-size:11px;font-weight:900;color:#1e293b;margin-top:2px;">${remitoCode}</div>
                    </div>` : ''}
                </div>
                <div style="text-align:right;">
                    <div style="font-size:12px;color:#94a3b8;">${fecha}</div>
                    <div style="font-size:12px;color:#94a3b8;"><strong style="color:#1e293b;">${sel.length}</strong> retiros &bull; <strong style="color:#1e293b;">${Object.keys(grupos).length}</strong> agencia(s)</div>
                </div>
            </div>
            ${seccionesHtml}
            ${firmasHtml}
            <div style="margin-top:24px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">
                USER &mdash; Sistema de Gestión Logística &mdash; Documento interno
            </div>
            <div style="text-align:center;margin-top:16px;">
                <button onclick="window.print()" style="background:#0070bc;color:#fff;border:none;padding:9px 30px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;">&#128438; Imprimir Reporte</button>
            </div>
            </body></html>`;
            
            const win = window.open('', '_blank');
            win.document.write(html);
            win.document.close();
        } catch (err) { toast.error("Error al imprimir"); }
    };

    const filtered = transports.filter(t => {
        const matchesSearch = (t.CodigoRemito || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (t.Observaciones || '').toLowerCase().includes(searchTerm.toLowerCase());
        if (!matchesSearch) return false;
        if (filterStatus === 'ACTIVE') {
            if (!['EN_TRANSITO', 'EN_TRANSITO_PARCIAL', 'ESPERANDO_RETIRO'].includes(t.Estado)) return false;
        }
        if (filterTipo !== 'TODOS' && t.TipoEnvio !== filterTipo) return false;
        return true;
    });

    return (
        <div className="p-4 md:p-6 h-full overflow-y-auto bg-slate-50/50">
            {/* Header */}
            <div className="flex flex-col gap-3 mb-6 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-cyan/10 flex items-center justify-center">
                        <Truck size={20} className="text-brand-cyan" />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-800">Transporte en Curso</h2>
                        <p className="text-slate-500 text-sm">Mercadería en poder de transportistas</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="bg-slate-100 p-1 rounded-lg flex text-sm font-bold">
                        <button onClick={() => setFilterStatus('ACTIVE')} className={`px-3 py-1.5 rounded transition-all ${filterStatus === 'ACTIVE' ? 'bg-white shadow text-brand-cyan' : 'text-slate-500'}`}>En Viaje</button>
                        <button onClick={() => setFilterStatus('ALL')} className={`px-3 py-1.5 rounded transition-all ${filterStatus === 'ALL' ? 'bg-white shadow text-brand-cyan' : 'text-slate-500'}`}>Todos</button>
                    </div>
                    <div className="bg-slate-100 p-1 rounded-lg flex text-sm font-bold">
                        <button onClick={() => setFilterTipo('TODOS')} className={`px-3 py-1.5 rounded transition-all ${filterTipo === 'TODOS' ? 'bg-white shadow text-slate-700' : 'text-slate-500'}`}>Todos</button>
                        <button onClick={() => setFilterTipo('PRODUCCION')} className={`px-3 py-1.5 rounded transition-all ${filterTipo === 'PRODUCCION' ? 'bg-white shadow text-indigo-600' : 'text-slate-500'}`}>Producción</button>
                        <button onClick={() => setFilterTipo('ENCOMIENDA')} className={`px-3 py-1.5 rounded transition-all ${filterTipo === 'ENCOMIENDA' ? 'bg-white shadow text-emerald-600' : 'text-slate-500'}`}>Encomiendas</button>
                    </div>
                    <button onClick={loadData} className="p-2 text-brand-cyan hover:bg-brand-cyan/10 rounded-lg">
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="mb-6 relative">
                <Search size={16} className="absolute left-3 top-3 text-slate-400" />
                <input
                    type="text"
                    placeholder="Buscar por remito, chofer o agencia..."
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 focus:ring-2 focus:ring-brand-cyan/20 outline-none text-sm"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {loading ? (
                    <div className="col-span-full py-20 flex flex-col items-center gap-2 text-slate-400">
                        <Loader2 className="animate-spin" />
                        <span>Cargando datos...</span>
                    </div>
                ) : filtered.length === 0 ? (
                    <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                        <Navigation size={40} className="text-slate-300 mb-3 mx-auto" />
                        <p className="text-slate-500 font-medium">No hay vehículos registrados con este filtro.</p>
                    </div>
                ) : (
                    filtered.map(t => (
                        <div
                            key={t.EnvioID}
                            className={`bg-white rounded-xl shadow-sm border p-4 hover:shadow-md transition-shadow
                                ${t.Estado.includes('RECIBIDO') ? 'border-slate-200 opacity-75' : 'border-brand-cyan/20'}`}
                        >
                            {/* Top row: código + badge */}
                            <div className="flex items-start gap-3 mb-3">
                                <Truck size={20} className="text-brand-cyan/30 mt-0.5 shrink-0" />
                                <div className="flex-1 min-w-0">
                                    <div className="flex flex-wrap items-center gap-2 mb-1">
                                        <span className="font-black text-base text-brand-cyan bg-brand-cyan/5 px-2 py-0.5 rounded border border-brand-cyan/20">
                                            {t.CodigoRemito}
                                        </span>
                                        <span className={`text-xs font-bold px-2 py-0.5 rounded border uppercase
                                            ${t.Estado === 'ESPERANDO_RETIRO' ? 'bg-amber-50 text-amber-600 border-amber-200' :
                                                t.Estado.includes('RECIBIDO') ? 'bg-slate-100 text-slate-500 border-slate-200' :
                                                    'bg-emerald-50 text-emerald-600 border-emerald-100'}`}>
                                            {t.Estado.replace(/_/g, ' ')}
                                        </span>
                                    </div>
                                    <div className="text-sm text-slate-700 font-medium truncate flex items-center gap-1.5">
                                        <Tag size={13} className="text-slate-400 shrink-0" />
                                        {t.Observaciones}
                                    </div>
                                    <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                                        <Clock size={11} className="shrink-0" />
                                        {new Date(t.Fecha).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                        &nbsp;·&nbsp;{t.TotalBultos} bulto{t.TotalBultos !== 1 ? 's' : ''}
                                    </div>
                                    <div className="mt-1.5 flex items-center gap-2">
                                        {(t.AreaOrigenID || t.AreaDestinoID) && (
                                            <div className="text-xs font-bold flex items-center gap-1 text-slate-600">
                                                <span className="uppercase bg-slate-100 px-1.5 py-0.5 rounded">{t.AreaOrigenID || '?'}</span>
                                                <i className="fa-solid fa-arrow-right text-slate-400 text-[10px]"></i>
                                                <span className="uppercase bg-slate-100 px-1.5 py-0.5 rounded">{t.AreaDestinoID || '?'}</span>
                                            </div>
                                        )}
                                        {t.TipoEnvio && (
                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${t.TipoEnvio === 'ENCOMIENDA' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                                                {t.TipoEnvio}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="flex gap-2 border-t pt-4">
                                <button onClick={() => handlePrint(t)} className="flex-1 text-xs font-bold py-2 bg-slate-50 text-slate-600 rounded-xl hover:bg-slate-100 flex items-center justify-center gap-2">
                                    <Printer size={14} /> Reporte
                                </button>
                                <button onClick={() => openUploadModal(t)} className="flex-1 text-xs font-bold py-2 bg-brand-cyan/10 text-brand-cyan rounded-xl hover:bg-brand-cyan/20 flex items-center justify-center gap-2">
                                    <ListChecks size={14} /> Entregas
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>

            {/* UPLOAD PROOF MODAL */}
            {typeof document !== 'undefined' && createPortal(
                <>
                {isModalOpen && modalData && (
                    <div
                        className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
                    >
                        <div className="absolute inset-0 bg-slate-900/80" onClick={() => setIsModalOpen(false)} />
                        <div
                            className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[90vh] animate-in fade-in slide-in-from-bottom-8 duration-250"
                        >

                        {/* Header */}
                        <div className="bg-gradient-to-r from-brand-cyan to-[#005080] px-5 py-4 flex justify-between items-center shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
                                    <PackageCheck size={18} className="text-white" />
                                </div>
                                <div>
                                    <p className="font-black text-white text-base leading-tight">Gestionar Entregas</p>
                                    <p className="text-white/70 text-xs font-medium">{modalData.transport.CodigoRemito}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/25 text-white transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto p-4 md:p-5">

                            <>
                                    {/* HISTORIAL DE ARCHIVOS YA SUBIDOS */}
                                    {(() => {
                                        const prevPaths = Array.from(new Set(modalData.items.filter(i => i.ComprobantePath).map(i => i.ComprobantePath)));
                                        if (prevPaths.length === 0) return null;
                                        return (
                                            <div className="mb-5 bg-brand-cyan/5 p-4 rounded-xl border border-brand-cyan/20">
                                                <h4 className="font-bold text-brand-cyan text-xs uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                                    <History size={13} /> Comprobantes ya subidos en este remito
                                                </h4>
                                                <div className="flex flex-wrap gap-2">
                                                    {prevPaths.map(path => {
                                                        const fileName = path.split('/').pop();
                                                        const bultosAsociados = modalData.items.filter(i => i.ComprobantePath === path);
                                                        return (
                                                            <div key={path} className="bg-white p-2.5 flex-1 min-w-[220px] rounded-lg border border-brand-cyan/20 shadow-sm">
                                                                <a href={import.meta.env.VITE_COMPROBANTES_ENCOMIENDAS_PATH ? `${import.meta.env.VITE_COMPROBANTES_ENCOMIENDAS_PATH}/${path.split('/').pop()}` : `${import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace('/api', '') : ''}${path}`} target="_blank" rel="noreferrer"
                                                                    className="text-xs font-bold text-brand-cyan hover:opacity-80 truncate flex items-center gap-1 bg-brand-cyan/5 p-1.5 rounded mb-2" title={fileName}>
                                                                    <FileDown size={12} /> {fileName}
                                                                </a>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {bultosAsociados.map(b => (
                                                                        <span key={b.BultoID} className="bg-brand-cyan/10 border border-brand-cyan/20 text-brand-cyan text-[10px] px-1.5 py-0.5 rounded font-bold">{b.RetiroAsociado || b.CodigoEtiqueta}</span>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    })()}

                                    {/* Instrucción */}
                                    <div className="mb-4">
                                        <h4 className="font-black text-slate-800 text-base">Bultos de esta tanda</h4>
                                        <p className="text-sm text-slate-500 mt-0.5">Seleccioná los bultos entregados. Doble click para adjuntar foto de comprobante.</p>
                                    </div>

                                    {/* HIDDEN CAMERA INPUT */}
                                    <input
                                        type="file"
                                        ref={hiddenFileInputRef}
                                        style={{ display: 'none' }}
                                        accept="image/*,application/pdf"
                                        capture="environment"
                                        onChange={handleFileSelected}
                                    />

                                    {/* BULTO CARDS */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {modalData.items.map(item => {
                                            const isDelivered = item.BultoEstado === 'ENTREGADO';

                                            if (isDelivered) {
                                                const fname = item.ComprobantePath ? item.ComprobantePath.split('/').pop() : 'Sin archivo';
                                                return (
                                                    <div key={item.BultoID} className="flex flex-col justify-between p-4 rounded-xl border border-slate-200 bg-slate-50 opacity-60">
                                                        <div>
                                                            <p className="font-bold text-slate-500 text-sm">{item.RetiroAsociado || item.CodigoEtiqueta}</p>
                                                            <p className="text-xs text-slate-400">{item.Descripcion || 'Sin desc'}</p>
                                                        </div>
                                                        <div className="flex flex-col items-start mt-2 gap-1">
                                                            <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full uppercase">Ya Entregado</span>
                                                            <span className="text-[11px] text-slate-400 font-bold break-all flex items-center gap-1" title={fname}><File size={11} /> {fname}</span>
                                                        </div>
                                                    </div>
                                                );
                                            }

                                            const map = bultoMappings[item.BultoID] || { checked: false, file: null };

                                            return (
                                                <div
                                                    key={item.BultoID}
                                                    onDoubleClick={() => {
                                                        setActiveBultoId(item.BultoID);
                                                        hiddenFileInputRef.current?.click();
                                                    }}
                                                    className={`flex flex-col justify-between p-4 rounded-xl border transition-all cursor-pointer
                                                        ${map.checked
                                                            ? 'border-brand-cyan bg-brand-cyan/5 shadow-md ring-1 ring-brand-cyan/30'
                                                            : 'bg-white border-slate-200 hover:border-brand-cyan/30 shadow-sm'}`}
                                                >
                                                    <label className="flex items-center gap-3 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            checked={map.checked}
                                                            onChange={(e) => {
                                                                const isChecked = e.target.checked;
                                                                setBultoMappings(prev => ({
                                                                    ...prev,
                                                                    [item.BultoID]: { ...map, checked: isChecked }
                                                                }));
                                                            }}
                                                            className="w-5 h-5 rounded accent-brand-cyan border-slate-300"
                                                        />
                                                        <div>
                                                            <p className={`font-black text-base leading-tight ${map.checked ? 'text-brand-cyan' : 'text-slate-700'}`}>{item.RetiroAsociado || item.CodigoEtiqueta}</p>
                                                            <p className="text-xs text-slate-500">{item.Descripcion || 'Sin desc'}</p>
                                                        </div>
                                                    </label>

                                                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                                                        {map.file ? (
                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                <FileImage size={14} className="text-brand-cyan shrink-0" />
                                                                <span className="text-xs font-bold text-brand-cyan truncate">{map.file.name}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-slate-400">Sin foto adjunta</span>
                                                        )}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setActiveBultoId(item.BultoID);
                                                                hiddenFileInputRef.current?.click();
                                                            }}
                                                            className={`shrink-0 text-xs px-3 py-1.5 rounded-lg font-bold transition-colors flex items-center gap-1.5
                                                                ${map.file
                                                                    ? 'bg-brand-cyan/10 hover:bg-brand-cyan/20 text-brand-cyan'
                                                                    : 'bg-slate-100 hover:bg-slate-200 text-slate-600'}}`}
                                                        >
                                                            {map.file ? <RefreshCw size={12} /> : <Camera size={12} />}
                                                            {map.file ? 'Cambiar' : 'Foto'}
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t bg-slate-50 flex gap-3 shrink-0">
                            <button onClick={() => setIsModalOpen(false)} className="flex-1 sm:flex-none px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 text-sm transition-colors border border-slate-200">
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmDelivery}
                                disabled={Object.values(bultoMappings).filter(m => m.checked).length === 0 || loading}
                                className="flex-1 px-6 py-2.5 rounded-xl font-black text-white bg-brand-cyan hover:bg-[#005080] disabled:opacity-50 flex items-center justify-center gap-2 text-sm transition-colors shadow-md"
                            >
                                {loading && <Loader2 size={14} className="animate-spin" />}
                                Procesar {Object.values(bultoMappings).filter(m => m.checked).length > 0 ? `(${Object.values(bultoMappings).filter(m => m.checked).length})` : ''}
                            </button>
                        </div>
                        </div>
                    </div>
                )}
                </>
            , document.body)}
        </div>
    );
};

export default TransportView;
