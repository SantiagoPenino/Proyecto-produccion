import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { receptionService } from '../../../services/api';
import ClienteTelaMetros from '../../common/ClienteTelaMetros';

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
        tipo: 'PAQUETE DE PRENDAS',
        bultos: 1,
        servicios: [],
        telaCliente: '',
        referencias: [''],
        // Campos para TELA DE CLIENTE: tabla de bobinas
        bobinas: [{ largo: '', ancho: '', peso: '' }],
        // Campos legacy para otros tipos
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

    // Usuario logueado (operario de producción)
    // AuthContext guarda: { id, nombre, usuario, rol, areaKey, token }
    const currentUser    = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
    const operarioNombre = currentUser?.nombre || currentUser?.usuario || currentUser?.name || 'Operario';

    // ── Búsqueda de cliente estilo CAJA ──────────────────────────────
    const [clienteObj,       setClienteObj]       = useState(null);   // objeto completo del cliente
    const [qCliente,         setQCliente]         = useState('');
    const [clienteResultados,setClienteResultados]= useState([]);
    const [buscandoCli,      setBuscandoCli]      = useState(false);
    const searchTimeoutRef   = useRef(null);

    // Refs para impresión
    const iframeRef       = useRef(null);
    const iframeTicketRef = useRef(null);

    // Filter Suggestions (legacy para otros usos)
    const [clientSuggestions, setClientSuggestions] = useState([]);
    const [possibleOrders,    setPossibleOrders]     = useState([]);

    // ── Stock de tela del cliente (para "sumar a tela existente") ─────
    const [saldosTela,       setSaldosTela]       = useState([]);
    const [telaSeleccionada, setTelaSeleccionada] = useState(null);  // { InsumoID, TipoTela, MetrosLibres }
    const [sumarAExistente,  setSumarAExistente]  = useState(null);  // null=sin responder | true=sí | false=no

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

    // ── Búsqueda de clientes full (estilo caja) ──────────────────────
    useEffect(() => {
        if (!qCliente.trim() || qCliente.length < 2) { setClienteResultados([]); return; }
        if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
        searchTimeoutRef.current = setTimeout(async () => {
            setBuscandoCli(true);
            try {
                // Usamos el endpoint unificado de búsqueda de clientes
                const res = await receptionService.searchClientes(qCliente);
                setClienteResultados(Array.isArray(res) ? res.slice(0, 8) : []);
            } catch { setClienteResultados([]); }
            finally { setBuscandoCli(false); }
        }, 350);
    }, [qCliente]);

    const seleccionarClienteCompleto = (c) => {
        setClienteObj(c);
        // Guardar el ID numérico del cliente (CliIdCliente) para InventarioBobinas.ClienteID
        const idCliente = String(c.CliIdCliente || c.IDCliente || c.Nombre?.trim() || '');
        setFormData(prev => ({ ...prev, clienteId: idCliente }));
        setQCliente('');
        setClienteResultados([]);
        fetchClientOrders(idCliente);
    };

    // ── Cargar saldo de telas cuando tipo=TELA y hay cliente ──────────
    useEffect(() => {
        if (formData.tipo === 'TELA DE CLIENTE' && formData.clienteId?.trim()) {
            receptionService.getSaldoTelas(formData.clienteId.trim())
                .then(data => setSaldosTela(data || []))
                .catch(() => setSaldosTela([]));
        } else {
            setSaldosTela([]);
            setTelaSeleccionada(null);
        }
    }, [formData.clienteId, formData.tipo]);

    const limpiarCliente = () => {
        setClienteObj(null);
        setFormData(prev => ({ ...prev, clienteId: '', telaCliente: '' }));
        setQCliente('');
        setClienteResultados([]);
        setClientOrders([]);
        setPossibleOrders([]);
        setSaldosTela([]);
        setTelaSeleccionada(null);
        setSumarAExistente(null);
    };



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
        // legacy fallback — usado sólo si clienteObj es null
        if (val.length > 1) {
            const matches = clients.filter(c => c.toLowerCase().includes(val.toLowerCase())).slice(0, 10);
            setClientSuggestions(matches);
            if (clients.includes(val)) fetchClientOrders(val);
        } else {
            setClientSuggestions([]);
            setClientOrders([]);
        }
    };

    const handleClientBlur = () => {
        if (clients.includes(formData.clienteId)) fetchClientOrders(formData.clienteId);
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
            // Validar que al menos 1 bobina tenga largo > 0
            const tieneMetros = formData.bobinas.some(b => parseFloat(b.largo) > 0);
            if (!tieneMetros) errs.metros = 'Ingresá el largo de al menos una bobina (>0)';
            // Descr. Tela
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
            bobinas: [{ largo: '', ancho: '', peso: '' }],
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
            const esTelaPago = formData.tipo === 'TELA DE CLIENTE';
            const metrosTotal = esTelaPago
                ? formData.bobinas.reduce((s, b) => s + (parseFloat(b.largo) || 0), 0)
                : parseFloat(formData.metros) || 0;
            const payload = {
                ...formData,
                referencias: formData.referencias.filter(r => r.trim()),
                // Para TELA DE CLIENTE: total de metros calculado y cantidad de bobinas
                metros: metrosTotal,
                bultos: esTelaPago ? formData.bobinas.length : formData.bultos,
                // Pasar si está sumando a tela existente
                sumaTelaExistente: sumarAExistente === true && telaSeleccionada ? telaSeleccionada.TipoTela : null,
            };
            const res = await receptionService.createReception(payload);

            if (res.success) {
                // Nombre del operario: usar el que devuelve el backend, o el local
                const operadorFinal = res.operario || operarioNombre;
                setMessage({ type: 'success', text: `Orden ${res.ordenAsignada} guardada. Operario: ${operadorFinal}` });
                const printData = {
                    orden:             res.ordenAsignada,
                    ...payload,
                    fechaHora:         new Date().toLocaleString(),
                    operario:          operadorFinal,
                    // Nombre del cliente para mostrar en ticket (no el ID)
                    clienteNombre:     clienteObj?.Nombre || clienteObj?.RazonSocial || payload.clienteId,
                    // IDCliente numérico de la tabla Clientes (no CliIdCliente)
                    idCliente:         clienteObj?.IDCliente || clienteObj?.CliIdCliente || payload.clienteId,
                };
                // 2. Print etiqueta de bodega
                await printLabel(printData);
                // 3. Si es TELA DE CLIENTE, imprimir también el ticket para el cliente
                //    Esperamos 1.2 s para que el diálogo de impresión de la etiqueta no colisione
                if (payload.tipo === 'TELA DE CLIENTE') {
                    await new Promise(resolve => setTimeout(resolve, 1200));
                    await printClientTicket(printData);
                }
                // 4. Reset & Reload
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

    // Ticket para entregar al CLIENTE — idéntico al ticket de caja
    // El PDF se guarda automáticamente en el BACKEND al crear la recepción (generarComprobanteRecepcion)
    const printClientTicket = async (data) => {
        const { orden, clienteId, clienteNombre, bultos, metros, telaCliente,
                bobinas,
                areaDestino, loteProv, observaciones, fechaHora, operario, sumaTelaExistente } = data;

        const areaLabel      = areasList.find(a => a.AreaID === areaDestino)?.Nombre || areaDestino || '-';
        // Nombre real del operario desde AuthContext (key: "nombre")
        const localUser      = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
        const operadorFinal  = operario
            || localUser?.nombre || localUser?.usuario || localUser?.name
            || 'Operario';
        const clienteFinal   = clienteNombre || clienteId;

        // Línea opcional: "SUMA A: Seda Americana"
        const sumaLine = sumaTelaExistente
            ? `<p><strong>SUMA A   :</strong> ${sumaTelaExistente}</p>`
            : '';

        // ── 1. IMPRIMIR en ventana nueva — mismo patrón exacto que caja ──────────
        const win = window.open('', '_blank', 'width=340,height=600');
        if (win) {
            win.document.write(`<html><head><title>Comprobante ${orden}</title>
            <style>
              *{margin:0;padding:0;box-sizing:border-box}
              body{font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.2;padding:5mm;width:80mm;background:#fff;color:#000}
              h2{font-size:18px;font-weight:bold;text-align:center;margin:0 0 3px}
              .sub{text-align:center;font-size:10px;color:#444;margin-bottom:8px}
              .sep{border-bottom:1px dashed #000;margin:8px 0}
              p{margin:2px 0}
              .pie{text-align:center;font-size:10px;color:#999;margin-top:16px}
              @page{size:80mm auto;margin:0}
            </style></head><body>
            <h2>USER</h2>
            <div class="sub">Atencion al Cliente<br>Comprobante de Recepcion de Tela</div>
            <div class="sep"></div>
            <p><strong>FECHA  :</strong> ${fechaHora}</p>
            <p><strong>TICKET :</strong> ${orden}</p>
            <p><strong>AREA   :</strong> ${areaLabel}</p>
            <p><strong>RECIBIO:</strong> ${operadorFinal}</p>
            <p><strong>CLIENTE:</strong> ${clienteFinal}</p>
            <div class="sep"></div>
            <p><strong>TIPO TELA  :</strong> ${telaCliente || '-'}</p>
            ${sumaLine}
            ${(() => {
                // Si hay bobinas con medidas individuales, mostramos tabla por bobina
                if (Array.isArray(bobinas) && bobinas.length > 0 && bobinas.some(b => b.largo)) {
                    const totalMts = bobinas.reduce((s,b) => s + (parseFloat(b.largo)||0), 0);
                    const rows = bobinas.map((b,i) => {
                        const partes = [`L:${parseFloat(b.largo||0).toFixed(2)}m`];
                        if (b.ancho) partes.push(`A:${parseFloat(b.ancho).toFixed(2)}m`);
                        if (b.peso)  partes.push(`P:${parseFloat(b.peso).toFixed(2)}kg`);
                        return `<p><strong>BOB. ${i+1}  :</strong> ${partes.join(' · ')}</p>`;
                    }).join('');
                    return `<p><strong>MTS TOTAL  :</strong> ${totalMts.toFixed(2)} m</p>${rows}`;
                }
                return `<p><strong>MTS DECL.  :</strong> ${metros ? parseFloat(metros).toFixed(2) + ' m' : '-'}</p>`;
            })()}
            <p><strong>BULTOS     :</strong> ${Array.isArray(bobinas) && bobinas.length > 0 ? bobinas.length : bultos}</p>
            ${loteProv      ? `<p><strong>LOTE PROV. :</strong> ${loteProv}</p>` : ''}
            ${observaciones ? `<p><strong>OBS        :</strong> ${observaciones}</p>` : ''}
            <div class="sep"></div>
            <div class="pie"><p>Conserve este comprobante</p><p>Servicio brindado por USER ERP</p></div>
            <div style="height:10mm"></div>
            </body></html>`);
            win.document.close();
            win.focus();
            win.addEventListener('afterprint', () => win.close());
            setTimeout(() => win.print(), 800);
        }
        // NOTA: El PDF se guardó automáticamente en el BACKEND (comprobantesPagos/recepciones/PRE-XX.pdf)
        // No es necesario volver a guardar desde el frontend.
    };

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
            // Para TELA DE CLIENTE con bobinas individuales, iteramos el array
            const bobinasList = (tipo === 'TELA DE CLIENTE' && Array.isArray(data.bobinas) && data.bobinas.length > 0)
                ? data.bobinas
                : null;
            const totalBultos = bobinasList ? bobinasList.length : parseInt(bultos);

            for (let i = 0; i < totalBultos; i++) {
                const bultoStr = `${i + 1}/${totalBultos}`;
                const bDatos  = bobinasList ? bobinasList[i] : null;

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
                pages.push({ i, qrUrl, bultoStr, dbCode, bDatos });
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
                    .bultoInfo { font-size:20pt; font-weight:800; text-align:center; margin-top:4px; padding-top:4px; line-height:1; }
                    .sectionTitle { text-align:center; font-size:10pt; font-weight:700; text-transform:uppercase; margin-top:5px; background:#000; color:#fff; padding:1px; }
                    .content { text-align:center; font-size:12pt; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin: 3px 0; font-weight:bold; }
                    .qrbox { flex:1; display:flex; align-items:center; justify-content:center; min-height:0; }
                    .qrbox img { width:100%; height:100%; object-fit:contain; max-height:55mm; }
                </style>
            </head>
            <body>
                ${pages.map(p => `
                <div class="page">
                    <div class="orden">${orden}</div>
                    <div class="info">
                        <b>Cliente:</b> <span>${data.idCliente || clienteId}</span>
                        <b>Tipo:</b>    <span>${tipo.substring(0, 20)}</span>
                        <b>Fecha:</b>   <span>${fechaHora}</span>
                        <b>Refs:</b>    <span>${(refsText || '-')}</span>
                        ${data.cantidadPrendas ? `<b>Prendas:</b> <span>${data.cantidadPrendas}</span>` : ''}
                        ${data.observaciones ? `<b>Obs:</b> <span>${data.observaciones}</span>` : ''}
                        ${p.bDatos && p.bDatos.largo  ? `<b>Largo:</b>  <span>${parseFloat(p.bDatos.largo).toFixed(2)} m</span>` : ''}
                        ${p.bDatos && p.bDatos.ancho  ? `<b>Ancho:</b>  <span>${parseFloat(p.bDatos.ancho).toFixed(2)} m</span>` : ''}
                        ${p.bDatos && p.bDatos.peso   ? `<b>Peso:</b>   <span>${parseFloat(p.bDatos.peso).toFixed(2)} kg</span>` : ''}
                    </div>

                    <div class="qrbox">
                        <img src="${p.qrUrl}" />
                    </div>

                    <div class="bultoInfo">Bulto ${p.bultoStr}</div>

                    <div class="sectionTitle">${tituloContenido}</div>
                    <div class="content">${contenido}</div>
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
            <iframe ref={iframeTicketRef} className="hidden" title="TicketFrame" />

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

                            {/* ── 1. Selector de cliente estilo CAJA ── */}
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">1. Seleccionar Cliente *</label>
                                    {clienteObj && (
                                        <span className="flex items-center gap-1 text-emerald-600 text-[9px] font-black bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                            VERIFICADO ✓
                                        </span>
                                    )}
                                </div>

                                {/* ── Tipo de Ingreso (siempre visible) ── */}
                                <div>
                                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tipo de Ingreso *</label>
                                    <select
                                        className="w-full p-2.5 border border-slate-200 rounded-xl font-bold text-slate-700 focus:ring-2 focus:ring-indigo-400 outline-none bg-white shadow-sm"
                                        value={formData.tipo}
                                        onChange={(e) => setFormData({ ...formData, tipo: e.target.value, servicios: [] })}
                                    >
                                        <option value="PAQUETE DE PRENDAS">📦 Paquete de Prendas</option>
                                        <option value="TELA DE CLIENTE">🧵 Tela de Cliente</option>
                                    </select>
                                </div>

                                {/* ── Buscador (solo si no hay cliente seleccionado) ── */}
                                {!clienteObj ? (
                                    <div className="space-y-2">
                                        <div className="relative flex items-center group/search">
                                            <div className="absolute left-3.5 text-slate-400 group-focus-within/search:text-indigo-500 transition-colors">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                                            </div>
                                            <input
                                                value={qCliente}
                                                onChange={e => setQCliente(e.target.value)}
                                                placeholder="Buscar por nombre, ID, teléfono..."
                                                className={`w-full bg-slate-50 border ${errors.clienteId ? 'border-red-400' : 'border-slate-200'} hover:border-slate-300 focus:border-indigo-400 focus:bg-white rounded-xl pl-10 pr-10 py-2.5 text-sm font-bold text-slate-700 placeholder-slate-400 outline-none transition-all shadow-sm`}
                                            />
                                            {buscandoCli && (
                                                <div className="absolute right-3.5">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-indigo-400 animate-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                                                </div>
                                            )}
                                        </div>
                                        {errors.clienteId && <p className="text-xs text-red-500 font-bold">{errors.clienteId}</p>}

                                        {/* Resultados de búsqueda */}
                                        {clienteResultados.length > 0 && (
                                            <div className="flex flex-col gap-1.5 mt-1 max-h-64 overflow-y-auto">
                                                {clienteResultados.map((c, i) => {
                                                    const nombre = c.Nombre?.trim() || c.NombreFantasia?.trim() || c.IDCliente;
                                                    const fantasia = c.NombreFantasia?.trim();
                                                    return (
                                                        <button
                                                            key={c.CliIdCliente || c.IDCliente || i}
                                                            type="button"
                                                            onClick={() => seleccionarClienteCompleto(c)}
                                                            className="w-full text-left p-3 bg-slate-50 hover:bg-indigo-50 border border-slate-200 hover:border-indigo-300 rounded-xl cursor-pointer transition-all flex flex-col gap-1 group"
                                                        >
                                                            <div className="flex items-start justify-between">
                                                                <span className="text-slate-800 font-extrabold text-sm group-hover:text-indigo-600 transition-colors leading-tight">{nombre}</span>
                                                                {(c.IDCliente || c.CliIdCliente) && (
                                                                    <span className="text-[9px] bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded font-mono font-black shrink-0 ml-2">{c.IDCliente || c.CliIdCliente}</span>
                                                                )}
                                                            </div>
                                                            {fantasia && nombre !== fantasia && (
                                                                <span className="text-[10px] text-slate-500 italic">"{fantasia}"</span>
                                                            )}
                                                            <div className="flex flex-wrap gap-x-3 text-[10px] text-slate-400 font-medium border-t border-slate-200/60 pt-1 mt-0.5">
                                                                {c.Email && <span>✉ {c.Email}</span>}
                                                                {c.Telefono && <span>📞 {c.Telefono}</span>}
                                                            </div>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                        {qCliente.trim().length >= 2 && !buscandoCli && clienteResultados.length === 0 && (
                                            <p className="text-center py-4 text-slate-400 text-xs font-semibold">No se encontraron clientes</p>
                                        )}
                                        {!qCliente.trim() && (
                                            <p className="text-center py-4 text-slate-300 text-xs font-semibold">Use el buscador para encontrar un cliente...</p>
                                        )}
                                    </div>
                                ) : (
                                    /* ── Tarjeta cliente seleccionado ── */
                                    <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-xl p-4 shadow-sm space-y-3">
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center text-indigo-500 border border-indigo-200/60 shadow-sm">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                                                </div>
                                                <div>
                                                    <p className="text-slate-800 text-sm font-extrabold leading-tight tracking-tight">
                                                        {clienteObj.Nombre?.trim() || clienteObj.NombreFantasia?.trim()}
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5 font-mono">
                                                        IDCLIENTE: {clienteObj.IDCliente || clienteObj.CliIdCliente || '—'}
                                                    </p>
                                                </div>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={limpiarCliente}
                                                className="bg-white hover:bg-rose-50 text-slate-400 hover:text-rose-600 p-1.5 rounded-lg transition-all border border-slate-200 hover:border-rose-200 shadow-sm"
                                                title="Cambiar cliente"
                                            >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                                            </button>
                                        </div>

                                        {/* Datos del cliente */}
                                        <div className="flex flex-col gap-1 text-[11px] text-slate-500 font-medium border-t border-slate-200/60 pt-2.5">
                                            {clienteObj.Email && <div>Email: <span className="font-mono text-slate-700">{clienteObj.Email}</span></div>}
                                            {(clienteObj.Telefono || clienteObj.TelefonoTrabajo) && <div>Teléfono: <span className="font-mono text-slate-700">{clienteObj.Telefono || clienteObj.TelefonoTrabajo}</span></div>}
                                            {(clienteObj.Direccion || clienteObj.DireccionTrabajo) && <div>Dirección: <span className="text-slate-700">{clienteObj.Direccion || clienteObj.DireccionTrabajo}</span></div>}
                                        </div>

                                        {/* ── Badges informativos de tela (solo display, compactos) ── */}
                                        {formData.tipo === 'TELA DE CLIENTE' && saldosTela.length > 0 && (
                                            <div className="border-t border-slate-200/60 pt-2.5">
                                                <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-2">Stock de tela actual</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {saldosTela.map(s => {
                                                        const libre = parseFloat(s.MetrosLibres || s.MetrosDisponibles || 0);
                                                        const pct   = parseFloat(s.PorcentajeConsumido || 0);
                                                        const dotColor = pct >= 80 ? 'bg-rose-400' : pct >= 50 ? 'bg-amber-400' : 'bg-cyan-400';
                                                        return (
                                                            <span key={s.InsumoID}
                                                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-800 border border-slate-700 text-[10px] font-bold text-slate-200 whitespace-nowrap">
                                                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                                                                <span className="uppercase tracking-tight text-slate-300">{s.TipoTela}</span>
                                                                <span className="font-mono text-cyan-400">{Number(libre).toFixed(2)}m</span>
                                                                {s.CantidadBultos > 0 && (
                                                                    <span className="text-slate-500 font-normal">·</span>
                                                                )}
                                                                {s.CantidadBultos > 0 && (
                                                                    <span className="text-amber-400 font-mono">{s.CantidadBultos} bob</span>
                                                                )}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* 2. Dynamic Content (Services or Tela) */}
                            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                                {formData.tipo === 'PAQUETE DE PRENDAS' || formData.tipo === 'TELA DE CLIENTE' ? (
                                    <div className="space-y-4">
                                        {/* DESCRIPCIÓN DE TELA SI ES TELA */}
                                        {/* FORMULARIO TELA DE CLIENTE */}
                                        {formData.tipo === 'TELA DE CLIENTE' && (
                                            <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">

                                                {/* ── 1. Área Destino ── */}
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Área Destino *</label>
                                                    <select
                                                        className={`w-full p-2.5 border rounded-lg font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 ${errors.areaDestino ? 'border-red-500 bg-red-50' : 'border-slate-300'}`}
                                                        value={formData.areaDestino}
                                                        onChange={(e) => setFormData({ ...formData, areaDestino: e.target.value })}
                                                    >
                                                        <option value="">-- Seleccionar --</option>
                                                        {areasList.filter(a => {
                                                            const id   = a.AreaID;
                                                            const name = a.Nombre.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                                                            return ['SB','TWC'].includes(id) || name.includes('SUBLIMA') || name.includes('CORTE');
                                                        }).map(a => (
                                                            <option key={a.AreaID} value={a.AreaID}>{a.Nombre}</option>
                                                        ))}
                                                    </select>
                                                    {errors.areaDestino && <p className="text-xs text-red-500 mt-1">{errors.areaDestino}</p>}
                                                </div>

                                                {/* ── Insumo fijo TELA CLIENTE ── */}
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Insumo / Material</label>
                                                    {insumosList.find(i => i.Nombre.toUpperCase().includes('TELA CLIENTE')) ? (
                                                        <div className="w-full p-2.5 border border-slate-200 bg-slate-100 rounded-lg text-slate-600 font-bold select-none flex items-center justify-between">
                                                            <span>{insumosList.find(i => i.Nombre.toUpperCase().includes('TELA CLIENTE')).Nombre}</span>
                                                            <i className="fa-solid fa-lock text-slate-400 text-xs"></i>
                                                        </div>
                                                    ) : (
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

                                                {/* Pregunta sumar-a-existente eliminada — cada ingreso es una bobina nueva independiente */}


                                                {/* ── 3. Selector de tela existente (solo si sumarAExistente=true) ── */}
                                                {sumarAExistente === true && saldosTela.length > 0 && (
                                                    <div className="space-y-2">
                                                        <label className="block text-xs font-bold text-slate-500 uppercase">Seleccionar tela a sumar *</label>
                                                        <div className="space-y-1.5">
                                                            {saldosTela.map(s => {
                                                                const libre = parseFloat(s.MetrosLibres || s.MetrosDisponibles || 0);
                                                                const pct   = parseFloat(s.PorcentajeConsumido || 0);
                                                                const isSel = telaSeleccionada?.InsumoID === s.InsumoID && telaSeleccionada?.TipoTela === s.TipoTela;
                                                                const barColor = pct >= 80 ? 'bg-rose-400' : pct >= 50 ? 'bg-amber-400' : 'bg-cyan-400';
                                                                return (
                                                                    <button key={`${s.InsumoID}-${s.TipoTela}`} type="button"
                                                                        onClick={() => {
                                                                            setTelaSeleccionada(isSel ? null : s);
                                                                            setFormData(p => ({ ...p, telaCliente: isSel ? '' : s.TipoTela }));
                                                                        }}
                                                                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all ${
                                                                            isSel
                                                                                ? 'bg-indigo-700 border-indigo-400 ring-2 ring-indigo-400 shadow-md'
                                                                                : 'bg-slate-800 border-slate-700 hover:border-indigo-400'
                                                                        }`}
                                                                    >
                                                                        <div className={`shrink-0 ${isSel ? 'text-indigo-200' : 'text-cyan-500'}`}>
                                                                            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4.09 12.97 12 12 11 22l8.91-10.97L12 12l1-10z"/></svg>
                                                                        </div>
                                                                        <span className={`text-[11px] font-black uppercase tracking-tight truncate flex-1 text-left ${isSel ? 'text-white' : 'text-slate-300'}`}>
                                                                            {s.TipoTela}
                                                                        </span>
                                                                        <span className={`font-black font-mono text-sm shrink-0 ${isSel ? 'text-indigo-200' : 'text-white'}`}>
                                                                            {Number(libre).toLocaleString('es-UY', { minimumFractionDigits: 2 })}
                                                                            <span className="text-[9px] ml-1 uppercase text-cyan-400">mts</span>
                                                                        </span>
                                                                        <div className="w-12 shrink-0">
                                                                            <div className="w-full h-1 bg-slate-600 rounded-full overflow-hidden">
                                                                                <div className={`h-full ${barColor}`} style={{ width: `${Math.min(pct,100)}%` }} />
                                                                            </div>
                                                                        </div>
                                                                        {isSel && (
                                                                            <div className="shrink-0 w-5 h-5 rounded-full bg-indigo-400 flex items-center justify-center">
                                                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                                                            </div>
                                                                        )}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* ── 4. Tabla de Bobinas (Largo × Ancho × Peso) ── */}
                                                {(
                                                    <div className="space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <label className="block text-xs font-bold text-slate-500 uppercase">Medidas por Bobina *</label>
                                                            <span className="text-xs text-slate-400">
                                                                Total: <strong>{formData.bobinas.reduce((s,b) => s + (parseFloat(b.largo)||0), 0).toFixed(2)} m</strong>
                                                                {' · '}{formData.bobinas.length} bobina{formData.bobinas.length !== 1 ? 's' : ''}
                                                            </span>
                                                        </div>

                                                        {/* Cabecera tabla */}
                                                        <div className="grid gap-1" style={{gridTemplateColumns:'28px 1fr 1fr 1fr 28px'}}>
                                                            <div />
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase text-center">Largo (m)</div>
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase text-center">Ancho (m)</div>
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase text-center">Peso (kg)</div>
                                                            <div />
                                                        </div>

                                                        {/* Filas de bobinas */}
                                                        {formData.bobinas.map((bob, idx) => (
                                                            <div key={idx} className="grid gap-1 items-center" style={{gridTemplateColumns:'28px 1fr 1fr 1fr 28px'}}>
                                                                <span className="text-xs font-bold text-slate-400 text-center">{idx+1}</span>
                                                                <input
                                                                    type="number" step="0.01" placeholder="0.00"
                                                                    className={`w-full p-2 border rounded-lg text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 text-center ${
                                                                        errors.metros ? 'border-red-500 bg-red-50' : 'border-slate-300'
                                                                    }`}
                                                                    value={bob.largo}
                                                                    onChange={e => {
                                                                        const nb = [...formData.bobinas];
                                                                        nb[idx] = { ...nb[idx], largo: e.target.value };
                                                                        setFormData({ ...formData, bobinas: nb });
                                                                    }}
                                                                />
                                                                <input
                                                                    type="number" step="0.01" placeholder="0.00"
                                                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 text-center"
                                                                    value={bob.ancho}
                                                                    onChange={e => {
                                                                        const nb = [...formData.bobinas];
                                                                        nb[idx] = { ...nb[idx], ancho: e.target.value };
                                                                        setFormData({ ...formData, bobinas: nb });
                                                                    }}
                                                                />
                                                                <input
                                                                    type="number" step="0.01" placeholder="0.00"
                                                                    className="w-full p-2 border border-slate-300 rounded-lg text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 text-center"
                                                                    value={bob.peso}
                                                                    onChange={e => {
                                                                        const nb = [...formData.bobinas];
                                                                        nb[idx] = { ...nb[idx], peso: e.target.value };
                                                                        setFormData({ ...formData, bobinas: nb });
                                                                    }}
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        if (formData.bobinas.length === 1) return;
                                                                        setFormData({ ...formData, bobinas: formData.bobinas.filter((_,i) => i !== idx) });
                                                                    }}
                                                                    className="flex items-center justify-center w-6 h-6 rounded-full text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-30"
                                                                    disabled={formData.bobinas.length === 1}
                                                                    title="Eliminar bobina"
                                                                >✕</button>
                                                            </div>
                                                        ))}

                                                        {/* Botón agregar */}
                                                        <button
                                                            type="button"
                                                            onClick={() => setFormData({ ...formData, bobinas: [...formData.bobinas, { largo: '', ancho: '', peso: '' }] })}
                                                            className="w-full py-2 border-2 border-dashed border-slate-300 rounded-lg text-xs font-bold text-slate-500 hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50 transition-colors"
                                                        >
                                                            + Agregar bobina
                                                        </button>

                                                        {/* Lote Proveedor (general) */}
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

                                                        {errors.metros && <p className="text-xs text-red-500">{errors.metros}</p>}
                                                    </div>
                                                )}

                                                {/* ── 5. Tipo de Tela / Descripción ── */}
                                                {(
                                                    <div>
                                                        <div className="flex items-center justify-between mb-2">
                                                            <label className="text-xs font-bold text-slate-500 uppercase">Tipo de Tela / Descripción *</label>
                                                            {telaSeleccionada && (
                                                                <span className="flex items-center gap-1 text-[9px] font-black text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                                                                    🔒 Sumando a tela existente
                                                                </span>
                                                            )}
                                                        </div>
                                                        <input
                                                            type="text"
                                                            readOnly={!!telaSeleccionada}
                                                            className={`w-full p-3 border rounded-lg font-bold focus:ring-2 outline-none transition-all ${
                                                                errors.telaCliente
                                                                    ? 'border-red-500 bg-red-50'
                                                                    : telaSeleccionada
                                                                        ? 'border-indigo-300 bg-indigo-50 text-indigo-700 cursor-not-allowed focus:ring-0'
                                                                        : 'border-slate-300 focus:ring-blue-500'
                                                            }`}
                                                            placeholder="Ej: Algodón Jersey Negro..."
                                                            value={formData.telaCliente}
                                                            onChange={(e) => !telaSeleccionada && setFormData({ ...formData, telaCliente: e.target.value })}
                                                        />
                                                        {telaSeleccionada && (
                                                            <p className="text-[9px] text-indigo-500 font-bold mt-1">Descripción bloqueada — corresponde a la tela seleccionada</p>
                                                        )}
                                                        {errors.telaCliente && <p className="text-xs text-red-500 mt-1">{errors.telaCliente}</p>}
                                                    </div>
                                                )}

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
                                            Bultos
                                        </label>
                                        {formData.tipo === 'TELA DE CLIENTE' ? (
                                            // Para tela de cliente: se actualiza automáticamente con la cantidad de bobinas
                                            <div className="w-full p-2.5 border border-slate-200 bg-slate-100 rounded-lg font-black text-slate-700 text-center select-none">
                                                {formData.bobinas?.length ?? 1}
                                                <span className="text-[10px] font-normal text-slate-400 ml-1">bobina{(formData.bobinas?.length ?? 1) !== 1 ? 's' : ''}</span>
                                            </div>
                                        ) : (
                                            <input
                                                type="number"
                                                min="1"
                                                className="w-full p-2.5 border border-slate-300 rounded-lg font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                                                value={formData.bultos}
                                                onChange={(e) => setFormData({ ...formData, bultos: Math.max(1, parseInt(e.target.value) || 1) })}
                                            />
                                        )}
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

                                {/* Referencias: solo visible para PAQUETE DE PRENDAS */}
                                {formData.tipo !== 'TELA DE CLIENTE' && (
                                <div className="md:col-span-2">
                                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1 flex justify-between">
                                        <span>Referencias (OC / Pedido Pendiente)</span>
                                        <button onClick={addRef} className="text-blue-500 hover:text-blue-700 text-[10px] uppercase font-bold">+ Agregar</button>
                                    </label>
                                    <div className="space-y-2">
                                        {formData.referencias.map((ref, idx) => (
                                            <div key={idx} className="flex gap-2 relative">
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
                                    </div>
                                </div>
                                )}


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
