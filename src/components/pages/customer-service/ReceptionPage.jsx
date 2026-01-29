import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { receptionService } from '../../../services/api';

import ActiveStockPage from './ActiveStockPage';

const ReceptionPage = () => {
    const [activeTab, setActiveTab] = useState('reception'); // 'reception' | 'stock'
    // Data Lists
    const [clients, setClients] = useState([]);
    const [servicesList, setServicesList] = useState([]);
    const [insumosList, setInsumosList] = useState([]); // NEW
    const [areasList, setAreasList] = useState([]); // NEW
    const [configLoaded, setConfigLoaded] = useState(false);

    // Form State
    const [nextCode, setNextCode] = useState('PRE-#');
    const [formData, setFormData] = useState({
        clienteId: '',
        tipo: 'PAQUETE DE PRENDAS', // Default
        bultos: 1,
        servicios: [], // Array of strings
        telaCliente: '',
        referencias: [''], // Array of strings
        // New Fields for TELA
        insumoId: '',
        metros: '',
        loteProv: '',
        areaDestino: ''
    });

    // Validations & UI
    const [errors, setErrors] = useState({});
    const [message, setMessage] = useState(null);
    const [loading, setLoading] = useState(false);

    // History State
    const [history, setHistory] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [historyFilters, setHistoryFilters] = useState({
        cliente: '', orden: '', fechaDesde: '', fechaHasta: ''
    });
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);

    // Filter Suggestions
    const [clientSuggestions, setClientSuggestions] = useState([]);
    const [possibleOrders, setPossibleOrders] = useState([]); // NEW for Fabric Orders

    useEffect(() => {
        loadInitData();
        loadHistory();
    }, []);

    // NEW: Fetch orders when client or area changes (For TELA or PAQUETE)
    useEffect(() => {
        const shouldFetch = (formData.tipo === 'TELA DE CLIENTE' || formData.tipo === 'PAQUETE DE PRENDAS') && formData.clienteId;

        if (shouldFetch) {
            const fetchOrders = async () => {
                try {
                    const typeParam = formData.tipo === 'TELA DE CLIENTE' ? 'TELA' : 'SERVICIO';

                    // Determine Area ID to filter by
                    let targetArea = formData.areaDestino; // Default for Tela
                    if (formData.tipo === 'PAQUETE DE PRENDAS' && formData.servicios.length > 0) {
                        // Find AreaID matching the selected service name
                        // We take the first selected service as the primary one for lookup
                        const serviceName = formData.servicios[0];
                        const areaObj = areasList.find(a => a.Nombre === serviceName);
                        if (areaObj) targetArea = areaObj.AreaID;
                    }

                    const ords = await receptionService.getOrdersForFabric(formData.clienteId, targetArea, typeParam);
                    setPossibleOrders(ords || []);
                } catch (e) {
                    console.error(e);
                }
            };
            fetchOrders();
        } else {
            setPossibleOrders([]);
        }
    }, [formData.clienteId, formData.areaDestino, formData.tipo, formData.servicios, areasList]);

    // NEW: Auto-select TELA CLIENTE insumo if exists and type is TELA
    useEffect(() => {
        if (formData.tipo === 'TELA DE CLIENTE' && insumosList.length > 0) {
            const telaInsumo = insumosList.find(i => i.Nombre.toUpperCase().includes('TELA CLIENTE'));
            if (telaInsumo && formData.insumoId !== telaInsumo.InsumoID) {
                // Only set ID, do NOT overwrite description (canvas logic)
                setFormData(prev => ({ ...prev, insumoId: telaInsumo.InsumoID }));
            }
        }
    }, [formData.tipo, insumosList]);

    const loadInitData = async () => {
        try {
            const data = await receptionService.getInitData();
            setClients(data.clientes || []);
            setServicesList(data.servicios || []);
            setInsumosList(data.insumos || []); // NEW
            setAreasList(data.areas || []); // NEW
            setNextCode(data.nextCode || 'PRE-#');
            setConfigLoaded(true);
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: 'Error cargando configuración inicial.' });
        }
    };

    const loadHistory = async () => {
        setHistoryLoading(true);
        try {
            const res = await receptionService.getHistory({ ...historyFilters, page, pageSize: 20 });
            setHistory(res.rows || []);
            setTotalPages(Math.ceil((res.total || 0) / 20));
        } catch (error) {
            console.error(error);
        } finally {
            setHistoryLoading(false);
        }
    };

    // FORM HANDLERS
    // State for Pending Orders
    const [clientOrders, setClientOrders] = useState([]);

    const handleClientChange = async (e) => {
        const val = e.target.value;
        setFormData(prev => ({ ...prev, clienteId: val }));

        // Autocomplete logic
        if (val.length > 1) {
            const matches = clients.filter(c => c.toLowerCase().includes(val.toLowerCase())).slice(0, 10);
            setClientSuggestions(matches);

            // If exact match, fetch orders
            if (clients.includes(val)) {
                fetchClientOrders(val);
            }
        } else {
            setClientSuggestions([]);
            setClientOrders([]);
        }
    };

    // Explicit fetch when selecting from datalist (browser handles change, but checking exact match above covers it mostly. 
    // We can also add onBlur check)
    const handleClientBlur = () => {
        if (clients.includes(formData.clienteId)) {
            fetchClientOrders(formData.clienteId);
        }
    };

    const fetchClientOrders = async (clientName) => {
        try {
            const orders = await receptionService.getOrdersByClient(clientName);
            setClientOrders(orders || []);
        } catch (error) {
            console.error("Error fetching orders:", error);
        }
    };

    const handleServiceToggle = (srv) => {
        setFormData(prev => {
            // Enforce single selection: If clicking new, replace. If clicking same, toggle off? 
            // User requested "solo se seleccione un area a la vez".
            // Let's make it behave like radio button: clicking selects it. Clicking same keeps it or deselects.
            // Let's just set it as the single item.
            const isSelected = prev.servicios.includes(srv);
            return { ...prev, servicios: isSelected ? [] : [srv] };
        });
    };

    const handleRefChange = (idx, val) => {
        const newRefs = [...formData.referencias];
        newRefs[idx] = val;
        setFormData({ ...formData, referencias: newRefs });
    };

    const addRef = () => setFormData({ ...formData, referencias: [...formData.referencias, ''] });
    const removeRef = (idx) => {
        const newRefs = formData.referencias.filter((_, i) => i !== idx);
        setFormData({ ...formData, referencias: newRefs });
    };

    const validate = () => {
        const errs = {};
        if (!formData.clienteId.trim()) errs.clienteId = 'Requerido';

        if (formData.tipo === 'PAQUETE DE PRENDAS' && formData.servicios.length === 0) {
            errs.servicios = 'Selecciona al menos un servicio';
        }

        if (formData.tipo === 'TELA DE CLIENTE') {
            if (!formData.areaDestino) errs.areaDestino = 'Requerido';
            if (!formData.insumoId) errs.insumoId = 'Requerido';
            if (!formData.metros || parseFloat(formData.metros) <= 0) errs.metros = 'Requerido (>0)';
            // Descr. Tela (telaCliente) auto-filled by Insumo Name usually, but check just in case
            if (!formData.telaCliente.trim()) errs.telaCliente = 'Requerido';
        }

        setErrors(errs);
        return Object.keys(errs).length === 0;
    };


    const handleReset = () => {
        setFormData({
            clienteId: '',
            tipo: 'PAQUETE DE PRENDAS',
            bultos: 1,
            servicios: [],
            telaCliente: '',
            referencias: [''],
            insumoId: '',
            metros: '',
            loteProv: '',
            areaDestino: ''
        });
        setErrors({});
        setMessage(null);
        loadInitData(); // Refresh counter
    };

    const handleSaveAndPrint = async () => {
        if (!validate()) return;
        setLoading(true);
        setMessage(null);

        try {
            // 1. Save
            const payload = {
                ...formData,
                referencias: formData.referencias.filter(r => r.trim())
            };
            const res = await receptionService.createReception(payload);

            if (res.success) {
                setMessage({ type: 'success', text: `Orden ${res.ordenAsignada} guardada.` });
                // 2. Print
                await printLabel({
                    orden: res.ordenAsignada,
                    ...payload,
                    fechaHora: new Date().toLocaleString()
                });
                // 3. Reset & Reload
                handleReset();
                loadHistory();
            }

        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: 'Error al guardar: ' + error.message });
        } finally {
            setLoading(false);
        }
    };

    // PRINT LOGIC
    const iframeRef = useRef(null);

    const printLabel = async (data) => {
        const { orden, tipo, clienteId, bultos, servicios, telaCliente, referencias, fechaHora } = data;

        const contenido = tipo === 'TELA DE CLIENTE' ? telaCliente : servicios.join('/'); // Fixed type string check
        const tituloContenido = tipo === 'TELA DE CLIENTE' ? 'TELA' : 'SERVICIO'; // Fixed type string check
        const refsText = Array.isArray(referencias) ? referencias.join(' | ') : referencias;

        try {
            // HTML Template embedded
            // Update loop for pages to include QR per page with specific bulto info
            // We need to generate QR for each page if we want the unique bulto info encoded in QR? 
            // "en el codigo QR incluye la referencia, y el numero de bulto 1/2"
            // Yes, QR changes per page.

            // This requires generating N QRs.
            // Or we can generate them inside the HTML using a library, but iframe isolation might block scripts or be slow.
            // Better: Generate N data URLs in JSLoop.

            const pages = [];
            for (let i = 0; i < parseInt(bultos); i++) {
                const bultoStr = `${i + 1}/${bultos}`;

                // --- MODIFICATION FOR USER REQUEST ---
                // "necesito que me dejes solo el codigo del bulto"
                // Code Format: PRE-ID-Index (e.g. PRE-9-1)
                // If orden is PRE-9: then PRE-9-1 is orden + '-' + (i+1)
                // BUT wait, is 'orden' the base "PRE-9" or the full code? 
                // createReception returns "codigoBase" (PRE-ID).
                // So here 'orden' is "PRE-9".
                // We construct the unique code.
                let uniqueCode = `${orden}`;
                if (parseInt(bultos) > 1) {
                    uniqueCode = `${orden}-${i + 1}`;
                } else {
                    // Even if 1 bulto, logic in controller says: if qty>1 then suffix, else just base?
                    // Let's check controller. 
                    // Controller: const uniqueCode = qty > 1 ? `${codigoBase}-${i + 1}` : codigoBase;
                    // BUT Logistica_Bultos inserts:
                    // PRE-9-1 even if only 1? No.
                    // Controller line 62: const uniqueCode = qty > 1 ? `${codigoBase}-${i + 1}` : codigoBase;
                    // Wait, if 1 bulto, it's just PRE-9. 
                    // BUT User said: "en el codigo qr de la etiqueta genera solo PRE-9-1 el bulto"
                    // And previously said "aca se pierde porque ya no es pre-5, sino pre-5-1".
                    // If I put just "PRE-9" for a single bulto, it's fine.
                    // If multiple, "PRE-9-1".
                    // Let's replicate Controller Logic exactly to match what is stored in DB.
                }

                // REPLICATING CONTROLLER LOGIC:
                let dbCode = orden;
                if (parseInt(bultos) > 1) {
                    dbCode = `${orden}-${i + 1}`;
                } else {
                    // Single bulto usually keeps base code in this system design OR has -1. 
                    // Controller: const uniqueCode = qty > 1 ? ... : codigoBase;
                    // So single bulto = PRE-9.
                    // Multiple = PRE-9-1, PRE-9-2.
                    // CAREFUL: User image showed PRE-9-1, 9-2, 9-3. This implies multiple.
                    // If user enters 1 bulto, code is PRE-10.
                    // The scanner expects what is in Logistica_Bultos.CodigoEtiqueta.
                    dbCode = parseInt(bultos) > 1 ? `${orden}-${i + 1}` : orden;
                }

                // QR Content: JUST THE CODE
                const qrTxt = dbCode;
                const qrUrl = await QRCode.toDataURL(qrTxt, { width: 300, margin: 2 });
                pages.push({ i, qrUrl, bultoStr, dbCode });
            }

            const htmlContent = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8">
                <title>Etiqueta ${orden}</title>
                <style>
                    @page { size: 100mm 150mm; margin: 0; }
                    body { margin:0; padding:0; background:#fff; font-family: Arial, Helvetica, sans-serif; }
                    .page {
                        width:100mm; height:150mm; box-sizing:border-box;
                        page-break-after: always; display:flex; flex-direction:column; gap:2mm;
                        padding:5mm; overflow:hidden;
                    }
                    .orden { font-size:20pt; font-weight:800; text-align:center; line-height:1; margin-bottom:2px; }
                    .info { display:grid; grid-template-columns: auto 1fr; column-gap:2mm; row-gap:1mm; font-size:10pt; line-height:1.1; }
                    .info b { font-weight:700; white-space:nowrap; }
                    .info span { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
                    .bultoInfo { font-size:11pt; font-weight:700; text-align:left; margin-top:3px; border-top:1px solid #000; padding-top:3px; }
                    .sectionTitle { text-align:center; font-size:10pt; font-weight:700; text-transform:uppercase; margin-top:5px; background:#000; color:#fff; padding:1px; }
                    .content { text-align:center; font-size:12pt; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin: 3px 0; font-weight:bold; }
                    .qrbox { flex:1; display:flex; align-items:center; justify-content:center; min-height:0; }
                    .qrbox img { width:100%; height:100%; object-fit:contain; max-height:60mm; }
                </style>
            </head>
            <body>
                ${pages.map(p => `
                <div class="page">
                    <div class="orden">${orden}</div>
                    <div class="info">
                        <b>Cliente:</b> <span>${clienteId}</span>
                        <b>Tipo:</b>    <span>${tipo.substring(0, 20)}</span>
                        <b>Fecha:</b>   <span>${fechaHora}</span>
                        <b>Refs:</b>    <span>${(refsText || '-')}</span>
                        ${data.cantidadPrendas ? `<b>Prendas:</b> <span>${data.cantidadPrendas}</span>` : ''}
                        ${data.observaciones ? `<b>Obs:</b> <span>${data.observaciones}</span>` : ''}
                    </div>
                    
                    <div class="bultoInfo">Bulto ${p.bultoStr}</div>
                    
                    <div class="sectionTitle">${tituloContenido}</div>
                    <div class="content">${contenido}</div>
                    
                    <div class="qrbox">
                        <img src="${p.qrUrl}" />
                    </div>
                </div>
                `).join('')}
                <script>
                    window.onload = () => { window.print(); }
                </script>
            </body>
            </html>
            `;

            const iframe = iframeRef.current;
            if (iframe) {
                iframe.srcdoc = htmlContent;
            }

        } catch (e) {
            console.error("Error generating QR or Print:", e);
            alert("Error al generar impresión.");
        }
    };

    return (
        <div className="p-6 bg-slate-50 min-h-screen">
            <iframe ref={iframeRef} className="hidden" title="PrintFrame" />

            <div className="max-w-6xl mx-auto space-y-6">

                {/* HEADERS & TABS */}
                <div className="flex flex-col gap-4">
                    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 flex justify-between items-center">
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">Atención al Cliente</h1>
                            <p className="text-slate-500 text-sm">Gestion de Ingresos y Despachos</p>
                        </div>
                        {activeTab === 'reception' && (
                            <div className="px-4 py-2 bg-emerald-100 text-emerald-700 rounded-lg font-mono font-bold text-xl border border-emerald-200">
                                {nextCode}
                            </div>
                        )}
                    </div>

                    {/* TABS REMOVED - ONLY RECEPTION VIEW AVAILABLE */}
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* LEFT COLUMN: FORM */}
                    <div className="lg:col-span-2 space-y-6">
                        {/* ... form content ... */}

                        {/* MAIN FORM CARD */}
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 space-y-6">

                            {/* 1. Cliente & Tipo */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="relative">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Cliente *</label>
                                    <input
                                        type="text"
                                        className={`w-full p-2.5 border rounded-lg font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none ${errors.clienteId ? 'border-red-500' : 'border-slate-300'}`}
                                        placeholder="Buscar Cliente..."
                                        value={formData.clienteId}
                                        onChange={handleClientChange}
                                        list="clientOptions"
                                    />
                                    <datalist id="clientOptions">
                                        {clients.map(c => <option key={c} value={c} />)}
                                    </datalist>
                                    {errors.clienteId && <p className="text-xs text-red-500 mt-1">{errors.clienteId}</p>}
                                </div>

                                <div>
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Tipo de Ingreso *</label>
                                    <select
                                        className="w-full p-2.5 border border-slate-300 rounded-lg font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                                        value={formData.tipo}
                                        onChange={(e) => {
                                            setFormData({ ...formData, tipo: e.target.value, servicios: [] }); // Reset services on type change
                                        }}
                                    >
                                        <option value="PAQUETE DE PRENDAS">📦 Paquete de Prendas</option>
                                        <option value="TELA DE CLIENTE">🧵 Tela de Cliente</option>
                                    </select>
                                </div>
                            </div>

                            {/* 2. Dynamic Content (Services or Tela) */}
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                                {formData.tipo === 'PAQUETE DE PRENDAS' || formData.tipo === 'TELA DE CLIENTE' ? (
                                    <div className="space-y-4">
                                        {/* DESCRIPCIÓN DE TELA SI ES TELA */}
                                        {/* FORMULARIO TELA DE CLIENTE */}
                                        {formData.tipo === 'TELA DE CLIENTE' && (
                                            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">

                                                {/* Area Destino */}
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Área Destino *</label>
                                                    <select
                                                        className={`w-full p-2.5 border rounded-lg font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 ${errors.areaDestino ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}
                                                        value={formData.areaDestino}
                                                        onChange={(e) => setFormData({ ...formData, areaDestino: e.target.value })}
                                                    >
                                                        <option value="">-- Seleccionar --</option>
                                                        {/* SOLO SUBLIMACION Y CORTE */}
                                                        {areasList.filter(a => {
                                                            const id = a.AreaID;
                                                            const name = a.Nombre.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                                                            // Filter by Specific IDs (SB, TWC) OR Name match (Sublimacion, Corte)
                                                            return ['SB', 'TWC'].includes(id) || name.includes('SUBLIMA') || name.includes('CORTE');
                                                        }).map(a => (
                                                            <option key={a.AreaID} value={a.AreaID}>{a.Nombre}</option>
                                                        ))}
                                                    </select>
                                                    {errors.areaDestino && <p className="text-xs text-red-500 mt-1">{errors.areaDestino}</p>}
                                                </div>

                                                {/* Insumo Selector (FIXED to TELA CLIENTE) */}
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Insumo / Material</label>
                                                    {insumosList.find(i => i.Nombre.toUpperCase().includes('TELA CLIENTE')) ? (
                                                        // Si existe TELA CLIENTE, lo mostramos fijo
                                                        <div className="w-full p-2.5 border border-slate-200 bg-slate-100 rounded-lg text-slate-600 font-bold select-none flex items-center justify-between">
                                                            <span>
                                                                {insumosList.find(i => i.Nombre.toUpperCase().includes('TELA CLIENTE')).Nombre}
                                                            </span>
                                                            <i className="fa-solid fa-lock text-slate-400 text-xs"></i>
                                                        </div>
                                                    ) : (
                                                        // Fallback si no existe (deberia existir)
                                                        <select
                                                            className={`w-full p-2.5 border rounded-lg font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 ${errors.insumoId ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}
                                                            value={formData.insumoId}
                                                            onChange={(e) => setFormData({ ...formData, insumoId: e.target.value })}
                                                        >
                                                            <option value="">-- Seleccionar --</option>
                                                            {insumosList.map(ins => (
                                                                <option key={ins.InsumoID} value={ins.InsumoID}>{ins.Nombre}</option>
                                                            ))}
                                                        </select>
                                                    )}
                                                    {errors.insumoId && <p className="text-xs text-red-500 mt-1">{errors.insumoId}</p>}
                                                </div>

                                                {/* Metros & Lote */}
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Metros por Bobina *</label>
                                                        <input
                                                            type="number"
                                                            step="0.01"
                                                            className={`w-full p-2.5 border rounded-lg font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 ${errors.metros ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}
                                                            placeholder="0.00"
                                                            value={formData.metros}
                                                            onChange={(e) => setFormData({ ...formData, metros: e.target.value })}
                                                        />
                                                        {errors.metros && <p className="text-xs text-red-500 mt-1">{errors.metros}</p>}
                                                    </div>
                                                    <div>
                                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Lote Proveedor</label>
                                                        <input
                                                            type="text"
                                                            className="w-full p-2.5 border border-slate-300 rounded-lg font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500"
                                                            placeholder="Opcional..."
                                                            value={formData.loteProv}
                                                            onChange={(e) => setFormData({ ...formData, loteProv: e.target.value })}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Descripcion Extra -> AHORA OBLIGATORIO Y PRINCIPAL */}
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Tipo de Tela / Descripción *</label>
                                                    <input
                                                        type="text"
                                                        className={`w-full p-3 border rounded-lg font-bold focus:ring-2 focus:ring-blue-500 outline-none ${errors.telaCliente ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}
                                                        placeholder="Ej: Algodón Jersey Negro..."
                                                        value={formData.telaCliente}
                                                        onChange={(e) => setFormData({ ...formData, telaCliente: e.target.value })}
                                                    />
                                                    {errors.telaCliente && <p className="text-xs text-red-500 mt-1">{errors.telaCliente}</p>}
                                                </div>
                                            </div>
                                        )}

                                        {/* SERVICIOS (Solo para PAQUETE DE PRENDAS) */}
                                        {formData.tipo === 'PAQUETE DE PRENDAS' && (
                                            <div>
                                                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Servicios Solicitados *</label>
                                                <div className="flex flex-wrap gap-2">
                                                    {servicesList.filter(srv => {
                                                        const s = srv.toLowerCase();
                                                        // Solo Bordado o Estampado para Paquetes
                                                        return s.includes('bordado') || s.includes('estampado') || s.includes('costura');
                                                    }).map(srv => (
                                                        <button
                                                            key={srv}
                                                            onClick={() => handleServiceToggle(srv)}
                                                            className={`px-3 py-1.5 rounded-full text-sm font-semibold transition-all shadow-sm ${formData.servicios.includes(srv)
                                                                ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                                                                : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                                                                }`}
                                                        >
                                                            {formData.servicios.includes(srv) && <i className="fa-solid fa-check mr-1.5"></i>}
                                                            {srv}
                                                        </button>
                                                    ))}
                                                    {servicesList.length === 0 && <span className="text-xs text-slate-400 font-style-italic">Cargando servicios...</span>}
                                                </div>
                                                {errors.servicios && <p className="text-xs text-red-500 mt-2">{errors.servicios}</p>}
                                            </div>
                                        )}
                                    </div>
                                ) : null}
                            </div>

                            {/* 3. Bultos, Referencias & Observaciones */}
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {/* Bultos y Cantidad */}
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-xs font-bold text-slate-500 uppercase mb-1">
                                            {formData.tipo === 'TELA DE CLIENTE' ? 'Bobinas' : 'Bultos'}
                                        </label>
                                        <input
                                            type="number"
                                            min="1"
                                            className="w-full p-2.5 border border-slate-300 rounded-lg font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                                            value={formData.bultos}
                                            onChange={(e) => setFormData({ ...formData, bultos: Math.max(1, parseInt(e.target.value) || 1) })}
                                        />
                                    </div>

                                    {/* NUEVO: Total Prendas (Solo para Paquetes) */}
                                    {formData.tipo === 'PAQUETE DE PRENDAS' && (
                                        <div className="animate-in fade-in zoom-in duration-300">
                                            <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Total Prendas</label>
                                            <input
                                                type="number"
                                                min="1"
                                                className="w-full p-2.5 border border-slate-300 rounded-lg font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                                                placeholder="Total..."
                                                value={formData.cantidadPrendas || ''}
                                                onChange={(e) => setFormData({ ...formData, cantidadPrendas: e.target.value })}
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex justify-between">
                                        <span>Referencias (OC / Pedido Pendiente)</span>
                                        <button onClick={addRef} className="text-blue-500 hover:text-blue-700 text-[10px] uppercase font-bold">+ Agregar</button>
                                    </label>
                                    <div className="space-y-2">
                                        {formData.referencias.map((ref, idx) => (
                                            <div key={idx} className="flex gap-2 relative">
                                                {/* Si tenemos ordenes (TELA o PAQUETE), mostramos SELECT. Si no, Input libre */}
                                                {possibleOrders.length > 0 ? (
                                                    <select
                                                        className="flex-1 p-2 border border-slate-300 rounded-lg text-sm bg-white"
                                                        value={ref}
                                                        onChange={(e) => handleRefChange(idx, e.target.value)}
                                                    >
                                                        <option value="">-- Seleccionar Orden Pendiente --</option>
                                                        {possibleOrders.map(o => (
                                                            <option key={o.OrdenID} value={o.CodigoOrden}>
                                                                {o.CodigoOrden} ({o.DescripcionTrabajo ? o.DescripcionTrabajo.substring(0, 30) : ''})
                                                            </option>
                                                        ))}
                                                        <option value="OTRA">Otra / Manual...</option>
                                                    </select>
                                                ) : (
                                                    <>
                                                        <input
                                                            type="text"
                                                            className="flex-1 p-2 border border-slate-300 rounded-lg text-sm"
                                                            placeholder={`Ref #${idx + 1} o Seleccionar Orden`}
                                                            value={ref}
                                                            onChange={(e) => handleRefChange(idx, e.target.value)}
                                                            list={`ordersList-${idx}`}
                                                        />
                                                        <datalist id={`ordersList-${idx}`}>
                                                            {/* No usamos clientOrders aqui sino sugerencias generales si hubieran, o nada */}
                                                        </datalist>
                                                    </>
                                                )}

                                                {formData.referencias.length > 1 && (
                                                    <button onClick={() => removeRef(idx)} className="text-slate-400 hover:text-red-500 px-2">
                                                        <i className="fa-solid fa-trash"></i>
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        {possibleOrders.length === 0 && formData.tipo === 'TELA DE CLIENTE' && formData.clienteId && <p className="text-[10px] text-slate-400 italic">No se encontraron órdenes pendientes para tela.</p>}
                                    </div>
                                </div>


                                {/* Observaciones */}
                                <div className="md:col-span-3">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Observaciones</label>
                                    <textarea
                                        rows="2"
                                        className="w-full p-2.5 border border-slate-300 rounded-lg text-slate-700 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                        placeholder="Notas adicionales..."
                                        value={formData.observaciones || ''}
                                        onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
                                    />
                                </div>
                            </div>


                            {/* ACTIONS */}
                            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                                <button onClick={handleReset} className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg font-semibold transition-colors">
                                    Cancelar / Reset
                                </button>
                                <button
                                    onClick={handleSaveAndPrint}
                                    disabled={loading}
                                    className="px-6 py-3 bg-slate-900 text-white rounded-lg font-bold hover:bg-slate-800 shadow-lg shadow-slate-900/20 active:scale-95 transition-all flex items-center gap-2"
                                >
                                    {loading ? (
                                        <>Procesando...</>
                                    ) : (
                                        <><i className="fa-solid fa-print"></i> Guardar e Imprimir</>
                                    )}
                                </button>
                            </div>
                            {message && (
                                <div className={`p-3 rounded-lg text-sm font-bold text-center ${message.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                                    {message.text}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT COLUMN: HISTORY */}
                    <div className="space-y-4">
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 h-full flex flex-col">
                            <div className="flex justify-between items-center mb-4">
                                <h2 className="font-bold text-slate-700">Historial Reciente</h2>
                                <button onClick={loadHistory} className="text-slate-400 hover:text-blue-500"><i className="fa-solid fa-rotate-right"></i></button>
                            </div>

                            {/* Mini Filters */}
                            <div className="grid grid-cols-2 gap-2 mb-3 text-xs">
                                <input
                                    placeholder="Cliente..."
                                    className="p-1.5 border rounded"
                                    value={historyFilters.cliente}
                                    onChange={e => setHistoryFilters({ ...historyFilters, cliente: e.target.value })}
                                />
                                <input
                                    placeholder="Orden..."
                                    className="p-1.5 border rounded"
                                    value={historyFilters.orden}
                                    onChange={e => setHistoryFilters({ ...historyFilters, orden: e.target.value })}
                                />
                                <button onClick={loadHistory} className="col-span-2 bg-slate-100 py-1 rounded text-slate-600 font-bold hover:bg-slate-200">Buscar</button>
                            </div>

                            <div className="flex-1 overflow-auto max-h-[600px] space-y-3 pr-1">
                                {historyLoading ? (
                                    <p className="text-center text-slate-400 text-sm py-4">Cargando...</p>
                                ) : history.length === 0 ? (
                                    <p className="text-center text-slate-400 text-sm py-4">Sin registros.</p>
                                ) : (
                                    history.map(item => (
                                        <div key={item.RecepcionID} className="p-3 border rounded-lg hover:shadow-md transition-shadow bg-slate-50 group">
                                            <div className="flex justify-between items-start">
                                                <div>
                                                    <span className="text-xs font-bold text-slate-500 block">{item.Codigo}</span>
                                                    <h4 className="font-bold text-slate-800 text-sm">{item.Cliente}</h4>
                                                    <p className="text-xs text-slate-600 mt-1 line-clamp-2">{item.Detalle}</p>
                                                    <p className="text-[10px] text-slate-400 mt-1">{new Date(item.FechaRecepcion).toLocaleDateString()} {new Date(item.FechaRecepcion).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                                                </div>
                                                <button
                                                    onClick={() => {
                                                        const isTela = item.Tipo === 'TELA CLIENTE';
                                                        printLabel({
                                                            orden: item.Codigo,
                                                            clienteId: item.Cliente,
                                                            tipo: item.Tipo,
                                                            bultos: item.CantidadBultos,
                                                            servicios: isTela ? [] : (item.Detalle || '').split('/'),
                                                            telaCliente: isTela ? (item.Detalle || '').replace('TELA: ', '') : '',
                                                            referencias: item.Referencias,
                                                            fechaHora: new Date(item.FechaRecepcion).toLocaleString()
                                                        });
                                                    }}
                                                    className="opacity-0 group-hover:opacity-100 p-2 bg-white border rounded shadow text-slate-600 hover:text-blue-600 transition-all"
                                                    title="Reimprimir Etiqueta"
                                                >
                                                    <i className="fa-solid fa-print"></i>
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>

            </div>
        </div >
    );
};

export default ReceptionPage;
