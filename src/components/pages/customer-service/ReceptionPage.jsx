import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { jsPDF } from 'jspdf';
import { receptionService } from '../../../services/api';
import api from '../../../services/apiClient';
import ClienteTelaMetros from '../../common/ClienteTelaMetros';
import { toast } from 'sonner';
import {
    PackagePlus, Package, Spool, Search, Loader2, UserRound, BadgeCheck, X, AlertTriangle, Lock, Zap, Check,
    Plus, Trash2, Printer, RotateCcw, History, RefreshCw, Hash, Inbox, Tag, Receipt, Mail, Phone, CheckCircle2, XCircle,
} from 'lucide-react';
import Selector from '../../ui/Selector';

import ActiveStockPage from './ActiveStockPage';

const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const BTN_CHICO = 'inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-600 hover:bg-zinc-50 hover:text-zinc-800 transition-colors';
const ROTULO = 'text-[10px] font-black uppercase tracking-widest text-zinc-400';
const ETIQUETA = `block ${ROTULO} mb-1.5`;
const ERROR = 'text-xs font-bold text-brand-magenta mt-1.5';
// Campo de texto: `clases` lleva el padding y lo propio de cada uno; con error, borde y fondo magenta.
const campo = (error, clases = 'px-3 py-2.5') => `w-full border rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 outline-none transition-colors focus:ring-2 ${error
    ? 'bg-brand-magenta/5 border-brand-magenta/50 focus:border-brand-magenta focus:ring-brand-magenta/15'
    : 'bg-white border-zinc-200 hover:border-zinc-300 focus:border-brand-cyan focus:ring-brand-cyan/15'} ${clases}`;
// Filas de bobinas: en pantallas anchas una fila (#, largo, ancho, peso, excedente, quitar); en el celular un bloque de 2 columnas.
const GRILLA_BOBINA = 'sm:grid-cols-[32px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)_32px]';

