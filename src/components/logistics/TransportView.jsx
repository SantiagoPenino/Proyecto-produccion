import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import api from '../../services/api';
import { logisticsService } from '../../services/modules/logisticsService';
import { toast } from 'sonner';

import {
    Truck, RefreshCw, Search, Tag, Clock, Printer,
    ListChecks, Navigation, History, FileDown, FileImage,
    File, Camera, X, PackageCheck, Loader2, Plus, Trash2, ArrowRight, ArrowUpRight, ArrowDownLeft
} from 'lucide-react';

// Estética nueva (22/10/2026, como Reportes y Cotización): fondo claro, tarjetas blancas con borde, íconos de
// Lucide en brand-cyan sin fondo, segmentados con la opción elegida en negro; el color queda para el estado del
// remito y de los bultos. La hoja de despacho que se imprime (handlePrint) no se tocó.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const SEGMENTADO = 'inline-flex items-center gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-white';
const segmento = (activo) => `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
    activo ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`;
const CHIP = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';

// originArea: la pestaña "En Viaje" de Entrega de pedidos pasa 'LOGISTICA_ENCOMIENDAS' y arranca
// filtrando encomiendas; desde Logística llega sin ese prop y arranca en Todos.
// areaFilter (23/10): el área elegida en el tablero de Logística. Con un área, solo lo que salió de
// ella o va hacia ella, con una etiqueta en cada tarjeta; con 'TODOS' (o sin área), todo como antes.
const TransportView = ({ originArea, areaFilter } = {}) => {
    const area = areaFilter && areaFilter !== 'TODOS' ? areaFilter : null;
    const [transports, setTransports] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [busqueda, setBusqueda] = useState(''); // searchTerm con debounce: es la que va al backend
    const [filterStatus, setFilterStatus] = useState('ACTIVE'); // 'ACTIVE' | 'ALL'
    const [filterTipo, setFilterTipo] = useState(originArea === 'LOGISTICA_ENCOMIENDAS' ? 'ENCOMIENDA' : 'TODOS'); // 'TODOS' | 'PRODUCCION' | 'ENCOMIENDA'
    const pedidoRef = useRef(0); // descarta respuestas viejas si se tipea rápido

    useEffect(() => {
        const t = setTimeout(() => setBusqueda(searchTerm.trim()), 400);
        return () => clearTimeout(t);
    }, [searchTerm]);

    // Los filtros se aplican en el backend, antes del tope de 200 remitos. Hasta el 28/09/2026 se
    // filtraba acá sobre los últimos 200 de todo tipo y lo anterior a ~una semana no aparecía.
    const loadData = useCallback(async () => {
        const pedido = ++pedidoRef.current;
        setLoading(true);
        try {
            const data = await logisticsService.getActiveTransports({
                tipo: filterTipo !== 'TODOS' ? filterTipo : undefined,
                estado: filterStatus === 'ACTIVE' ? 'ACTIVOS' : undefined,
                q: busqueda || undefined,
                area: area || undefined,
            });
            if (pedido === pedidoRef.current) setTransports(data);
        } catch (error) {
            console.error(error);
            toast.error('Error al cargar transportes');
        } finally {
            if (pedido === pedidoRef.current) setLoading(false);
        }
    }, [filterTipo, filterStatus, busqueda, area]);

    useEffect(() => {
        loadData();
    }, [loadData]);

    // MODAL STATE
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [modalData, setModalData] = useState(null);
    const [bultoMappings, setBultoMappings] = useState({}); // { [bultoId]: { checked: boolean, file: File | null } }
    const [activeBultoId, setActiveBultoId] = useState(null);
    const hiddenFileInputRef = useRef(null);
    // Bulto de encomienda ya entregado sin foto (29/10/2026): se le adjunta el comprobante sin volver a
    // confirmar la entrega (no cambia estados ni fechas).
    const entregadoInputRef = useRef(null);
    const entregadoDestinoRef = useRef(null);
    const [subiendoEntregado, setSubiendoEntregado] = useState(null); // BultoID en curso

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

    const subirComprobanteEntregado = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = null;
        const item = entregadoDestinoRef.current;
        entregadoDestinoRef.current = null;
        if (!file || !item) return;
        setSubiendoEntregado(item.BultoID);
        try {
            await logisticsService.subirComprobanteEncomienda(item.RetiroAsociado, file, item.BultoID);
            toast.success(`Comprobante de ${item.RetiroAsociado} guardado`);
            const details = await logisticsService.getRemitoByCode(modalData.transport.CodigoRemito);
            setModalData(prev => ({ ...prev, items: details.items }));
        } catch (err) {
            toast.error(err.response?.data?.error || 'No se pudo subir el comprobante');
        } finally {
            setSubiendoEntregado(null);
        }
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

            toast.success('Entregas procesadas con éxito');
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

    return (
        <div className="p-3 md:p-6 h-full overflow-y-auto bg-slate-50 text-zinc-800">
            {/* Header */}
            <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                    <Truck size={24} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h2 className="text-lg font-black text-zinc-800">Transporte en Curso</h2>
                        <p className="text-sm text-zinc-400">Mercadería en poder de transportistas</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <div className={SEGMENTADO}>
                        <button onClick={() => setFilterStatus('ACTIVE')} className={segmento(filterStatus === 'ACTIVE')}>En Viaje</button>
                        <button onClick={() => setFilterStatus('ALL')} className={segmento(filterStatus === 'ALL')}>Todos</button>
                    </div>
                    <div className={SEGMENTADO}>
                        <button onClick={() => setFilterTipo('TODOS')} className={segmento(filterTipo === 'TODOS')}>Todos</button>
                        <button onClick={() => setFilterTipo('PRODUCCION')} className={segmento(filterTipo === 'PRODUCCION')}>Producción</button>
                        <button onClick={() => setFilterTipo('ENCOMIENDA')} className={segmento(filterTipo === 'ENCOMIENDA')}>Encomiendas</button>
                    </div>
                    <button onClick={loadData} className={BTN_SECUNDARIO} title="Actualizar" aria-label="Actualizar">
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Search */}
            <div className="mb-4 relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                <input
                    type="text"
                    placeholder="Remito o N° de retiro (ej. 219352)…"
                    aria-label="Buscar por remito o número de retiro"
                    className={CAMPO}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {loading ? (
                    <div className={`${CARD} col-span-full py-16 flex flex-col items-center justify-center gap-3`}>
                        <Loader2 size={30} className="animate-spin text-brand-cyan" />
                        <span className="text-sm text-zinc-400">Cargando datos...</span>
                    </div>
                ) : transports.length === 0 ? (
                    <div className={`${CARD} col-span-full py-16 px-4 flex flex-col items-center justify-center gap-2 text-center`}>
                        <Navigation size={40} className="text-zinc-200" />
                        <p className="text-zinc-400 font-medium">
                            {area ? `Nada en viaje que salga de ${area} o vaya hacia ${area} con este filtro.` : 'No hay vehículos registrados con este filtro.'}
                        </p>
                    </div>
                ) : (
                    transports.map(t => (
                        <div
                            key={t.EnvioID}
                            className={`${CARD} p-4 flex flex-col gap-3 hover:border-zinc-300 transition-colors
                                ${t.Estado.includes('RECIBIDO') ? 'opacity-75' : ''}`}
                        >
                            {/* Código y estado */}
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                    <Truck size={18} className="text-brand-cyan shrink-0" />
                                    <span className="font-black text-zinc-800 tracking-tight font-mono truncate">{t.CodigoRemito}</span>
                                </div>
                                <span className={`${CHIP} uppercase shrink-0
                                    ${t.Estado === 'ESPERANDO_RETIRO' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                        t.Estado.includes('RECIBIDO') ? 'bg-zinc-100 text-zinc-500 border-zinc-200' :
                                            'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                    {t.Estado.replace(/_/g, ' ')}
                                </span>
                            </div>

                            {area && (
                                <span className={`${CHIP} self-start inline-flex items-center gap-1 bg-zinc-50 text-zinc-600 border-zinc-200`}>
                                    {String(t.AreaOrigenID || '').trim().toUpperCase() === area.toUpperCase()
                                        ? <><ArrowUpRight size={12} className="text-brand-cyan" /> Enviado por tu sector</>
                                        : <><ArrowDownLeft size={12} className="text-brand-cyan" /> Viene a tu sector</>}
                                </span>
                            )}

                            {t.Observaciones && (
                                <p className="text-sm font-bold text-zinc-800 leading-snug line-clamp-2" title={t.Observaciones}>{t.Observaciones}</p>
                            )}

                            {/* Datos con rótulo */}
                            <dl className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-x-2 gap-y-1 rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2.5 text-xs">
                                <div className="min-w-0">
                                    <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Origen</dt>
                                    <dd className="font-bold text-zinc-700 truncate" title={t.AreaOrigenID || ''}>{(t.AreaOrigenID || '—').replace(/_/g, ' ')}</dd>
                                </div>
                                <ArrowRight size={13} className="text-brand-cyan shrink-0 mb-0.5" />
                                <div className="min-w-0">
                                    <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Destino</dt>
                                    <dd className="font-bold text-zinc-700 truncate" title={t.AreaDestinoID || ''}>{(t.AreaDestinoID || '—').replace(/_/g, ' ')}</dd>
                                </div>
                                <div className="text-right pl-2 border-l border-zinc-200">
                                    <dt className="text-[10px] font-black uppercase tracking-wide text-zinc-400">Bultos</dt>
                                    <dd className="font-black text-zinc-800 tabular-nums">{t.TotalBultos}</dd>
                                </div>
                            </dl>

                            {/* Pie: cuándo y qué tipo, y las acciones */}
                            <div className="flex items-center justify-between gap-2 flex-wrap mt-auto">
                                <div className="flex items-center gap-2 min-w-0 text-[11px] text-zinc-400">
                                    <span className="inline-flex items-center gap-1 tabular-nums">
                                        <Clock size={11} className="shrink-0" />
                                        {new Date(t.Fecha).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    </span>
                                    {t.TipoEnvio && (
                                        <span className={`${CHIP} uppercase ${t.TipoEnvio === 'ENCOMIENDA' ? 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20' : 'bg-zinc-100 text-zinc-600 border-zinc-200'}`}>
                                            {t.TipoEnvio}
                                        </span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button type="button" onClick={() => handlePrint(t)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors">
                                        <Printer size={13} className="text-brand-cyan" /> Reporte
                                    </button>
                                    <button type="button" onClick={() => openUploadModal(t)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors">
                                        <ListChecks size={13} /> Entregas
                                    </button>
                                </div>
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
                        <div className="absolute inset-0 bg-black/40" onClick={() => setIsModalOpen(false)} />
                        <div
                            className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[92vh] sm:max-h-[90vh] animate-in fade-in slide-in-from-bottom-8 duration-250 text-zinc-800"
                        >

                        {/* Header */}
                        <div className="px-5 py-4 border-b border-zinc-200 flex justify-between items-center gap-3 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                <PackageCheck size={24} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                                <div className="min-w-0">
                                    <p className="text-lg font-black text-zinc-800 leading-tight">Gestionar Entregas</p>
                                    <p className="text-sm text-zinc-400 font-mono truncate">{modalData.transport.CodigoRemito}</p>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsModalOpen(false)}
                                className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors"
                                title="Cerrar"
                                aria-label="Cerrar"
                            >
                                <X size={18} />
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
                                            <div className="mb-5 bg-zinc-50 p-4 rounded-xl border border-zinc-200">
                                                <h4 className="text-[11px] font-black text-zinc-400 uppercase tracking-wide mb-3 flex items-center gap-1.5">
                                                    <History size={14} className="text-brand-cyan shrink-0" /> Comprobantes ya subidos en este remito
                                                </h4>
                                                <div className="flex flex-wrap gap-2">
                                                    {prevPaths.map(path => {
                                                        const fileName = path.split('/').pop();
                                                        const bultosAsociados = modalData.items.filter(i => i.ComprobantePath === path);
                                                        return (
                                                            <div key={path} className="bg-white p-2.5 flex-1 min-w-[220px] rounded-xl border border-zinc-200">
                                                                <a href={import.meta.env.VITE_COMPROBANTES_ENCOMIENDAS_PATH ? `${import.meta.env.VITE_COMPROBANTES_ENCOMIENDAS_PATH}/${path.split('/').pop()}` : `${import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace('/api', '') : ''}${path}`} target="_blank" rel="noreferrer"
                                                                    className="text-xs font-bold text-brand-cyan hover:underline truncate flex items-center gap-1.5 bg-zinc-50 border border-zinc-100 p-1.5 rounded-lg mb-2" title={fileName}>
                                                                    <FileDown size={13} className="shrink-0" /> {fileName}
                                                                </a>
                                                                <div className="flex flex-wrap gap-1">
                                                                    {bultosAsociados.map(b => (
                                                                        <span key={b.BultoID} className={`${CHIP} bg-zinc-100 text-zinc-600 border-zinc-200`}>{b.RetiroAsociado || b.CodigoEtiqueta}</span>
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
                                        <h4 className="font-black text-zinc-800 text-base">Bultos de esta tanda</h4>
                                        <p className="text-sm text-zinc-400 mt-0.5">Seleccioná los bultos entregados. Doble click para adjuntar foto de comprobante.</p>
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
                                    <input
                                        type="file"
                                        ref={entregadoInputRef}
                                        style={{ display: 'none' }}
                                        accept="image/*"
                                        onChange={subirComprobanteEntregado}
                                    />

                                    {/* BULTO CARDS */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                        {modalData.items.map(item => {
                                            const isDelivered = item.BultoEstado === 'ENTREGADO';

                                            if (isDelivered) {
                                                const fname = item.ComprobantePath ? item.ComprobantePath.split('/').pop() : 'Sin archivo';
                                                const puedeAdjuntar = !item.ComprobantePath && item.Tipocontenido === 'ENCOMIENDA' && item.RetiroAsociado;
                                                return (
                                                    <div key={item.BultoID} className={`flex flex-col justify-between p-4 rounded-xl border border-zinc-200 bg-zinc-50 ${puedeAdjuntar ? '' : 'opacity-60'}`}>
                                                        <div>
                                                            <p className="font-bold text-zinc-500 text-sm">{item.RetiroAsociado || item.CodigoEtiqueta}</p>
                                                            <p className="text-xs text-zinc-400">{item.Descripcion || 'Sin desc'}</p>
                                                        </div>
                                                        <div className="flex flex-col items-start mt-2 gap-1.5">
                                                            <span className={`${CHIP} bg-emerald-50 text-emerald-700 border-emerald-200 uppercase`}>Ya Entregado</span>
                                                            {puedeAdjuntar ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => { entregadoDestinoRef.current = item; entregadoInputRef.current?.click(); }}
                                                                    disabled={subiendoEntregado !== null}
                                                                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50"
                                                                >
                                                                    {subiendoEntregado === item.BultoID
                                                                        ? <Loader2 size={13} className="animate-spin text-brand-cyan" />
                                                                        : <Camera size={13} className="text-brand-cyan" />}
                                                                    Adjuntar comprobante
                                                                </button>
                                                            ) : (
                                                                <span className="text-[11px] text-zinc-400 font-bold break-all flex items-center gap-1" title={fname}><File size={12} className="shrink-0 text-brand-cyan" /> {fname}</span>
                                                            )}
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
                                                            ? 'border-brand-cyan bg-brand-cyan/5 ring-1 ring-brand-cyan/30'
                                                            : 'bg-white border-zinc-200 hover:border-zinc-300'}`}
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
                                                            className="w-5 h-5 shrink-0 rounded accent-brand-cyan border-zinc-300"
                                                        />
                                                        <div className="min-w-0">
                                                            <p className={`font-black text-base leading-tight ${map.checked ? 'text-brand-cyan' : 'text-zinc-800'}`}>{item.RetiroAsociado || item.CodigoEtiqueta}</p>
                                                            <p className="text-xs text-zinc-400">{item.Descripcion || 'Sin desc'}</p>
                                                        </div>
                                                    </label>

                                                    <div className="mt-3 pt-3 border-t border-zinc-100 flex items-center justify-between gap-2">
                                                        {map.file ? (
                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                <FileImage size={14} className="text-brand-cyan shrink-0" />
                                                                <span className="text-xs font-bold text-brand-cyan truncate">{map.file.name}</span>
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-zinc-400">Sin foto adjunta</span>
                                                        )}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                setActiveBultoId(item.BultoID);
                                                                hiddenFileInputRef.current?.click();
                                                            }}
                                                            className={`shrink-0 text-xs px-3 py-1.5 rounded-lg border font-bold transition-colors flex items-center gap-1.5
                                                                ${map.file
                                                                    ? 'bg-white border-brand-cyan/30 text-brand-cyan hover:bg-brand-cyan/5'
                                                                    : 'bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50'}`}
                                                        >
                                                            {map.file ? <RefreshCw size={13} /> : <Camera size={13} />}
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
                        <div className="p-4 border-t border-zinc-200 bg-white flex gap-3 shrink-0">
                            <button onClick={() => setIsModalOpen(false)} className={`${BTN_SECUNDARIO} flex-1 sm:flex-none sm:px-5`}>
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmDelivery}
                                disabled={Object.values(bultoMappings).filter(m => m.checked).length === 0 || loading}
                                className={`${BTN_PRINCIPAL} flex-1`}
                            >
                                {loading && <Loader2 size={15} className="animate-spin" />}
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