// Estética nueva (27/10/2026): encabezado con el próximo código, formulario e historial claros, tipo de ingreso en
// pastillas, selects con el Selector propio, bobinas en bloques de 2 columnas en el celular, reimpresiones siempre a la
// vista y avisos con toast en vez de alert. La lógica no cambió; las etiquetas y el ticket que se imprimen tampoco.
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
        tipo: 'TELA DE CLIENTE',
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
    // Spec 39: solicitudes de insumo abiertas del cliente ("¿esta PRE repone una solicitud?")
    const [solicitudesAbiertas, setSolicitudesAbiertas] = useState([]);
    const [solicitudRepone, setSolicitudRepone] = useState('');
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

    // ── Spec 39: solicitudes de insumo abiertas del cliente seleccionado ──
    useEffect(() => {
        const cli = formData.clienteId?.trim();
        if (!clienteObj || !cli) { setSolicitudesAbiertas([]); setSolicitudRepone(''); return; }
        let cancel = false;
        api.get('/solicitudes-insumo/abiertas-cliente', { params: { clienteId: cli } })
            .then(r => { if (!cancel) setSolicitudesAbiertas(Array.isArray(r.data) ? r.data : []); })
            .catch(() => { if (!cancel) setSolicitudesAbiertas([]); });
        return () => { cancel = true; };
    }, [clienteObj, formData.clienteId]);

    const limpiarCliente = () => {
        setClienteObj(null);
        setSolicitudesAbiertas([]);
        setSolicitudRepone('');
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
            // Largo y Ancho OBLIGATORIOS en cada bobina (> 0). El peso queda opcional.
            const faltanMedidas = formData.bobinas.some(b => !(parseFloat(b.largo) > 0) || !(parseFloat(b.ancho) > 0));
            if (faltanMedidas) errs.metros = 'Cada bobina necesita Largo y Ancho mayores a 0.';
            // Descr. Tela
            if (!formData.telaCliente.trim()) errs.telaCliente = 'Requerido';
        }

        setErrors(errs);
        return Object.keys(errs).length === 0;
    };


    const handleReset = () => {
        setFormData({
            clienteId: '',
            tipo: 'TELA DE CLIENTE',
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
                // Spec 39: si repone una solicitud de insumo, el backend crea la orden de falla con esta PRE
                solicitudId: solicitudRepone ? parseInt(solicitudRepone, 10) : null,
            };
            const res = await receptionService.createReception(payload);

            if (res.success) {
                // Nombre del operario: usar el que devuelve el backend, o el local
                const operadorFinal = res.operario || operarioNombre;
                setMessage({ type: res.solicitud?.error ? 'warning' : 'success', text: `Orden ${res.ordenAsignada} guardada. Operario: ${operadorFinal}` + (res.solicitud?.message ? ` · ${res.solicitud.message}` : res.solicitud?.error ? ` · ATENCIÓN: no se pudo vincular a la solicitud (${res.solicitud.error})` : '') });
                setSolicitudRepone('');
                const nombreCliente = clienteObj?.NombreFantasia || clienteObj?.Nombre || clienteObj?.RazonSocial || payload.clienteId;
                const areaLabelResuelto = areasList.find(a => a.AreaID === payload.areaDestino)?.Nombre || payload.areaDestino || 'Recepción';
                const printData = {
                    orden:             res.ordenAsignada,
                    ...payload,
                    bobinas:           formData.bobinas,   // garantizar que llegan las bobinas con largo/ancho/peso
                    fechaHora:         new Date().toLocaleString(),
                    operario:          operadorFinal,
                    clienteNombre:     nombreCliente,
                    areaLabelResuelto, // nombre ya resuelto del área
                    idCliente:         clienteObj?.IDCliente || clienteObj?.CliIdCliente || payload.clienteId,
                };
                console.log('[DEBUG printData]', {
                    clienteObj_Nombre: clienteObj?.Nombre,
                    clienteObj_NombreFantasia: clienteObj?.NombreFantasia,
                    clienteNombre: printData.clienteNombre,
                    areaLabelResuelto: printData.areaLabelResuelto,
                    areaDestino: payload.areaDestino,
                    bobinas: printData.bobinas,
                    tipo: printData.tipo,
                });
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
        const idClienteLabel = data.idCliente || clienteId || '';

        const areaLabel      = data.areaLabelResuelto || areasList.find(a => a.AreaID === areaDestino)?.Nombre || areaDestino || '-';
        const localUser      = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
        const operadorFinal  = localUser?.nombre || localUser?.usuario || localUser?.name || operario || 'Operario';
        const clienteFinal   = clienteNombre || clienteId;

        // Bobinas detalle
        const bolinasHtml = (() => {
            if (Array.isArray(bobinas) && bobinas.length > 0 && bobinas.some(b => b.largo)) {
                const totalMts = bobinas.reduce((s,b) => s + (parseFloat(b.largo)||0), 0);
                const rows = bobinas.map((b,i) => {
                    const partes = [`L:${parseFloat(b.largo||0).toFixed(2)}m`];
                    if (b.ancho) partes.push(`A:${parseFloat(b.ancho).toFixed(2)}m`);
                    if (b.peso)  partes.push(`P:${parseFloat(b.peso).toFixed(2)}kg`);
                    return `<p><strong>BOB. ${i+1}  :</strong> ${partes.join(' \u00b7 ')}</p>`;
                }).join('');
                return `<p><strong>MTS TOTAL  :</strong> ${totalMts.toFixed(2)} m</p>${rows}`;
            }
            return `<p><strong>MTS DECL.  :</strong> ${metros ? parseFloat(metros).toFixed(2) + ' m' : '-'}</p>`;
        })();

        // Una copia del ticket (duplicamos el HTML con page-break)
        const ticketHtml = `
<div class="ticket">
  <div class="header">USER</div>
  <div class="sub">Atencion al Cliente<br>Comprobante de Recepcion de Tela</div>
  <div class="sep"></div>
  <div class="orden-num">${orden}</div>
  <div class="sep"></div>
  <p><strong>FECHA  :</strong> ${fechaHora}</p>
  <p><strong>AREA   :</strong> ${areaLabel}</p>
  <p><strong>RECIBIO:</strong> ${operadorFinal}</p>
  <p><strong>CLIENTE:</strong> ${clienteFinal}</p>
  <p><strong>ID     :</strong> ${idClienteLabel}</p>
  <div class="sep"></div>
  <p><strong>TIPO TELA  :</strong> ${telaCliente || '-'}</p>
  ${bolinasHtml}
  <p><strong>BULTOS     :</strong> ${Array.isArray(bobinas) && bobinas.length > 0 ? bobinas.length : bultos}</p>
  ${loteProv      ? `<p><strong>LOTE PROV. :</strong> ${loteProv}</p>` : ''}
  ${observaciones ? `<p><strong>OBS        :</strong> ${observaciones}</p>` : ''}
  <div class="sep"></div>
  <div class="firmas">
    <div class="firma-box">
      <div class="firma-linea"></div>
      <div class="firma-label">ENTREGA</div>
    </div>
    <div class="firma-box">
      <div class="firma-linea"></div>
      <div class="firma-label">RECIBE</div>
    </div>
  </div>
  <div class="pie"><p>Conserve este comprobante</p><p>Servicio brindado por USER ERP</p></div>
</div>`;

        const win = window.open('', '_blank', 'width=360,height=700');
        if (win) {
            win.document.write(`<html><head><title>Comprobante ${orden}</title>
            <style>
              *{margin:0;padding:0;box-sizing:border-box}
              body{font-family:'Courier New',Courier,monospace;font-size:12px;line-height:1.3;background:#fff;color:#000}
              .ticket{padding:5mm;width:80mm}
              .header{font-size:20px;font-weight:bold;text-align:center;margin-bottom:2px}
              .sub{text-align:center;font-size:10px;color:#444;margin-bottom:6px}
              .sep{border-bottom:1px dashed #000;margin:6px 0}
              .orden-num{font-size:28px;font-weight:900;text-align:center;letter-spacing:1px;margin:4px 0}
              p{margin:2px 0}
              .firmas{display:flex;gap:8mm;margin-top:8mm;margin-bottom:4mm}
              .firma-box{flex:1;text-align:center}
              .firma-linea{border-bottom:1px solid #000;height:10mm;margin-bottom:2px}
              .firma-label{font-size:9px;font-weight:bold;text-transform:uppercase;letter-spacing:1px}
              .pie{text-align:center;font-size:10px;color:#999;margin-top:8px}
              .copy-sep{border-top:2px dashed #555;margin:4mm 0;text-align:center;font-size:9px;color:#888;padding-top:2mm;letter-spacing:2px}
              @page{size:80mm auto;margin:0}
            </style></head><body>
              ${ticketHtml}
              <div class="copy-sep">- - - COPIA CLIENTE - - -</div>
              ${ticketHtml}
            </body></html>`);
            win.document.close();
            win.focus();
            win.addEventListener('afterprint', () => win.close());
            setTimeout(() => win.print(), 800);
        }
    };

    const printLabel = async (data) => {
        const { orden, tipo, clienteId, bultos, servicios, telaCliente, referencias, fechaHora } = data;
        const clienteNombreFinal = data.clienteNombre || data.clienteId || clienteId;
        const areaLabel = data.areaLabelResuelto || areasList.find(a => a.AreaID === data.areaDestino)?.Nombre || data.areaDestino || '';
        const refsText = Array.isArray(referencias) ? referencias.filter(Boolean).join(' | ') : (referencias || '');

        try {
            const pages = [];
            // Bobinas: si es TELA DE CLIENTE, usar data.bobinas que llegan con largo/ancho/peso
            const bobinasList = (tipo === 'TELA DE CLIENTE' && Array.isArray(data.bobinas) && data.bobinas.length > 0)
                ? data.bobinas
                : null;
            const totalBultos = bobinasList ? bobinasList.length : Math.max(1, parseInt(bultos) || 1);
            const esTela  = tipo === 'TELA DE CLIENTE';
            const esSub   = areaLabel.toUpperCase().includes('SUBLIM') || areaLabel.toUpperCase() === 'SB';
            const esCorte = areaLabel.toUpperCase().includes('CORTE')  || areaLabel.toUpperCase() === 'TWC';
            for (let i = 0; i < totalBultos; i++) {
                const bultoStr = `${i + 1}/${totalBultos}`;
                const bDatos  = bobinasList ? bobinasList[i] : null;
                // Código por bulto — igual que lo guarda el controller
                const dbCode = totalBultos > 1 ? `${orden}-${i + 1}` : orden;
                const qrUrl = await QRCode.toDataURL(dbCode, { width: 600, margin: 2 });
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
    * { box-sizing: border-box; margin:0; padding:0; }
    body { font-family: Arial, Helvetica, sans-serif; background:#fff; }

    /* ── Página principal de etiqueta ── */
    .page {
        width:100mm; height:150mm;
        padding:4mm 5mm;
        page-break-after: always;
        display:flex; flex-direction:column;
        overflow:hidden;
    }
    .hdr { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1.5px solid #000; padding-bottom:2mm; margin-bottom:2mm; }
    .hdr-left .lbl { font-size:7pt; font-weight:700; text-transform:uppercase; color:#555; letter-spacing:.5px; }
    .hdr-left .val { font-size:13pt; font-weight:900; line-height:1.1; }
    .hdr-left .id  { font-size:26pt; font-weight:900; color:#000; line-height:1; margin-top:1mm; }
    .hdr-left .id .idlbl { font-size:8pt; font-weight:700; color:#555; vertical-align:middle; margin-right:1mm; }
    .hdr-right { text-align:right; }
    .hdr-right .lbl  { font-size:7pt; font-weight:700; text-transform:uppercase; color:#555; letter-spacing:.5px; }
    .hdr-right .area { font-size:15pt; font-weight:900; }
    .hdr-right .fecha{ font-size:9pt; color:#555; }
    /* Info a ancho completo arriba, QR grande centrado abajo */
    .details { display:flex; flex-direction:column; gap:1.2mm; margin-bottom:2mm; }
    /* TELA en fila completa */
    .detail-row { display:flex; justify-content:space-between; font-size:11pt; border-bottom:0.5px solid #ddd; padding-bottom:0.8mm; }
    .detail-row b { color:#555; font-weight:700; white-space:nowrap; }
    .detail-row span { font-weight:900; text-align:right; }
    /* LARGO ANCHO PESO en fila única */
    .dims { display:flex; gap:1mm; margin-bottom:0.8mm; border-bottom:0.5px solid #ddd; padding-bottom:0.8mm; }
    .dim  { flex:1; text-align:center; }
    .dim .dlbl { font-size:8pt; font-weight:700; color:#555; text-transform:uppercase; }
    .dim .dval { font-size:13pt; font-weight:900; }
    /* Servicios */
    .svcs { margin-top:1mm; }
    .svcs-title { font-size:8pt; font-weight:700; text-transform:uppercase; color:#555; letter-spacing:.5px; margin-bottom:0.8mm; }
    .svc-item { display:flex; align-items:center; gap:1.5mm; font-size:10.5pt; font-weight:700; margin-bottom:0.5mm; }
    .chk { width:4.5mm; height:4.5mm; border:1.5px solid #000; display:inline-flex; align-items:center; justify-content:center; font-size:9pt; }
    /* QR grande centrado */
    .qrbox { flex:1; min-height:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
    .qrbox img { width:60mm; height:60mm; object-fit:contain; }
    .qrbox .qrlbl { font-size:10pt; font-weight:700; text-align:center; margin-top:1mm; color:#333; }
    /* Código grande abajo */
    .footer { border-top:1.5px solid #000; padding-top:1.5mm; text-align:center; }
    .footer .code  { font-size:26pt; font-weight:900; letter-spacing:1px; line-height:1; }
    .footer .bulto { font-size:9pt; font-weight:700; color:#777; text-transform:uppercase; letter-spacing:2px; }

    /* ── Página instruccion ── */
    .page-inst {
        width:100mm; height:150mm;
        page-break-after: always;
        display:flex; flex-direction:column;
        align-items:center; justify-content:center;
        padding:8mm; overflow:hidden;
    }
    .inst-code  { font-size:36pt; font-weight:900; text-align:center; letter-spacing:2px; line-height:1; margin-bottom:5mm; }
    .inst-sub   { font-size:9pt; color:#777; text-align:center; margin-bottom:4mm; font-weight:700; letter-spacing:1px; }
    .inst-arrow { font-size:40pt; color:#bbb; margin-bottom:4mm; }
    .inst-text  { font-size:18pt; font-weight:900; text-align:center; text-transform:uppercase; letter-spacing:2px; line-height:1.2; border:3px solid #000; padding:4mm 6mm; white-space:pre-line; }
    .inst-bulto { margin-top:6mm; font-size:8pt; font-weight:700; color:#777; text-transform:uppercase; letter-spacing:1px; text-align:center; }
  </style>
</head>
<body>
  ${pages.map(p => {
    const largo = p.bDatos?.largo ? parseFloat(p.bDatos.largo).toFixed(2) + ' m'  : '-';
    const ancho = p.bDatos?.ancho ? parseFloat(p.bDatos.ancho).toFixed(2) + ' m'  : '-';
    const peso  = p.bDatos?.peso  ? parseFloat(p.bDatos.peso ).toFixed(2) + ' kg' : '-';
    const idClienteLabel = data.idCliente || data.clienteId || clienteId || '';
    return `
    <!-- Etiqueta principal bobina ${p.i+1} -->
    <div class="page">
      <div class="hdr">
        <div class="hdr-left">
          <div class="lbl">CLIENTE</div>
          <div class="val">${clienteNombreFinal}</div>
          <div class="id"><span class="idlbl">ID</span>${idClienteLabel}</div>
        </div>
        <div class="hdr-right">
          <div class="lbl">SERVICIO</div>
          <div class="area">${areaLabel}</div>
          <div class="fecha">${fechaHora}</div>
        </div>
      </div>

      <div class="details">
        ${esTela ? `
        <div class="detail-row"><b>TELA</b><span>${(telaCliente || '-').substring(0,20)}</span></div>
        <div class="dims">
          <div class="dim"><div class="dlbl">LARGO</div><div class="dval">${largo}</div></div>
          <div class="dim"><div class="dlbl">ANCHO</div><div class="dval">${ancho}</div></div>
          <div class="dim"><div class="dlbl">PESO</div><div class="dval">${peso}</div></div>
        </div>
        ` : `
        <div class="detail-row"><b>SERVICIO</b><span>${(servicios||[]).join('/')}</span></div>
        `}
        <div class="svcs">
          <div class="svcs-title">PROCESO</div>
          <div class="svc-item"><div class="chk">${esSub ? '\u2713' : ''}</div> SUBLIMACI\u00d3N</div>
          <div class="svc-item"><div class="chk">${esCorte ? '\u2713' : ''}</div> CORTE</div>
        </div>
      </div>

      <div class="qrbox">
        <img src="${p.qrUrl}" />
        <div class="qrlbl">${p.dbCode}</div>
      </div>

      <div class="footer">
        <div class="code">${p.dbCode}</div>
        <div class="bulto">BULTO ${p.bultoStr}</div>
      </div>
    </div>

    <!-- Hoja instruccion bobina ${p.i+1} -->
    <div class="page-inst">
      <div class="inst-code">${p.dbCode}</div>
      <div class="inst-sub">${(telaCliente || '').toUpperCase()} &nbsp;&bull;&nbsp; ID: ${idClienteLabel}</div>
      <div class="inst-arrow">\u2193</div>
      <div class="inst-text">${esSub ? 'SUBLIMAR\nPOR ESTE LADO' : esCorte ? 'CORTAR\nPOR ESTE LADO' : 'PROCESAR\nPOR ESTE LADO'}</div>
      <div class="inst-bulto">BULTO ${p.bultoStr}</div>
    </div>
    `;
  }).join('')}
  <script>window.onload = () => { window.print(); }<\/script>
</body>
</html>`;

            const iframe = iframeRef.current;
            if (iframe) {
                iframe.srcdoc = htmlContent;
            }

        } catch (e) {
            console.error("Error generating QR or Print:", e);
            toast.error("Error al generar impresión.");
        }
    };

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
            <iframe ref={iframeRef} className="hidden" title="PrintFrame" />
            <iframe ref={iframeTicketRef} className="hidden" title="TicketFrame" />

            {/* HEADERS & TABS */}
            <div className="flex flex-wrap items-center gap-3">
                <PackagePlus size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-[220px] flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Recepción</h1>
                    <p className="text-sm text-zinc-500 mt-1">Atención al cliente · ingreso de telas y paquetes de prendas</p>
                </div>
                {activeTab === 'reception' && (
                    <div className="w-full sm:w-auto sm:ml-auto flex items-center justify-between sm:justify-start gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-2"
                        title="Código que va a tomar el próximo ingreso">
                        <span className={ROTULO}>Próximo código</span>
                        <span className="font-mono text-xl font-black text-brand-cyan tabular-nums leading-none">{nextCode}</span>
                    </div>
                )}
                {/* TABS REMOVED - ONLY RECEPTION VIEW AVAILABLE */}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] xl:grid-cols-[minmax(0,1fr)_400px] gap-4 items-start">
                {/* LEFT COLUMN: FORM */}
                {/* MAIN FORM CARD */}
                <div className={`${CARD} min-w-0`}>

                    {/* ── 1. Tipo de ingreso y cliente (estilo CAJA) ── */}
                    <div className="p-4 sm:p-5 flex flex-col gap-4">

                        {/* ── Tipo de Ingreso (siempre visible) ── */}
                        <div>
                            <span className={ETIQUETA}>Tipo de ingreso *</span>
                            <div className="grid grid-cols-2 w-full sm:w-auto sm:inline-grid rounded-xl border border-zinc-200 bg-white p-1 gap-1" role="radiogroup" aria-label="Tipo de ingreso">
                                {[['PAQUETE DE PRENDAS', 'Paquete de prendas', Package, 'Paquete'], ['TELA DE CLIENTE', 'Tela de cliente', Spool, 'Tela de cliente']].map(([valor, texto, Icono, corto]) => (
                                    <button key={valor} type="button" role="radio" aria-checked={formData.tipo === valor}
                                        // Como el select de antes: solo cambia (y limpia los servicios) si se elige el otro tipo
                                        onClick={() => { if (formData.tipo !== valor) setFormData({ ...formData, tipo: valor, servicios: [] }); }}
                                        className={`inline-flex items-center justify-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${formData.tipo === valor ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>
                                        <Icono size={15} className={`shrink-0 ${formData.tipo === valor ? 'text-white' : 'text-brand-cyan'}`} />
                                        <span className="min-[420px]:hidden">{corto}</span>
                                        <span className="hidden min-[420px]:inline">{texto}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* ── Selector de cliente estilo CAJA ── */}
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-2">
                                <span className={ROTULO}>Cliente *</span>
                                {clienteObj && (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border bg-emerald-50 text-emerald-700 border-emerald-200">
                                        <BadgeCheck size={13} /> Verificado
                                    </span>
                                )}
                            </div>

                            {/* ── Buscador (solo si no hay cliente seleccionado) ── */}
                            {!clienteObj ? (
                                <div className="flex flex-col gap-2">
                                    <div className="relative">
                                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                                        <input
                                            value={qCliente}
                                            onChange={e => setQCliente(e.target.value)}
                                            placeholder="Buscar por nombre, IDCliente, teléfono..."
                                            aria-label="Buscar cliente"
                                            className={campo(errors.clienteId, 'pl-9 pr-10 py-2.5 font-semibold')}
                                        />
                                        {buscandoCli && (
                                            <Loader2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-cyan animate-spin" />
                                        )}
                                    </div>
                                    {errors.clienteId && <p className="text-xs font-bold text-brand-magenta">{errors.clienteId}</p>}

                                    {/* Resultados de búsqueda */}
                                    {clienteResultados.length > 0 && (
                                        <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                                            {clienteResultados.map((c, i) => {
                                                const nombre = c.Nombre?.trim() || c.NombreFantasia?.trim() || c.IDCliente;
                                                const fantasia = c.NombreFantasia?.trim();
                                                return (
                                                    <button
                                                        key={c.CliIdCliente || c.IDCliente || i}
                                                        type="button"
                                                        onClick={() => seleccionarClienteCompleto(c)}
                                                        className="w-full text-left px-3 py-2.5 bg-white border border-zinc-200 rounded-xl hover:border-brand-cyan/40 hover:bg-brand-cyan/5 transition-colors flex flex-col gap-1 group"
                                                    >
                                                        <div className="flex items-start justify-between gap-2">
                                                            <span className="min-w-0 break-words text-sm font-bold text-zinc-800 group-hover:text-brand-cyan transition-colors leading-tight">{nombre}</span>
                                                            {(c.IDCliente || c.CliIdCliente) && (
                                                                <span className="shrink-0 text-[11px] font-mono font-bold text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">{c.IDCliente || c.CliIdCliente}</span>
                                                            )}
                                                        </div>
                                                        {fantasia && nombre !== fantasia && (
                                                            <span className="text-xs text-zinc-500 italic">"{fantasia}"</span>
                                                        )}
                                                        {(c.Email || c.Telefono) && (
                                                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-400">
                                                                {c.Email && <span className="inline-flex items-center gap-1 min-w-0 break-all"><Mail size={11} className="shrink-0" /> {c.Email}</span>}
                                                                {c.Telefono && <span className="inline-flex items-center gap-1"><Phone size={11} className="shrink-0" /> {c.Telefono}</span>}
                                                            </div>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                    {qCliente.trim().length >= 2 && !buscandoCli && clienteResultados.length === 0 && (
                                        <p className="text-center py-3 text-zinc-500 text-xs font-semibold">No se encontraron clientes</p>
                                    )}
                                    {!qCliente.trim() && (
                                        <p className="text-center py-3 text-zinc-400 text-xs">Use el buscador para encontrar un cliente...</p>
                                    )}
                                </div>
                            ) : (
                                /* ── Tarjeta cliente seleccionado ── */
                                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 flex flex-col gap-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-3 min-w-0">
                                            <UserRound size={22} className="text-brand-cyan shrink-0 mt-0.5" />
                                            <div className="min-w-0">
                                                <p className="text-sm font-black text-zinc-900 leading-tight tracking-tight break-words">
                                                    {clienteObj.Nombre?.trim() || clienteObj.NombreFantasia?.trim()}
                                                </p>
                                                <p className="text-[11px] text-zinc-400 font-bold uppercase tracking-wider mt-0.5 font-mono break-all">
                                                    IDCLIENTE: {clienteObj.IDCliente || clienteObj.CliIdCliente || '—'}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={limpiarCliente}
                                            className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-500 hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5 transition-colors"
                                            title="Cambiar cliente"
                                        >
                                            <X size={14} /> Cambiar
                                        </button>
                                    </div>

                                    {/* Datos del cliente */}
                                    {(clienteObj.Email || clienteObj.Telefono || clienteObj.TelefonoTrabajo || clienteObj.Direccion || clienteObj.DireccionTrabajo) && (
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-2 border-t border-zinc-200 pt-3">
                                            {clienteObj.Email && (
                                                <div className="min-w-0">
                                                    <span className={`block ${ROTULO}`}>Email</span>
                                                    <span className="text-xs font-mono text-zinc-700 break-all">{clienteObj.Email}</span>
                                                </div>
                                            )}
                                            {(clienteObj.Telefono || clienteObj.TelefonoTrabajo) && (
                                                <div className="min-w-0">
                                                    <span className={`block ${ROTULO}`}>Teléfono</span>
                                                    <span className="text-xs font-mono text-zinc-700 break-all">{clienteObj.Telefono || clienteObj.TelefonoTrabajo}</span>
                                                </div>
                                            )}
                                            {(clienteObj.Direccion || clienteObj.DireccionTrabajo) && (
                                                <div className="min-w-0">
                                                    <span className={`block ${ROTULO}`}>Dirección</span>
                                                    <span className="text-xs text-zinc-700 break-words">{clienteObj.Direccion || clienteObj.DireccionTrabajo}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ── Spec 39: ¿esta PRE repone una solicitud de insumo abierta? ── */}
                                    {solicitudesAbiertas.length > 0 && (
                                        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                                            <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-amber-700 mb-1.5">
                                                <AlertTriangle size={12} /> ¿Repone una solicitud de insumo abierta?
                                            </span>
                                            <Selector
                                                className="w-full font-semibold"
                                                value={String(solicitudRepone)}
                                                onChange={e => setSolicitudRepone(e.target.value)}
                                                aria-label="Solicitud de insumo que repone"
                                                anchoLista={360}
                                            >
                                                <option value="">No, es un ingreso común</option>
                                                {solicitudesAbiertas.map(s => (
                                                    <option key={s.SolicitudID} value={String(s.SolicitudID)}>
                                                        Sí: solicitud #{s.SolicitudID} · {s.CodigoMadre} · {s.Tipo === 'PRENDA_CLIENTE' ? 'prendas' : 'tela'} dañada ({s.Cantidad != null ? `${Number(s.Cantidad)} ${String(s.Unidad || '').trim()}` : s.Motivo})
                                                    </option>
                                                ))}
                                            </Selector>
                                            {solicitudRepone && <p className="text-[11px] text-amber-700 mt-1.5">Al guardar, la orden de falla nace con esta PRE y la solicitud #{solicitudRepone} pasa a Resuelta.</p>}
                                        </div>
                                    )}

                                    {/* ── Badges informativos de tela (solo display, compactos) ── */}
                                    {formData.tipo === 'TELA DE CLIENTE' && saldosTela.length > 0 && (
                                        <div className="border-t border-zinc-200 pt-3">
                                            <span className={ETIQUETA}>Stock de tela actual</span>
                                            <div className="flex flex-wrap gap-1.5">
                                                {saldosTela.map((s, i) => {
                                                    const libre = parseFloat(s.MetrosLibres || s.MetrosDisponibles || 0);
                                                    const pct   = parseFloat(s.PorcentajeConsumido || 0);
                                                    const dotColor = pct >= 80 ? 'bg-brand-magenta' : pct >= 50 ? 'bg-amber-400' : 'bg-brand-cyan';
                                                    return (
                                                        // La clave lleva la tela y la posición: un cliente puede tener varias telas con el mismo InsumoID
                                                        <span key={`${s.InsumoID}-${s.TipoTela}-${i}`}
                                                            className="inline-flex items-center gap-1.5 max-w-full px-2.5 py-1 rounded-full border border-zinc-200 bg-white text-[11px] font-bold text-zinc-700">
                                                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
                                                            <span className="uppercase tracking-tight truncate">{s.TipoTela}</span>
                                                            <span className="font-mono text-zinc-900 shrink-0">{Number(libre).toFixed(2)}m</span>
                                                            {s.CantidadBultos > 0 && (
                                                                <span className="text-zinc-300 font-normal">·</span>
                                                            )}
                                                            {s.CantidadBultos > 0 && (
                                                                <span className="font-mono text-zinc-500 shrink-0">{s.CantidadBultos} bob</span>
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
                    </div>

                    {/* 2. Dynamic Content (Services or Tela) */}
                    <div className="p-4 sm:p-5 border-t border-zinc-100">
                        {formData.tipo === 'PAQUETE DE PRENDAS' || formData.tipo === 'TELA DE CLIENTE' ? (
                            <div className="flex flex-col gap-4">
                                {/* DESCRIPCIÓN DE TELA SI ES TELA */}
                                {/* FORMULARIO TELA DE CLIENTE */}
                                {formData.tipo === 'TELA DE CLIENTE' && (
                                    <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-top-2 duration-300">

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            {/* ── 1. Área Destino ── */}
                                            <div className="min-w-0">
                                                <span className={ETIQUETA}>Área destino *</span>
                                                <div className={`rounded-xl ${errors.areaDestino ? 'ring-2 ring-brand-magenta/30' : ''}`}>
                                                    <Selector
                                                        className="w-full font-semibold"
                                                        value={String(formData.areaDestino)}
                                                        onChange={(e) => setFormData({ ...formData, areaDestino: e.target.value })}
                                                        aria-label="Área destino"
                                                    >
                                                        <option value="">Seleccionar...</option>
                                                        {areasList.filter(a => {
                                                            const id   = a.AreaID;
                                                            const name = a.Nombre.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
                                                            return ['SB','TWC'].includes(id) || name.includes('SUBLIMA') || name.includes('CORTE');
                                                        }).map(a => (
                                                            <option key={a.AreaID} value={String(a.AreaID)}>{a.Nombre}</option>
                                                        ))}
                                                    </Selector>
                                                </div>
                                                {errors.areaDestino && <p className={ERROR}>{errors.areaDestino}</p>}
                                            </div>

                                            {/* ── Insumo fijo TELA CLIENTE ── */}
                                            <div className="min-w-0">
                                                <span className={ETIQUETA}>Insumo / material</span>
                                                {insumosList.find(i => i.Nombre.toUpperCase().includes('TELA CLIENTE')) ? (
                                                    <div className="w-full px-3 py-2.5 border border-zinc-200 bg-zinc-50 rounded-xl text-sm font-semibold text-zinc-600 select-none flex items-center justify-between gap-2"
                                                        title="Insumo fijo para la tela de cliente">
                                                        <span className="truncate">{insumosList.find(i => i.Nombre.toUpperCase().includes('TELA CLIENTE')).Nombre}</span>
                                                        <Lock size={14} className="text-zinc-400 shrink-0" />
                                                    </div>
                                                ) : (
                                                    <div className={`rounded-xl ${errors.insumoId ? 'ring-2 ring-brand-magenta/30' : ''}`}>
                                                        <Selector
                                                            className="w-full font-semibold"
                                                            value={String(formData.insumoId)}
                                                            onChange={(e) => setFormData({ ...formData, insumoId: e.target.value })}
                                                            aria-label="Insumo o material"
                                                            anchoLista={320}
                                                        >
                                                            <option value="">Seleccionar...</option>
                                                            {insumosList.map(ins => (
                                                                <option key={ins.InsumoID} value={String(ins.InsumoID)}>{ins.Nombre}</option>
                                                            ))}
                                                        </Selector>
                                                    </div>
                                                )}
                                                {errors.insumoId && <p className={ERROR}>{errors.insumoId}</p>}
                                            </div>
                                        </div>

                                        {/* Pregunta sumar-a-existente eliminada — cada ingreso es una bobina nueva independiente */}


                                        {/* ── 3. Selector de tela existente (solo si sumarAExistente=true) ── */}
                                        {sumarAExistente === true && saldosTela.length > 0 && (
                                            <div>
                                                <span className={ETIQUETA}>Seleccionar tela a sumar *</span>
                                                <div className="flex flex-col gap-1.5">
                                                    {saldosTela.map(s => {
                                                        const libre = parseFloat(s.MetrosLibres || s.MetrosDisponibles || 0);
                                                        const pct   = parseFloat(s.PorcentajeConsumido || 0);
                                                        const isSel = telaSeleccionada?.InsumoID === s.InsumoID && telaSeleccionada?.TipoTela === s.TipoTela;
                                                        const barColor = pct >= 80 ? 'bg-brand-magenta' : pct >= 50 ? 'bg-amber-400' : 'bg-brand-cyan';
                                                        return (
                                                            <button key={`${s.InsumoID}-${s.TipoTela}`} type="button"
                                                                onClick={() => {
                                                                    setTelaSeleccionada(isSel ? null : s);
                                                                    setFormData(p => ({ ...p, telaCliente: isSel ? '' : s.TipoTela }));
                                                                }}
                                                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors ${
                                                                    isSel
                                                                        ? 'bg-brand-cyan/5 border-brand-cyan ring-2 ring-brand-cyan/15'
                                                                        : 'bg-white border-zinc-200 hover:border-brand-cyan/40'
                                                                }`}
                                                            >
                                                                <Zap size={13} className="shrink-0 text-brand-cyan" />
                                                                <span className={`text-[11px] font-black uppercase tracking-tight truncate flex-1 text-left ${isSel ? 'text-brand-cyan' : 'text-zinc-700'}`}>
                                                                    {s.TipoTela}
                                                                </span>
                                                                <span className="font-black font-mono text-sm shrink-0 text-zinc-900">
                                                                    {Number(libre).toLocaleString('es-UY', { minimumFractionDigits: 2 })}
                                                                    <span className="text-[9px] ml-1 uppercase text-zinc-400">mts</span>
                                                                </span>
                                                                <div className="w-12 shrink-0">
                                                                    <div className="w-full h-1 bg-zinc-200 rounded-full overflow-hidden">
                                                                        <div className={`h-full ${barColor}`} style={{ width: `${Math.min(pct,100)}%` }} />
                                                                    </div>
                                                                </div>
                                                                {isSel && <Check size={15} className="shrink-0 text-brand-cyan" />}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* ── 4. Tabla de Bobinas (Largo × Ancho × Peso) ── */}
                                        {(
                                            <div className="flex flex-col gap-2">
                                                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                                    <span className={ROTULO}>Medidas por bobina *</span>
                                                    <span className="text-xs text-zinc-500">
                                                        Total: <strong className="font-black text-zinc-800 tabular-nums">{formData.bobinas.reduce((s,b) => s + (parseFloat(b.largo)||0), 0).toFixed(2)} m</strong>
                                                        {' · '}{formData.bobinas.length} bobina{formData.bobinas.length !== 1 ? 's' : ''}
                                                    </span>
                                                </div>

                                                {/* Cabecera tabla (en el celular cada bobina lleva sus rótulos) */}
                                                <div className={`hidden sm:grid gap-2 ${GRILLA_BOBINA}`}>
                                                    <div />
                                                    <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400 text-center">Largo (m)</div>
                                                    <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400 text-center">Ancho (m)</div>
                                                    <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400 text-center">Peso (kg)</div>
                                                    <div className="text-[10px] font-black uppercase tracking-wide text-zinc-400 text-center" title="Qué hacer con lo que sobre de esta bobina cuando se termine de consumir">Excedente</div>
                                                    <div />
                                                </div>

                                                {/* Filas de bobinas */}
                                                {formData.bobinas.map((bob, idx) => (
                                                    <div key={idx} className={`relative grid grid-cols-2 gap-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 sm:p-0 sm:border-0 sm:bg-transparent sm:items-center ${GRILLA_BOBINA}`}>
                                                        <div className="col-span-2 sm:col-span-1 h-8 sm:h-auto pr-10 sm:pr-0 flex items-center sm:justify-center text-xs font-black text-zinc-600 sm:text-zinc-400 tabular-nums">
                                                            <span className="sm:hidden mr-1">Bobina</span>{idx+1}
                                                        </div>
                                                        <label className="min-w-0">
                                                            <span className="sm:hidden block text-[10px] font-black uppercase tracking-wide text-zinc-400 mb-1">Largo (m)</span>
                                                            <input
                                                                type="number" step="0.01" placeholder="0.00"
                                                                className={campo(errors.metros, 'px-2 py-2.5 text-center font-bold tabular-nums')}
                                                                value={bob.largo}
                                                                onChange={e => {
                                                                    const nb = [...formData.bobinas];
                                                                    nb[idx] = { ...nb[idx], largo: e.target.value };
                                                                    setFormData({ ...formData, bobinas: nb });
                                                                }}
                                                            />
                                                        </label>
                                                        <label className="min-w-0">
                                                            <span className="sm:hidden block text-[10px] font-black uppercase tracking-wide text-zinc-400 mb-1">Ancho (m)</span>
                                                            <input
                                                                type="number" step="0.01" placeholder="0.00"
                                                                className={campo(errors.metros, 'px-2 py-2.5 text-center font-bold tabular-nums')}
                                                                value={bob.ancho}
                                                                onChange={e => {
                                                                    const nb = [...formData.bobinas];
                                                                    nb[idx] = { ...nb[idx], ancho: e.target.value };
                                                                    setFormData({ ...formData, bobinas: nb });
                                                                }}
                                                            />
                                                        </label>
                                                        <label className="min-w-0">
                                                            <span className="sm:hidden block text-[10px] font-black uppercase tracking-wide text-zinc-400 mb-1">Peso (kg)</span>
                                                            <input
                                                                type="number" step="0.01" placeholder="0.00"
                                                                className={campo(false, 'px-2 py-2.5 text-center font-bold tabular-nums')}
                                                                value={bob.peso}
                                                                onChange={e => {
                                                                    const nb = [...formData.bobinas];
                                                                    nb[idx] = { ...nb[idx], peso: e.target.value };
                                                                    setFormData({ ...formData, bobinas: nb });
                                                                }}
                                                            />
                                                        </label>
                                                        <div className="min-w-0">
                                                            <span className="sm:hidden block text-[10px] font-black uppercase tracking-wide text-zinc-400 mb-1">Excedente</span>
                                                            <Selector
                                                                className="w-full font-semibold"
                                                                value={bob.decisionExcedente || ''}
                                                                title="Qué hacer con lo que sobre de esta bobina cuando se termine de consumir"
                                                                aria-label={`Excedente de la bobina ${idx + 1}`}
                                                                anchoLista={230}
                                                                onChange={e => {
                                                                    const nb = [...formData.bobinas];
                                                                    nb[idx] = { ...nb[idx], decisionExcedente: e.target.value };
                                                                    setFormData({ ...formData, bobinas: nb });
                                                                }}
                                                            >
                                                                <option value="">Sin decidir</option>
                                                                <option value="DEVOLVER">Devolver al cliente</option>
                                                                <option value="QUEDA">Queda para otras órdenes</option>
                                                            </Selector>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                if (formData.bobinas.length === 1) return;
                                                                setFormData({ ...formData, bobinas: formData.bobinas.filter((_,i) => i !== idx) });
                                                            }}
                                                            className="absolute top-2 right-2 sm:static w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/10 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                                                            disabled={formData.bobinas.length === 1}
                                                            title="Eliminar bobina"
                                                            aria-label={`Eliminar la bobina ${idx + 1}`}
                                                        ><Trash2 size={15} /></button>
                                                    </div>
                                                ))}

                                                {/* Botón agregar */}
                                                <button
                                                    type="button"
                                                    onClick={() => setFormData({ ...formData, bobinas: [...formData.bobinas, { largo: '', ancho: '', peso: '' }] })}
                                                    className="w-full inline-flex items-center justify-center gap-1.5 py-2.5 border border-dashed border-zinc-300 rounded-xl text-sm font-bold text-zinc-500 hover:border-brand-cyan hover:text-brand-cyan hover:bg-brand-cyan/5 transition-colors"
                                                >
                                                    <Plus size={15} /> Agregar bobina
                                                </button>

                                                {errors.metros && <p className="text-xs font-bold text-brand-magenta">{errors.metros}</p>}
                                            </div>
                                        )}

                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            {/* Lote Proveedor (general) */}
                                            <div className="min-w-0">
                                                <label htmlFor="recepcion-lote" className={ETIQUETA}>Lote proveedor</label>
                                                <input
                                                    id="recepcion-lote"
                                                    type="text"
                                                    className={campo(false, 'px-3 py-2.5 font-semibold')}
                                                    placeholder="Opcional..."
                                                    value={formData.loteProv}
                                                    onChange={(e) => setFormData({ ...formData, loteProv: e.target.value })}
                                                />
                                            </div>

                                            {/* ── 5. Tipo de Tela / Descripción ── */}
                                            {(
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                                        <label htmlFor="recepcion-tela" className={ROTULO}>Tipo de tela / descripción *</label>
                                                        {telaSeleccionada && (
                                                            <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20">
                                                                <Lock size={11} /> Sumando a tela existente
                                                            </span>
                                                        )}
                                                    </div>
                                                    <input
                                                        id="recepcion-tela"
                                                        type="text"
                                                        readOnly={!!telaSeleccionada}
                                                        className={
                                                            errors.telaCliente
                                                                ? campo(true, 'px-3 py-2.5 font-semibold')
                                                                : telaSeleccionada
                                                                    ? 'w-full px-3 py-2.5 border rounded-xl text-sm font-semibold outline-none bg-brand-cyan/5 border-brand-cyan/30 text-brand-cyan cursor-not-allowed'
                                                                    : campo(false, 'px-3 py-2.5 font-semibold')
                                                        }
                                                        placeholder="Ej: Algodón Jersey Negro..."
                                                        value={formData.telaCliente}
                                                        onChange={(e) => !telaSeleccionada && setFormData({ ...formData, telaCliente: e.target.value })}
                                                    />
                                                    {telaSeleccionada && (
                                                        <p className="text-[11px] text-brand-cyan font-bold mt-1.5">Descripción bloqueada — corresponde a la tela seleccionada</p>
                                                    )}
                                                    {errors.telaCliente && <p className={ERROR}>{errors.telaCliente}</p>}
                                                </div>
                                            )}
                                        </div>

                                    </div>
                                )}

                                {/* SERVICIOS (Solo para PAQUETE DE PRENDAS) */}
                                {formData.tipo === 'PAQUETE DE PRENDAS' && (
                                    <div>
                                        <span className={ETIQUETA}>Servicios solicitados *</span>
                                        <div className="flex flex-wrap gap-2">
                                            {servicesList.filter(srv => {
                                                const s = srv.toLowerCase();
                                                // Solo Bordado o Estampado para Paquetes
                                                return s.includes('bordado') || s.includes('estampado') || s.includes('costura');
                                            }).map(srv => (
                                                <button
                                                    key={srv}
                                                    type="button"
                                                    onClick={() => handleServiceToggle(srv)}
                                                    aria-pressed={formData.servicios.includes(srv)}
                                                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border text-sm font-bold transition-colors ${formData.servicios.includes(srv)
                                                        ? 'bg-zinc-900 border-zinc-900 text-white'
                                                        : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:text-zinc-800'
                                                        }`}
                                                >
                                                    {formData.servicios.includes(srv) && <Check size={14} />}
                                                    {srv}
                                                </button>
                                            ))}
                                            {servicesList.length === 0 && <span className="text-xs text-zinc-400 italic">Cargando servicios...</span>}
                                        </div>
                                        {errors.servicios && <p className={ERROR}>{errors.servicios}</p>}
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </div>

                    {/* 3. Bultos, Referencias & Observaciones */}
                    <div className="p-4 sm:p-5 border-t border-zinc-100 grid grid-cols-1 md:grid-cols-3 gap-4">
                        {/* Bultos y Cantidad */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="min-w-0">
                                <label htmlFor="recepcion-bultos" className={ETIQUETA}>
                                    Bultos
                                </label>
                                {formData.tipo === 'TELA DE CLIENTE' ? (
                                    // Para tela de cliente: se actualiza automáticamente con la cantidad de bobinas
                                    <div className="w-full px-3 py-2.5 border border-zinc-200 bg-zinc-50 rounded-xl text-sm font-black text-zinc-800 text-center select-none tabular-nums"
                                        title="Se cuenta solo: uno por bobina">
                                        {formData.bobinas?.length ?? 1}
                                        <span className="text-[11px] font-semibold text-zinc-400 ml-1">bobina{(formData.bobinas?.length ?? 1) !== 1 ? 's' : ''}</span>
                                    </div>
                                ) : (
                                    <input
                                        id="recepcion-bultos"
                                        type="number"
                                        min="1"
                                        className={campo(false, 'px-3 py-2.5 font-bold tabular-nums')}
                                        value={formData.bultos}
                                        onChange={(e) => setFormData({ ...formData, bultos: Math.max(1, parseInt(e.target.value) || 1) })}
                                    />
                                )}
                            </div>

                            {/* NUEVO: Total Prendas (Solo para Paquetes) */}
                            {formData.tipo === 'PAQUETE DE PRENDAS' && (
                                <div className="min-w-0 animate-in fade-in zoom-in duration-300">
                                    <label htmlFor="recepcion-prendas" className={ETIQUETA}>Total prendas</label>
                                    <input
                                        id="recepcion-prendas"
                                        type="number"
                                        min="1"
                                        className={campo(false, 'px-3 py-2.5 font-bold tabular-nums')}
                                        placeholder="Total..."
                                        value={formData.cantidadPrendas || ''}
                                        onChange={(e) => setFormData({ ...formData, cantidadPrendas: e.target.value })}
                                    />
                                </div>
                            )}
                        </div>

                        {/* Referencias: solo visible para PAQUETE DE PRENDAS */}
                        {formData.tipo !== 'TELA DE CLIENTE' && (
                        <div className="md:col-span-2 min-w-0">
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                                <span className={ROTULO}>Referencias (OC / pedido pendiente)</span>
                                <button type="button" onClick={addRef} className="inline-flex items-center gap-1 text-xs font-bold text-brand-cyan hover:text-brand-cyan/80 transition-colors">
                                    <Plus size={13} /> Agregar
                                </button>
                            </div>
                            <div className="flex flex-col gap-2">
                                {formData.referencias.map((ref, idx) => (
                                    <div key={idx} className="flex gap-2 relative">
                                        {possibleOrders.length > 0 ? (
                                            <div className="flex-1 min-w-0">
                                                <Selector
                                                    className="w-full font-semibold"
                                                    value={String(ref)}
                                                    onChange={(e) => handleRefChange(idx, e.target.value)}
                                                    aria-label={`Referencia ${idx + 1}`}
                                                    anchoLista={320}
                                                >
                                                    <option value="">-- Seleccionar Orden Pendiente --</option>
                                                    {possibleOrders.map(o => (
                                                        <option key={o.OrdenID} value={String(o.CodigoOrden)}>
                                                            {o.CodigoOrden} ({o.DescripcionTrabajo ? o.DescripcionTrabajo.substring(0, 30) : ''})
                                                        </option>
                                                    ))}
                                                    <option value="OTRA">Otra / Manual...</option>
                                                </Selector>
                                            </div>
                                        ) : (
                                            <>
                                                <input
                                                    type="text"
                                                    className={campo(false, 'flex-1 min-w-0 px-3 py-2.5')}
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
                                            <button type="button" onClick={() => removeRef(idx)} title="Quitar referencia" aria-label={`Quitar la referencia ${idx + 1}`}
                                                className="shrink-0 w-[42px] inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-400 hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5 transition-colors">
                                                <Trash2 size={15} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                        )}


                        {/* Observaciones */}
                        <div className="md:col-span-3">
                            <label htmlFor="recepcion-observaciones" className={ETIQUETA}>Observaciones</label>
                            <textarea
                                id="recepcion-observaciones"
                                rows="2"
                                className={campo(false, 'px-3 py-2.5 resize-y')}
                                placeholder="Notas adicionales..."
                                value={formData.observaciones || ''}
                                onChange={(e) => setFormData({ ...formData, observaciones: e.target.value })}
                            />
                        </div>
                    </div>


                    {/* ACTIONS */}
                    <div className="px-4 sm:px-5 py-4 border-t border-zinc-100 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
                        <button type="button" onClick={handleReset} className={BTN_SECUNDARIO}>
                            <RotateCcw size={15} className="text-brand-cyan" /> Cancelar / Reset
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveAndPrint}
                            disabled={loading}
                            className={BTN_PRINCIPAL}
                        >
                            {loading ? (
                                <><Loader2 size={15} className="animate-spin" /> Procesando...</>
                            ) : (
                                <><Printer size={15} /> Guardar e Imprimir</>
                            )}
                        </button>
                    </div>
                    {message && (
                        <div className="px-4 sm:px-5 pb-4">
                            <div className={`flex items-start gap-2 p-3 rounded-xl border text-sm font-bold ${message.type === 'error'
                                ? 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20'
                                : message.type === 'warning'
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                                {message.type === 'error' ? <XCircle size={16} className="shrink-0 mt-0.5" /> : message.type === 'warning' ? <AlertTriangle size={16} className="shrink-0 mt-0.5" /> : <CheckCircle2 size={16} className="shrink-0 mt-0.5" />}
                                <span className="min-w-0 break-words">{message.text}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* RIGHT COLUMN: HISTORY */}
                <div className={`${CARD} p-4 flex flex-col gap-3 min-w-0`}>
                    <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                            <History size={18} className="text-brand-cyan shrink-0" />
                            <h2 className="text-sm font-black uppercase tracking-wide text-zinc-800">Historial reciente</h2>
                        </div>
                        <button type="button" onClick={loadHistory} title="Actualizar" aria-label="Actualizar el historial"
                            className="shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white text-brand-cyan hover:bg-zinc-50 transition-colors">
                            <RefreshCw size={15} className={historyLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>

                    {/* Mini Filters */}
                    <div className="grid grid-cols-2 gap-2">
                        <div className="relative min-w-0">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            <input
                                placeholder="Cliente..."
                                aria-label="Filtrar por cliente"
                                className={campo(false, 'pl-8 pr-2 py-2')}
                                value={historyFilters.cliente}
                                onChange={e => setHistoryFilters({ ...historyFilters, cliente: e.target.value })}
                            />
                        </div>
                        <div className="relative min-w-0">
                            <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            <input
                                placeholder="Orden..."
                                aria-label="Filtrar por orden"
                                className={campo(false, 'pl-8 pr-2 py-2')}
                                value={historyFilters.orden}
                                onChange={e => setHistoryFilters({ ...historyFilters, orden: e.target.value })}
                            />
                        </div>
                        <button type="button" onClick={loadHistory} className={`${BTN_SECUNDARIO} col-span-2`}>
                            <Search size={15} className="text-brand-cyan" /> Buscar
                        </button>
                    </div>

                    <div className="flex flex-col gap-2 lg:max-h-[640px] lg:overflow-y-auto lg:pr-1">
                        {historyLoading ? (
                            <div className="flex items-center justify-center gap-2 py-8 text-sm text-zinc-400">
                                <Loader2 size={18} className="animate-spin text-brand-cyan" /> Cargando...
                            </div>
                        ) : history.length === 0 ? (
                            <div className="flex flex-col items-center text-center py-8">
                                <Inbox size={40} className="text-brand-cyan mb-2" />
                                <span className="text-sm font-bold text-zinc-700">Sin registros.</span>
                                <span className="text-xs text-zinc-400 mt-1">Probá con otro cliente u orden.</span>
                            </div>
                        ) : (
                            history.map(item => (
                                <div key={item.RecepcionID} className="rounded-xl border border-zinc-200 bg-white p-3 hover:border-zinc-300 transition-colors">
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="font-mono text-sm font-black text-zinc-900">{item.Codigo}</span>
                                        <span className="shrink-0 text-[11px] text-zinc-400 tabular-nums">
                                            {new Date(item.FechaRecepcion).toLocaleDateString('es-UY')} {new Date(item.FechaRecepcion).toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}
                                        </span>
                                    </div>
                                    <h4 className="font-bold text-zinc-800 text-sm mt-0.5 break-words">{item.ClienteNombre || item.Cliente}</h4>
                                    <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2 break-words">{item.Detalle}</p>
                                    {/* Reimpresiones: siempre a la vista (antes aparecían al pasar el mouse y en el celular no se veían) */}
                                    <div className="flex flex-wrap justify-end gap-1.5 mt-2.5 pt-2.5 border-t border-zinc-100">
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    const isTela = item.Tipo === 'TELA CLIENTE' || item.Tipo === 'TELA DE CLIENTE';
                                                    const bobinas = isTela
                                                        ? await api.get(`/reception/bobinas-by-orden/${encodeURIComponent(item.Codigo)}`).then(r => r.data?.bobinas || []).catch(() => [])
                                                        : [];
                                                    await printLabel({
                                                        orden:             item.Codigo,
                                                        clienteId:         item.Cliente,
                                                        clienteNombre:     item.ClienteNombre || item.Cliente,
                                                        idCliente:         item.IDCliente || item.Cliente,
                                                        areaLabelResuelto: item.ProximoServicio || '',
                                                        tipo:              isTela ? 'TELA DE CLIENTE' : item.Tipo,
                                                        bultos:            item.CantidadBultos,
                                                        servicios:         isTela ? [] : (item.Detalle || '').split('/'),
                                                        telaCliente:       isTela ? (item.Detalle || '').replace('TELA: ', '') : '',
                                                        referencias:       item.Referencias ? [item.Referencias] : [],
                                                        fechaHora:         new Date(item.FechaRecepcion).toLocaleString(),
                                                        bobinas,
                                                    });
                                                } catch(e) {
                                                    console.error('Error reimprimir etiqueta:', e);
                                                    toast.error('Error al reimprimir etiqueta: ' + e.message);
                                                }
                                            }}
                                            className={BTN_CHICO}
                                            title="Reimprimir Etiqueta"
                                        >
                                            <Tag size={13} className="text-brand-cyan" /> Etiqueta
                                        </button>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                try {
                                                    const isTela = item.Tipo === 'TELA CLIENTE' || item.Tipo === 'TELA DE CLIENTE';
                                                    const localUser = (() => { try { return JSON.parse(localStorage.getItem('user') || '{}'); } catch { return {}; } })();
                                                    const bobinas = isTela
                                                        ? await api.get(`/reception/bobinas-by-orden/${encodeURIComponent(item.Codigo)}`).then(r => r.data?.bobinas || []).catch(() => [])
                                                        : [];
                                                    await printClientTicket({
                                                        orden:             item.Codigo,
                                                        clienteId:         item.Cliente,
                                                        clienteNombre:     item.ClienteNombre || item.Cliente,
                                                        idCliente:         item.IDCliente || item.Cliente,
                                                        areaLabelResuelto: item.ProximoServicio || '',
                                                        areaDestino:       item.ProximoServicio || '',
                                                        telaCliente:       isTela ? (item.Detalle || '').replace('TELA: ', '') : '',
                                                        bobinas,
                                                        metros:            item.TotalMetros || 0,
                                                        bultos:            item.CantidadBultos,
                                                        observaciones:     item.Observaciones || '',
                                                        fechaHora:         new Date(item.FechaRecepcion).toLocaleString(),
                                                        operario:          localUser?.nombre || localUser?.usuario || '',
                                                    });
                                                } catch(e) {
                                                    console.error('Error reimprimir comprobante:', e);
                                                    toast.error('Error al reimprimir comprobante: ' + e.message);
                                                }
                                            }}
                                            className={BTN_CHICO}
                                            title="Reimprimir Comprobante"
                                        >
                                            <Receipt size={13} className="text-brand-cyan" /> Comprobante
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReceptionPage;
