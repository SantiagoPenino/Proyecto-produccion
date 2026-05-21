import React, { useState, useEffect, useRef } from 'react';
import TransportView from '../../logistics/TransportView';
import { useAuth } from '../../../context/AuthContext';
import api from '../../../services/api';
import { logisticsService } from '../../../services/modules/logisticsService';
import { socket } from '../../../services/socketService';
import { Package, Truck, Search, QrCode, FileText, CheckCircle, RefreshCcw, DollarSign, ChevronDown, ChevronRight, Printer, ClipboardList, Tag, History, ChevronUp, FileImage } from 'lucide-react';
import { toast } from 'sonner';
import Swal from 'sweetalert2';
import AlertaAutorizacionModal from '../../modals/AlertaAutorizacionModal';

// â”€â”€â”€ TICKET: Comprobante de Retiro (igual a WebRetirosPage) â”€â”€â”€
const printTicketEncomienda = (enc) => {
    const now = new Date().toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const pagado = enc.pagorealizado === 1;
    const orderObjs = enc.orders || [];
    const tipoDesc = enc.TClDescripcion || 'Común';
    const local = enc.lugarRetiro && enc.lugarRetiro !== 'Desconocido' ? enc.lugarRetiro : 'Retiro';
    const monto = enc.totalCost && enc.totalCost !== '0.00' ? enc.totalCost : null;
    const monedaSimbolo = enc.orders?.[0]?.monedaId === 2 ? 'US$' : '$';
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
  <title>Comprobante ${enc.ordenDeRetiro}</title>
  <style>
    @page{size:A5;margin:12mm 10mm;}*{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:13px;color:#111;background:#fff;}
    .header{text-align:center;border-bottom:2px solid #222;padding-bottom:8px;margin-bottom:12px;}
    .header .empresa{font-size:20px;font-weight:900;letter-spacing:2px;text-transform:uppercase;}
    .header .modulo{font-size:12px;color:#555;margin-top:2px;}
    .codigo-principal{text-align:center;font-size:28px;font-weight:900;letter-spacing:2px;margin:10px 0 8px;padding:6px 0;border-top:1px dashed #ccc;border-bottom:1px dashed #ccc;}
    .estado-badge{display:inline-block;padding:4px 12px;border:2px solid ${pagado ? '#16a34a' : '#dc2626'};color:${pagado ? '#16a34a' : '#dc2626'};font-weight:900;font-size:13px;border-radius:4px;text-transform:uppercase;letter-spacing:1px;}
    .info-table{width:100%;border-collapse:collapse;margin:10px 0;}
    .info-table td{padding:5px 2px;border-bottom:1px solid #eee;vertical-align:top;}
    .info-table td:first-child{color:#555;font-size:11px;text-transform:uppercase;letter-spacing:.5px;width:32%;white-space:nowrap;}
    .info-table td:last-child{font-weight:700;text-align:right;font-size:13px;}
    .orders-table{width:100%;border-collapse:collapse;margin-top:10px;font-size:12px;}
    .orders-table thead tr{background:#f3f4f6;}
    .orders-table th{padding:6px 6px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#444;border-bottom:1px solid #ddd;}
    .orders-table td{padding:6px 6px;border-bottom:1px solid #eee;font-weight:600;}
    .sep{border-top:1px dashed #bbb;margin:10px 0;}
    .firma-row{display:flex;justify-content:space-between;margin-top:28px;}
    .firma-box{width:44%;border-top:1px solid #333;padding-top:4px;text-align:center;font-size:11px;color:#555;}
    .footer{margin-top:14px;font-size:11px;text-align:center;color:#aaa;border-top:1px solid #eee;padding-top:6px;}
  </style></head><body>
  <div class="header">
    <div class="empresa">USER</div>
    <div class="modulo">Logística — Comprobante de Retiro</div>
    <div style="font-size:9px;color:#888;margin-top:1px;font-style:italic;">Local: ${local}</div>
  </div>
  <div class="codigo-principal">${enc.ordenDeRetiro}</div>
  <div style="text-align:center;margin-bottom:8px;">
    <span class="estado-badge">${pagado ? '\u2713 PAGADO' : 'PENDIENTE DE PAGO'}</span>
  </div>
  <table class="info-table">
    <tr><td>Cliente</td><td><strong>${enc.CliNombre || enc.CliCodigoCliente || '-'}</strong></td></tr>
    ${enc.CliCodigoCliente ? `<tr><td>Cód.Cliente</td><td>${enc.CliCodigoCliente}</td></tr>` : ''}
    ${enc.CliTelefono ? `<tr><td>Teléfono</td><td>${enc.CliTelefono}</td></tr>` : ''}
    <tr><td>Tipo Cliente</td><td>${tipoDesc}</td></tr>
    ${monto ? `<tr><td>Monto</td><td>${monedaSimbolo} ${monto}</td></tr>` : ''}
    ${enc.metodoPago ? `<tr><td>Forma Pago</td><td>${enc.metodoPago}</td></tr>` : ''}
    <tr><td>Local Retiro</td><td>${local}</td></tr>
    <tr><td>Fecha Alta</td><td>${enc.fechaAlta ? new Date(enc.fechaAlta).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</td></tr>
    ${(enc.direccionEnvio || enc.departamentoEnvio || enc.localidadEnvio || enc.agenciaNombre) ? `
    <tr><td colspan="2" style="padding-top:6px;font-size:9px;color:#666;text-transform:uppercase;font-weight:700;">Datos de Envío</td></tr>
    ${enc.direccionEnvio ? `<tr><td>Dirección</td><td>${enc.direccionEnvio}</td></tr>` : ''}
    ${enc.departamentoEnvio ? `<tr><td>Departamento</td><td>${enc.departamentoEnvio}</td></tr>` : ''}
    ${enc.localidadEnvio ? `<tr><td>Localidad</td><td>${enc.localidadEnvio}</td></tr>` : ''}
    ${enc.agenciaNombre ? `<tr><td>Agencia</td><td><strong>${enc.agenciaNombre}</strong></td></tr>` : ''}
    `: ''}
  </table>
  <div class="sep"></div>
  <div style="font-size:9px;color:#666;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;">Órdenes incluidas (${orderObjs.length})</div>
  <table class="orders-table">
    <thead><tr><th>#</th><th>Código</th><th>Estado</th><th style="text-align:right;">Importe</th></tr></thead>
    <tbody>
      ${orderObjs.map((o, i) => `<tr><td>${i + 1}</td><td><strong>${o.orderNumber || '-'}</strong></td><td>${o.orderEstado || '-'}</td><td style="text-align:right;">${o.orderCosto || '-'}</td></tr>`).join('')}
      ${orderObjs.length === 0 ? '<tr><td colspan="4" style="text-align:center;color:#aaa;">Sin \u00f3rdenes registradas</td></tr>' : ''}
    </tbody>
  </table>
  <div class="sep"></div>
  <table style="width:100%;font-size:9px;color:#666;"><tr><td>Impreso:</td><td style="text-align:right;">${now}</td></tr></table>
  <div style="text-align:center;margin:8px 0 14px;">
    <img src="https://api.qrserver.com/v1/create-qr-code/?size=90x90&data=${encodeURIComponent(enc.ordenDeRetiro)}&color=000000&bgcolor=ffffff&margin=2" alt="QR" style="width:90px;height:90px;border:1px solid #eee;"/>
    <div style="font-size:9px;color:#999;margin-top:2px;letter-spacing:1px;">${enc.ordenDeRetiro}</div>
  </div>
  <div class="firma-row">
    <div class="firma-box">Firma y Aclaración Cliente</div>
    <div class="firma-box">Firma Responsable Logística</div>
  </div>
   <div class="footer">USER \u2014 Conserve este comprobante.</div>
  <div style="text-align:center;margin-top:16px;"><button onclick="window.print()" style="background:#0070bc;color:#fff;border:none;padding:8px 28px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;letter-spacing:.5px;">&#128438; Imprimir</button></div>
  </body></html>`;
    const win = window.open('', '_blank', 'width=620,height=800');
    if (win) { win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 600); }
};

// â”€â”€â”€ LABEL: Shared label HTML generator â”€â”€â”€
const generateLabelBody = (enc) => {
    const nombre = enc.receptorNombre || enc.CliNombre || enc.CliCodigoCliente || '-';
    const telefono = enc.CliTelefono ? enc.CliTelefono.trim() : '';
    const depto = enc.departamentoEnvio || '';
    const localidad = enc.localidadEnvio || '';
    const direccion = enc.direccionEnvio || '';
    const agencia = enc.agenciaNombre || '';
    const ordenRetiro = enc.ordenDeRetiro || '';

    return `<div class="label">
        <div class="header-bar"><span class="logo">USER</span><span class="orden-code">${ordenRetiro}</span></div>
        <div class="dest-section">
            <div class="badge-center"><span class="badge">DESTINATARIO</span></div>
            <div class="dest-nombre">${nombre}</div>
            ${telefono ? `<div class="dest-row">&#9742; ${telefono}</div>` : ''}
            <div class="section-sep"></div>
            ${depto ? `<div class="dest-depto">${depto}</div>` : ''}
            ${localidad ? `<div class="dest-localidad">${localidad}</div>` : ''}
            ${direccion ? `<div class="dest-dir">${direccion}</div>` : ''}
            <div class="section-sep"></div>
            ${agencia ? `<div class="agencia-pill">AGENCIA &#8226; ${agencia}</div>` : ''}
        </div>
        <div class="divider-area"><div class="divider-line"></div></div>
        <div class="rem-section">
            <div class="badge-center"><span class="badge rem-badge">REMITENTE</span></div>
            <div class="rem-nombre">USER</div>
            <div class="rem-dir">Arenal Grande 2667</div>
            <div class="rem-city">Montevideo, Uruguay</div>
            <div class="rem-tel">&#9742; 092284262</div>
        </div>
    </div>`;
};

const LABEL_CSS = `@page{size:10cm 15cm;margin:0;}*{margin:0;padding:0;box-sizing:border-box;}body{font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;background:#f5f5f5;}.label{width:10cm;height:15cm;background:#fff;border:2px solid #222;display:flex;flex-direction:column;page-break-after:always;overflow:hidden;}.label:last-child{page-break-after:avoid;}.header-bar{background:#fff;color:#111;padding:8px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #222;}.logo{font-size:20px;font-weight:900;letter-spacing:3px;text-transform:uppercase;color:#111;}.orden-code{font-size:20px;font-weight:900;font-family:'Courier New',monospace;letter-spacing:1px;color:#111;}.dest-section{flex:1;padding:0 20px;display:flex;flex-direction:column;justify-content:center;align-items:center;}.badge-center{text-align:center;margin-bottom:6px;}.badge{display:inline-block;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:3px;color:#111;background:#fff;padding:4px 14px;border:1.5px solid #222;border-radius:3px;}.dest-nombre{font-size:30px;font-weight:700;text-transform:uppercase;line-height:1.15;margin-bottom:8px;color:#111;text-align:center;width:100%;}.dest-depto{font-size:30px;font-weight:700;color:#111;margin-bottom:4px;line-height:1.2;text-align:center;text-transform:uppercase;width:100%;}.dest-localidad{font-size:24px;font-weight:600;color:#333;margin-bottom:4px;line-height:1.2;text-align:center;text-transform:uppercase;width:100%;}.dest-dir{font-size:20px;font-weight:600;color:#222;margin-bottom:4px;line-height:1.2;text-align:center;text-transform:uppercase;width:100%;}.dest-row{font-size:20px;font-weight:600;color:#333;margin-bottom:4px;line-height:1.2;text-align:center;text-transform:uppercase;width:100%;}.section-sep{width:100%;border-top:3px dashed #333;margin:6px 0;}.agencia-pill{margin:4px 0;font-size:20px;font-weight:800;color:#1a1a1a;background:#f0f0f0;border:1.5px solid #ccc;padding:5px 14px;border-radius:6px;text-align:center;text-transform:uppercase;}.divider-area{display:flex;align-items:center;padding:2px 16px;}.divider-line{flex:1;border-top:3px dashed #333;}.rem-section{padding:8px 20px 10px;background:#fafafa;border-top:1px solid #eee;text-align:center;text-transform:uppercase;}.rem-badge{color:#111;background:#fff;border:1.5px solid #666;}.rem-nombre{font-size:18px;font-weight:900;text-transform:uppercase;letter-spacing:2px;color:#333;margin-bottom:2px;}.rem-dir{font-size:18px;font-weight:700;color:#444;line-height:1.4;}.rem-city{font-size:15px;font-weight:600;color:#666;line-height:1.4;}.rem-tel{font-size:20px;font-weight:800;color:#333;line-height:1.4;margin-top:2px;}@media print{body{background:#fff;}.label{border:none;}}`;

const printLabels = (encomiendas) => {
    const labelsHtml = (Array.isArray(encomiendas) ? encomiendas : [encomiendas]).map(generateLabelBody).join('');
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>Etiquetas</title><style>${LABEL_CSS}</style></head><body>${labelsHtml}</body></html>`;
    const win = window.open('', '_blank', 'width=420,height=620');
    if (win) { win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 400); }
};

const EntregaPedidosView = () => {
    const { user } = useAuth();
    const [activeTab, setActiveTab] = useState(() => {
        // En mobile arrancamos en 'transport' por defecto (En viaje), en desktop en 'encomiendas'
        return typeof window !== 'undefined' && window.innerWidth <= 768 ? 'transport' : 'encomiendas';
    });
    const [loading, setLoading] = useState(false);

    // --- TAB: MOSTRADOR (Gestión por Cliente / Pedido) ---
    const [searchTerm, setSearchTerm] = useState('');
    const [clientData, setClientData] = useState(null);
    // Lista completa de órdenes sin retiro (auto-cargada al activar tab)
    const [mostradorAllSinRetiro, setMostradorAllSinRetiro] = useState([]);
    const [filtroLugarMostrador, setFiltroLugarMostrador] = useState(''); // '' = Todas
    const [loadingMostradorAll, setLoadingMostradorAll] = useState(false);

    // --- TAB: ENCOMIENDAS (DESPACHOS) ---
    const [lugaresRetiro, setLugaresRetiro] = useState([]);
    const [filtroLugar, setFiltroLugar] = useState('2'); // Por defecto '2' (Encomiendas)
    const [filtroPagoEncomiendas, setFiltroPagoEncomiendas] = useState('todas'); // todas, pagas, nopagas

    const [encomiendas, setEncomiendas] = useState([]);
    const [selectedEncomiendas, setSelectedEncomiendas] = useState(new Set());
    const [showAlertaAuth, setShowAlertaAuth] = useState(false);
    const [pendingDelivery, setPendingDelivery] = useState(null);
    const [filtroLogistica, setFiltroLogistica] = useState(''); // buscador inline en tab Logística

    // --- HISTORIAL DEL DÍA ---
    const [historialHoy, setHistorialHoy] = useState([]);
    const [showHistorial, setShowHistorial] = useState(false);
    const [loadingHistorial, setLoadingHistorial] = useState(false);
    const [selectedHistorial, setSelectedHistorial] = useState(new Set());
    const [filtroFechaHistorial, setFiltroFechaHistorial] = useState(new Date().toISOString().split('T')[0]);
    const [filtroLugarHistorial, setFiltroLugarHistorial] = useState('2'); // Por defecto '2' (Encomiendas)

    // Modal: Generar Retiro desde Órdenes sin Retiro
    const [retiroModal, setRetiroModal] = useState(null); // { ordenes: [] } | null
    const [retiroLugar, setRetiroLugar] = useState('');
    const [retiroGenerando, setRetiroGenerando] = useState(false);
    // Datos de envío para el modal de retiro
    const [retiroEnvio, setRetiroEnvio] = useState({ direccion: '', departamentoId: '', localidadId: '', agenciaId: '' });
    const [clienteEnvioDatos, setClienteEnvioDatos] = useState(null);
    const [retiroDirSeleccionada, setRetiroDirSeleccionada] = useState(null);
    // Nomencladores globales (cargados una vez al montar)
    const [agenciasLista, setAgenciasLista] = useState([]);
    const [departamentosLista, setDepartamentosLista] = useState([]);
    const [localidadesLista, setLocalidadesLista] = useState([]);

    // Selección múltiple en tabla sinRetiro
    const [selectedSinRetiro, setSelectedSinRetiro] = useState(new Set()); // Set de OrdIdOrden

    // UI State para expandir filas (ver las ordenes hijas)
    const [expandedRows, setExpandedRows] = useState(new Set());

    // --- INICIALIZACIÓN ---
    // Refs para que el socket handler siempre acceda a la versión más reciente de las funciones
    const loadDespachoRef = useRef(null);
    const loadSinRetiroRef = useRef(null);

    useEffect(() => {
        loadLugaresRetiro();
        Promise.all([
            api.get('/nomenclators/agencies'),
            api.get('/nomenclators/departments'),
            api.get('/nomenclators/localities/0').catch(() => ({ data: [] }))
        ]).then(([ags, deptos]) => {
            setAgenciasLista(ags.data?.data || ags.data || []);
            setDepartamentosLista(deptos.data?.data || deptos.data || []);
        }).catch(err => console.warn('[Nomencladores envío]', err));
    }, []);

    // Socket listener: reacciona a cambios de retiros en tiempo real
    useEffect(() => {
        const handleRetiroUpdate = (payload) => {
            const tipo = payload?.type || '';
            if (tipo === 'entregado' && Array.isArray(payload.ordenesRetiro)) {
                // Eliminar instantáneamente los retiros entregados de la lista de encomiendas
                const entregados = new Set(payload.ordenesRetiro.map(o => String(o).toUpperCase()));
                setEncomiendas(prev => prev.filter(enc => !entregados.has(String(enc.ordenDeRetiro || '').toUpperCase())));
            } else if (tipo === 'nuevo_retiro') {
                // Alguien creó un retiro â†’ refrescar sinRetiro
                if (loadSinRetiroRef.current) loadSinRetiroRef.current();
            } else if (tipo === 'pago_web' || tipo === 'estado' || tipo === '') {
                // Refrescar encomiendas si estamos en ese tab
                if (loadDespachoRef.current) loadDespachoRef.current();
            }
        };
        socket.on('retiros:update', handleRetiroUpdate);
        return () => socket.off('retiros:update', handleRetiroUpdate);
    }, []);

    useEffect(() => {
        if (activeTab === 'encomiendas') {
            loadDespachos();
        } else if (activeTab === 'mostrador') {
            loadTodasSinRetiro(filtroLugarMostrador);
        } else if (activeTab === 'historial') {
            loadHistorialHoy();
        }
    }, [activeTab, filtroFechaHistorial, filtroLugarHistorial]); // Solo recarga al cambiar de tab o filtros

    // Cargar historial de encomiendas entregadas
    const loadHistorialHoy = async () => {
        setLoadingHistorial(true);
        try {
            // Fetch all states: Generado(1), Armando(2), Preparado(3), Autorizado(4), Entregado(5), Cancelado(6), Abonado(8), Pronto(9), Despachado/En Viaje(10)
            const res = await api.get(`/apiordenesRetiro/estados?estados=1,2,3,4,5,6,8,9,10&date=${filtroFechaHistorial}`);

            let filtrados = res.data || [];
            if (filtroLugarHistorial && filtroLugarHistorial !== 'todas') {
                filtrados = filtrados.filter(enc => String(enc.formaEnvioId) === String(filtroLugarHistorial));
            }

            setHistorialHoy(filtrados);
        } catch (err) {
            console.error('[Historial] Error:', err);
        } finally {
            setLoadingHistorial(false);
        }
    };

    // Cargar lista completa de órdenes sin retiro (con filtro opcional por lugar)
    const loadTodasSinRetiro = async (lugar = filtroLugarMostrador) => {
        setLoadingMostradorAll(true);
        try {
            const params = lugar ? `?lugar=${lugar}` : '';
            const res = await api.get(`/apiordenesRetiro/sin-retiro${params}`);
            setMostradorAllSinRetiro(res.data?.sinRetiro || []);
        } catch (err) {
            console.error('[SinRetiro]', err);
            toast.error('Error al cargar órdenes sin retiro');
        } finally {
            setLoadingMostradorAll(false);
        }
    };
    loadSinRetiroRef.current = loadTodasSinRetiro;

    // Cargar Catálogo de Lugares
    const loadLugaresRetiro = async () => {
        try {
            const response = await api.get('/apilugaresRetiro/lugares-retiro');
            setLugaresRetiro(response.data);
            // Si la data viene vacía, no pisamos el filtro por ahora
        } catch (error) {
            console.error("Error cargando lugares:", error);
            toast.error("Error al cargar los Lugares de Retiro");
        }
    };

    // Cargar las "Encomiendas" desde el Endpoint de Backend
    // Recibe los filtros como parámetros para evitar capturar valores desactualizados del closure
    const loadDespachos = async (lugar = filtroLugar, filtroPago = filtroPagoEncomiendas) => {
        setLoading(true);
        try {
            const pagas = filtroPago === 'pagas' ? 'true' : '';
            const nopagas = filtroPago === 'nopagas' ? 'true' : '';

            let url;
            if (!lugar || lugar === 'todas') {
                url = `/apiordenesRetiro/estados?estados=1,2,3,4,8,9${pagas ? '&pagas=true' : ''}${nopagas ? '&no_pagas=true' : ''}`;
            } else {
                url = `/apiordenesRetiro/lugar/${lugar}?pagas=${pagas}&no_pagas=${nopagas}`;
            }
            const response = await api.get(url);

            setEncomiendas(response.data || []);
            setSelectedEncomiendas(new Set());
        } catch (error) {
            console.error("Error cargando despachos:", error);
            toast.error("Error al cargar las Órdenes de Retiro");
        } finally {
            setLoading(false);
        }
    };
    // Conectar ref para el socket handler
    loadDespachoRef.current = loadDespachos;


    // --- ACCIONES TAB ENCOMIENDAS ---
    const toggleRow = (ordenRetiro) => {
        const newSet = new Set(expandedRows);
        if (newSet.has(ordenRetiro)) {
            newSet.delete(ordenRetiro);
        } else {
            newSet.add(ordenRetiro);
        }
        setExpandedRows(newSet);
    };

    const toggleCheckEncomienda = (ordenRetiro) => {
        const newSet = new Set(selectedEncomiendas);
        if (newSet.has(ordenRetiro)) {
            newSet.delete(ordenRetiro);
        } else {
            newSet.add(ordenRetiro);
        }
        setSelectedEncomiendas(newSet);
    };

    const toggleAllEncomiendas = () => {
        if (selectedEncomiendas.size === encomiendas.length && encomiendas.length > 0) {
            setSelectedEncomiendas(new Set());
        } else {
            setSelectedEncomiendas(new Set(encomiendas.map(e => e.ordenDeRetiro)));
        }
    };

    const generarRemitoLogistico = async () => {
        const sel = encomiendas.filter(e => selectedEncomiendas.has(e.ordenDeRetiro));
        if (sel.length === 0) return toast.warning('Seleccioná al menos una orden para remito.');

        try {
            setLoading(true);
            const userLocalStorage = JSON.parse(localStorage.getItem('user')) || { username: 'Sistema', id: 1 };

            const newBultos = sel.map(enc => ({
                ordenId: parseInt(enc.ordenDeRetiro.split('-').pop(), 10),
                descripcion: `Encomienda: ${enc.CliNombre || enc.CliCodigoCliente || enc.ordenDeRetiro}`,
                tipo: 'ENCOMIENDA'
            }));

            const payload = {
                codigoRemito: 'AUTO',
                areaOrigen: 'LOGISTICA_ENCOMIENDAS',
                areaDestino: 'AGENCIAS_EXTERNAS',
                usuarioId: userLocalStorage.id || userLocalStorage.IdUsuario || 1,
                transportista: userLocalStorage.username || 'Operador',
                bultosIds: [],
                newBultos: newBultos,
                observations: 'Despacho de encomiendas agrupado'
            };

            const res = await logisticsService.createDispatch(payload);
            toast.success(`Remito ${res.dispatchCode} generado con éxito`);

            // Opcional: imprimir resumen luego
            printResumenSeleccionados(res.dispatchCode);

            setSelectedEncomiendas(new Set());
            loadDespachos(filtroLugar, filtroPagoEncomiendas);
        } catch (error) {
            console.error("Error generando remito:", error);
            toast.error("Error al generar remito: " + (error.response?.data?.error || error.message));
        } finally {
            setLoading(false);
        }
    };

    const printResumenSeleccionados = (remitoCode = null) => {
        const sel = encomiendas.filter(e => selectedEncomiendas.has(e.ordenDeRetiro));
        if (sel.length === 0) return toast.warning('Seleccioná al menos una orden.');
        const fecha = new Date().toLocaleString('es-UY', { timeZone: 'America/Montevideo' });
        // Agrupar por agencia (agenciaNombre o 'Sin Agencia / Retiro Local')
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
                    ${enc.CliTelefono ? `<div style="font-size:11px;color:#64748b;">&#128222; ${enc.CliTelefono}</div>` : ''}
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
                <div style="background:#0070bc;color:#fff;padding:8px 14px;border-radius:6px 6px 0 0;font-size:13px;font-weight:900;letter-spacing:.5px;">
                    &#128666; ${agencia} &nbsp;<span style="font-size:11px;font-weight:400;opacity:.85;">(${ordenes.length} retiro${ordenes.length > 1 ? 's' : ''})</span>
                </div>
                <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-top:none;">
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
        const win = window.open('', '_blank', 'width=1050,height=950');
        if (win) { win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 700); }
    };

    const marcarEntregadas = async () => {
        if (selectedEncomiendas.size === 0) {
            return toast.warning('Selecciona al menos una orden para entregar.');
        }

        // Verificar si alguna orden seleccionada está sin pago y sin autorización (estado 9)
        const sinPagoSinAutorizar = Array.from(selectedEncomiendas).filter(ordenCodigo => {
            const orden = encomiendas.find(e => e.ordenDeRetiro === ordenCodigo);
            if (!orden) return false;
            const esSemanal = orden.TClIdTipoCliente === 2;
            if (esSemanal) return false; // Semanal: entrega siempre sin importar pago/autorización
            const noPaga = orden.pagorealizado === 0;
            const autorizada = orden.OReEstadoActual === 9 || orden.estado === 9;
            return noPaga && !autorizada;
        });

        if (sinPagoSinAutorizar.length > 0) {
            // No se puede entregar — debe pasar por Caja (pagar o autorizar)
            Swal.fire({
                toast: true, position: 'top-end', icon: 'warning', title: sinPagoSinAutorizar.length > 1
                    ? `${sinPagoSinAutorizar.length} órdenes no están pagas ni autorizadas. Debe pasar por Caja.`
                    : `"${sinPagoSinAutorizar[0]}" no está paga ni autorizada. Debe pasar por Caja.`,
                showConfirmButton: false, timer: 4000,
                showClass: { popup: 'animate-[slideInRight_0.3s_ease-out]' },
                hideClass: { popup: 'animate-[slideOutRight_0.3s_ease-in]' }
            });
            return;
        }

        // Todas pagas o autorizadas â†’ entregar directamente
        await ejecutarEntrega(Array.from(selectedEncomiendas), null, null);
    };

    const ejecutarEntrega = async (ordenes, password, observacion) => {
        setLoading(true);
        try {
            const payload = { ordenesParaEntregar: ordenes, password, observacion };
            const response = await api.post('/apiordenesRetiro/despachos/entregar-autorizado', payload);
            Swal.fire({
                toast: true, position: 'top-end', icon: 'success',
                title: response.data.message || 'Órdenes entregadas correctamente.',
                showConfirmButton: false, timer: 3000,
                showClass: { popup: 'animate-[slideInRight_0.3s_ease-out]' },
                hideClass: { popup: 'animate-[slideOutRight_0.3s_ease-in]' }
            });
            loadDespachos();
        } catch (error) {
            const errorMsg = error.response?.data?.error || 'Error al procesar la entrega.';
            Swal.fire('Error', errorMsg, 'error');
        } finally {
            setLoading(false);
        }
    };

    // Entregar una sola orden (desde el botón por renglón) con la misma lógica de bloqueo
    const ejecutarEntregarUna = (ordenCodigo, enc) => {
        const esSemanal = enc.TClIdTipoCliente === 2;
        if (!esSemanal) {
            const noPaga = enc.pagorealizado === 0;
            const autorizada = enc.OReEstadoActual === 9 || enc.estado === 9;
            if (noPaga && !autorizada) {
                Swal.fire({
                    toast: true, position: 'top-end', icon: 'warning', title: `"${ordenCodigo}" no está paga ni autorizada. Debe pasar por Caja.`, showConfirmButton: false, timer: 4000,
                    showClass: { popup: 'animate-[slideInRight_0.3s_ease-out]' },
                    hideClass: { popup: 'animate-[slideOutRight_0.3s_ease-in]' }
                });
                return;
            }
        }
        ejecutarEntrega([ordenCodigo], null, null);
    };


    // --- ACCIONES TAB MOSTRADOR ---
    const [mostradorData, setMostradorData] = useState(null);
    const [mostradorLoading, setMostradorLoading] = useState(false);
    const [pagoModal, setPagoModal] = useState(null);   // { ordenes, retiroId, clienteInfo }
    const [metodosPago, setMetodosPago] = useState([]);
    const [pagandoLoading, setPagandoLoading] = useState(false);

    // Igual que Caja
    const [formaPago, setFormaPago] = useState('');
    const [monedaPago, setMonedaPago] = useState('UYU');
    const [montoPago, setMontoPago] = useState('');
    const [cotizacion, setCotizacion] = useState(null);
    const [fileComprobante, setFileComprobante] = useState(null);

    // Carga métodos + cotización al montar (igual que Caja)
    useEffect(() => {
        const cargarDatosPago = async () => {
            try {
                const [resMetodos, resCotiz] = await Promise.allSettled([
                    api.get('/apipagos/metodos'),
                    api.get('/apicotizaciones/hoy')
                ]);
                if (resMetodos.status === 'fulfilled')
                    setMetodosPago(Array.isArray(resMetodos.value.data) ? resMetodos.value.data : []);
                if (resCotiz.status === 'fulfilled' && resCotiz.value.data?.cotizaciones?.length > 0)
                    setCotizacion(resCotiz.value.data.cotizaciones[0].CotDolar);
            } catch (e) { console.error('Error cargando datos de pago:', e); }
        };
        cargarDatosPago();
    }, []);

    // Conversión de moneda igual que Caja
    const handleCambioMoneda = (nuevaMoneda) => {
        let payment = parseFloat(montoPago);
        if (isNaN(payment) || payment <= 0) { setMonedaPago(nuevaMoneda); return; }
        if (monedaPago === 'USD' && nuevaMoneda === 'UYU' && cotizacion) payment = payment * cotizacion;
        else if (monedaPago === 'UYU' && nuevaMoneda === 'USD' && cotizacion) payment = payment / cotizacion;
        setMonedaPago(nuevaMoneda);
        setMontoPago(payment.toFixed(2));
    };

    const buscarMostrador = async () => {
        if (!searchTerm.trim()) return toast.warning('Ingresá un criterio de búsqueda.');
        setMostradorLoading(true);
        setMostradorData(null);
        try {
            const res = await api.get(`/apiordenesRetiro/mostrador/buscar?q=${encodeURIComponent(searchTerm.trim())}`);
            const { retiroRows, sinRetiro } = res.data;
            const retiroMap = {};
            for (const row of retiroRows) {
                const key = row.OReIdOrdenRetiro;
                if (!retiroMap[key]) {
                    retiroMap[key] = {
                        OReIdOrdenRetiro: key,
                        etiqueta: `R-${key}`,
                        estadoRetiro: row.estadoRetiro,
                        lugarRetiro: row.lugarRetiro,
                        CliNombre: row.CliNombre,
                        CliCodigo: row.CliCodigo,
                        CliTelefono: row.CliTelefono,
                        TClDescripcion: row.TClDescripcion,
                        ordenes: []
                    };
                }
                if (row.OrdIdOrden) {
                    retiroMap[key].ordenes.push({
                        OrdIdOrden: row.OrdIdOrden,
                        codigo: row.OrdCodigoOrden,
                        costo: row.OrdCostoFinal,
                        estado: row.estadoOrden,
                        simbolo: row.MonSimbolo,
                    });
                }
            }
            setMostradorData({ retiros: Object.values(retiroMap), sinRetiro });
            if (Object.values(retiroMap).length === 0 && sinRetiro.length === 0)
                toast.info('No se encontraron órdenes sin pagar para ese criterio.');
        } catch (err) {
            toast.error(err.response?.data?.error || 'Error en la búsqueda.');
        } finally {
            setMostradorLoading(false);
        }
    };

    // Cargar datos de envío del cliente (direcciones guardadas + defaults)
    const cargarEnvioCliente = async (cliIdFK) => {
        if (!cliIdFK) return;
        try {
            const res = await api.get(`/apiordenesRetiro/cliente-envio/${cliIdFK}`);
            setClienteEnvioDatos(res.data);
            const deptId = res.data.defaultDepartamentoId || '';
            // Si hay departamento, pre-cargar las localidades de ese depto
            if (deptId) {
                api.get(`/nomenclators/localities/${deptId}`)
                    .then(r => setLocalidadesLista(r.data?.data || r.data || []))
                    .catch(() => { });
            }
            setRetiroEnvio({
                direccion: res.data.defaultDir || '',
                departamentoId: deptId,
                localidadId: res.data.defaultLocalidadId || '',
                agenciaId: res.data.defaultAgenciaId || ''
            });
            setRetiroDirSeleccionada(null);
        } catch (err) {
            console.error('[EnvioCliente] Error cargando datos:', err);
        }
    };

    // Cuando cambia departamento, carga sus localidades
    const handleDepartamentoChange = (deptId) => {
        setRetiroEnvio(prev => ({ ...prev, departamentoId: deptId, localidadId: '' }));
        setLocalidadesLista([]);
        if (deptId) {
            api.get(`/nomenclators/localities/${deptId}`)
                .then(r => setLocalidadesLista(r.data?.data || r.data || []))
                .catch(() => { });
        }
    };

    const abrirModalPago = (ordenes, retiroId, clienteInfo) => {
        // Detectar si todas las órdenes están en la misma moneda
        const esUSD = (o) => {
            const sim = (o.simbolo || o.MonSimbolo || '').toUpperCase();
            return sim.includes('US') || o.monedaId === 2 || o.MonIdMoneda === 2;
        };
        const todasUSD = ordenes.every(o => esUSD(o));
        const todasUYU = ordenes.every(o => !esUSD(o));

        let monedaInicial, total;
        if (todasUSD) {
            // Todas en USD â†’ mostrar en USD directamente
            monedaInicial = 'USD';
            total = ordenes.reduce((a, o) => a + parseFloat(o.costo || o.OrdCostoFinal || 0), 0);
        } else if (todasUYU) {
            // Todas en UYU â†’ mostrar en UYU directamente
            monedaInicial = 'UYU';
            total = ordenes.reduce((a, o) => a + parseFloat(o.costo || o.OrdCostoFinal || 0), 0);
        } else {
            // Mixto â†’ convertir todo a UYU
            monedaInicial = 'UYU';
            total = ordenes.reduce((a, o) => {
                const val = parseFloat(o.costo || o.OrdCostoFinal || 0);
                return a + (esUSD(o) && cotizacion ? val * cotizacion : val);
            }, 0);
        }
        // Default: buscar Transferencia entre los métodos cargados
        const defMetodo = metodosPago.find(m =>
            m.MPaDescripcionMetodo?.toLowerCase().includes('transferencia')
        );
        setFormaPago(defMetodo ? String(defMetodo.MPaIdMetodoPago) : '');
        setMonedaPago(monedaInicial);
        setMontoPago(total.toFixed(2));
        setFileComprobante(null);
        setPagoModal({ ordenes, retiroId, clienteInfo });
    };

    const confirmarPago = async () => {
        if (!formaPago) return toast.warning('Seleccioná un método de pago.');
        const importe = parseFloat(montoPago);
        if (isNaN(importe) || importe <= 0) return toast.warning('Ingresá un monto válido.');
        setPagandoLoading(true);
        try {
            const monedaId = monedaPago === 'USD' ? 2 : 1;
            let comprobanteUrl = null;

            if (fileComprobante) {
                const formData = new FormData();
                formData.append('comprobante', fileComprobante);
                try {
                    const up = await api.post('/apipagos/uploadComprobante', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
                    comprobanteUrl = up.data?.filename || up.data?.comprobanteUrl || null;
                } catch (e) { console.warn('Comprobante no subió:', e); }
            }

            const orderIds = pagoModal.ordenes.map(o => o.OrdIdOrden);
            const payload = {
                metodoPagoId: parseInt(formaPago),
                monedaId,
                monto: importe,
                ordenRetiro: pagoModal.retiroId || null,
                orderNumbers: orderIds,
                comprobanteUrl
            };
            console.log('[PAGO MOSTRADOR] Enviando:', JSON.stringify(payload, null, 2));
            console.log('[PAGO MOSTRADOR] Cliente:', pagoModal.clienteInfo?.CliNombre, '| Tipo:', pagoModal.clienteInfo?.TClDescripcion, '| Estado Retiro:', pagoModal.clienteInfo?.estadoRetiro, '| Retiro:', pagoModal.retiroId);
            const response = await api.post('/apipagos/realizarPago', payload);
            console.log('[PAGO MOSTRADOR] Respuesta:', JSON.stringify(response.data, null, 2));
            toast.success('✅ Pago registrado correctamente');
            setPagoModal(null);
            // Refrescar la sección correcta según el origen del pago
            if (searchTerm.trim()) {
                buscarMostrador();           // venía del buscador â†’ actualizar resultados
            } else {
                loadTodasSinRetiro(filtroLugarMostrador); // venía de "Sin Retiro" â†’ actualizar esa lista
            }

        } catch (err) {
            console.error('[PAGO MOSTRADOR] Error:', err.response?.data || err.message);
            toast.error(err.response?.data?.error || 'Error al registrar el pago.');
        } finally {
            setPagandoLoading(false);
        }
    };


    return (
        <div className="p-0 md:p-4 lg:p-8 w-full max-w-[1400px] mx-auto min-h-[85vh] flex flex-col gap-0 md:gap-6 animate-in fade-in duration-300 pb-12">
            {/* Cabecera */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-4 md:p-6 rounded-none md:rounded-2xl shadow-sm border-b md:border border-slate-200">
                <div>
                    <h1 className="text-2xl md:text-3xl font-black text-slate-800 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-brand-cyan/10 flex items-center justify-center shrink-0">
                            <Package className="text-brand-cyan" size={22} />
                        </div>
                        Entrega de Pedidos & Logística
                    </h1>
                    <p className="text-sm md:text-base text-slate-500 mt-2 font-medium">Gestión integral de despachos, retiros y cobranza remota.</p>
                </div>
            </div>

            {/* Tabs Selector */}
            <div className="grid grid-cols-2 xl:flex gap-2 p-2 md:p-1 bg-slate-200/50 rounded-none md:rounded-xl w-full xl:w-fit border-b md:border-none border-slate-200">
                <button
                    onClick={() => setActiveTab('encomiendas')}
                    className={`px-4 py-3 xl:py-2.5 rounded-lg font-bold text-sm transition-all duration-200 flex items-center justify-center xl:justify-start gap-2 ${activeTab === 'encomiendas' ? 'bg-white text-brand-cyan shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <Package size={18} className="shrink-0" /> <span className="text-xs xl:text-sm">Logística y Despachos</span>
                </button>
                <button
                    onClick={() => setActiveTab('mostrador')}
                    className={`px-4 py-3 xl:py-2.5 rounded-lg font-bold text-sm transition-all duration-200 flex items-center justify-center xl:justify-start gap-2 ${activeTab === 'mostrador' ? 'bg-white text-brand-cyan shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <Truck size={18} className="shrink-0" /> <span className="text-xs xl:text-sm">Mostrador</span>
                </button>
                <button
                    onClick={() => setActiveTab('historial')}
                    className={`px-4 py-3 xl:py-2.5 rounded-lg font-bold text-sm transition-all duration-200 flex items-center justify-center xl:justify-start gap-2 ${activeTab === 'historial' ? 'bg-white text-brand-cyan shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    <History size={18} className="shrink-0" /> <span className="text-xs xl:text-sm">Historial del día</span>
                </button>
                <button
                    onClick={() => setActiveTab('transport')}
                    className={`px-4 py-3 xl:py-2.5 rounded-lg font-bold text-sm transition-all duration-200 flex items-center justify-center xl:justify-start gap-2 ${activeTab === 'transport' ? 'bg-white text-brand-cyan shadow-sm border border-brand-cyan/20' : 'text-slate-500 hover:text-brand-cyan'}`}
                >
                    <Truck size={18} className="shrink-0" /> <span className="text-xs xl:text-sm">En Viaje</span>
                </button>
            </div>

            {/* TAB: ENCOMIENDAS (DESPACHOS) */}
            {activeTab === 'encomiendas' && (
                <div className="bg-white p-4 md:p-6 rounded-none md:rounded-2xl shadow-sm border-b md:border border-slate-200">
                    <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4">
                        <h2 className="text-xl font-black text-slate-800">Órdenes a Despachar / Entregar</h2>

                        {/* Filtros Especiales */}
                        <div className="flex flex-wrap gap-4 items-center w-full xl:w-auto">
                            <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200">
                                <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">Lugar de Retiro:</span>
                                <select
                                    className="bg-transparent font-bold text-slate-800 text-sm outline-none cursor-pointer"
                                    value={filtroLugar}
                                    onChange={(e) => setFiltroLugar(e.target.value)}
                                >
                                    <option value="">— Todas —</option>
                                    {lugaresRetiro.map(lr => (
                                        <option key={lr.LReIdLugarRetiro} value={lr.LReIdLugarRetiro}>{lr.LReNombreLugar}</option>
                                    ))}
                                    {lugaresRetiro.length === 0 && <option value="" disabled>Cargando...</option>}
                                </select>
                            </div>

                            <select
                                value={filtroPagoEncomiendas}
                                onChange={(e) => setFiltroPagoEncomiendas(e.target.value)}
                                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 outline-none cursor-pointer"
                            >
                                <option value="todas">✅ Mostrar Todas</option>
                                <option value="pagas">💰 Sólo Pagas</option>
                                <option value="nopagas">⏳ No Pagas</option>
                            </select>

                            <button
                                onClick={() => loadDespachos(filtroLugar, filtroPagoEncomiendas)}
                                disabled={loading}
                                className="flex items-center gap-2 bg-brand-cyan hover:bg-brand-cyan text-white font-bold px-4 py-2 rounded-xl text-sm transition-colors shadow-sm"
                            >
                                <Search size={15} />
                                {loading ? 'Buscando...' : 'Buscar'}
                            </button>

                            <button onClick={() => loadDespachos(filtroLugar, filtroPagoEncomiendas)} disabled={loading} className="p-2 text-slate-400 hover:text-brand-cyan hover:bg-brand-cyan/5 rounded-lg transition-colors" title="Recargar">
                                <RefreshCcw size={18} className={loading ? 'animate-spin' : ''} />
                            </button>

                            <div className="flex-1"></div>

                            <button
                                onClick={generarRemitoLogistico}
                                disabled={selectedEncomiendas.size === 0 || loading}
                                className="bg-brand-cyan hover:bg-[#005080] disabled:opacity-50 text-white font-bold px-4 py-2 rounded-xl text-sm transition-colors flex items-center gap-2 shadow-sm"
                                title="Generar Remito Logístico"
                            >
                                <Package size={16} /> Generar Remito ({selectedEncomiendas.size})
                            </button>
                            <button
                                onClick={printResumenSeleccionados}
                                disabled={selectedEncomiendas.size === 0}
                                className="bg-slate-100 hover:bg-slate-200 disabled:opacity-40 text-slate-700 font-bold px-4 py-2 rounded-xl text-sm transition-colors flex items-center gap-2"
                                title="Imprimir hoja de despacho"
                            >
                                <FileText size={16} /> Despacho ({selectedEncomiendas.size})
                            </button>
                            <button
                                onClick={() => {
                                    const sel = encomiendas.filter(e => selectedEncomiendas.has(e.ordenDeRetiro));
                                    if (sel.length === 0) return toast.warning('Seleccioná al menos una orden.');
                                    printLabels(sel);
                                }}
                                disabled={selectedEncomiendas.size === 0}
                                className="bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 text-emerald-700 font-bold px-4 py-2 rounded-xl text-sm transition-colors flex items-center gap-2 border border-emerald-200"
                                title="Imprimir etiquetas de los seleccionados"
                            >
                                <Tag size={16} /> Etiquetas ({selectedEncomiendas.size})
                            </button>
                            <button
                                onClick={marcarEntregadas}
                                disabled={selectedEncomiendas.size === 0 || loading}
                                className="bg-brand-cyan hover:bg-brand-cyan disabled:opacity-50 disabled:hover:bg-brand-cyan text-white font-bold px-5 py-2 rounded-xl text-sm transition-all shadow-md flex items-center gap-2"
                            >
                                <CheckCircle size={16} /> {loading ? <RefreshCcw className="animate-spin" size={16} /> : `Entregar (${selectedEncomiendas.size})`}
                            </button>
                        </div>
                    </div>

                    {/* Buscador rápido dentro de Logística */}
                    <div className="mb-4 relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                        <input
                            type="text"
                            placeholder="Filtrar por orden, cliente o estado..."
                            value={filtroLogistica}
                            onChange={e => setFiltroLogistica(e.target.value)}
                            className="w-full pl-9 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-brand-cyan/40 focus:bg-white transition-all"
                        />
                    </div>


                    {/* â”€â”€ MOBILE: Card list â”€â”€ */}
                    <div className="md:hidden flex flex-col gap-3">
                        {(filtroLogistica.trim()
                            ? encomiendas.filter(enc => {
                                const q = filtroLogistica.toLowerCase();
                                return (
                                    (enc.ordenDeRetiro || '').toLowerCase().includes(q) ||
                                    (enc.CliCodigoCliente || '').toLowerCase().includes(q) ||
                                    (enc.CliNombre || '').toLowerCase().includes(q) ||
                                    (enc.estado || '').toLowerCase().includes(q) ||
                                    (enc.lugarRetiro || '').toLowerCase().includes(q) ||
                                    (enc.orders || []).some(o => (o.orderNumber || '').toLowerCase().includes(q))
                                );
                            })
                            : encomiendas
                        ).map((enc) => {
                            const isExpanded = expandedRows.has(enc.ordenDeRetiro);
                            const isSelected = selectedEncomiendas.has(enc.ordenDeRetiro);
                            const pagado = enc.pagorealizado === 1;
                            const autorizado = enc.OReEstadoActual === 9;
                            const moneda = enc.orders?.[0]?.monedaId === 2 ? 'US$' : '$';

                            return (
                                <div key={enc.ordenDeRetiro}
                                    className={`rounded-xl border transition-all ${isSelected ? 'border-brand-cyan bg-brand-cyan/5 ring-1 ring-brand-cyan/20' : 'border-slate-200 bg-white'} shadow-sm`}>

                                    {/* Card header row */}
                                    <div className="flex items-center gap-3 p-3">
                                        <input
                                            type="checkbox"
                                            className="w-5 h-5 rounded accent-brand-cyan shrink-0"
                                            checked={isSelected}
                                            onChange={() => toggleCheckEncomienda(enc.ordenDeRetiro)}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="font-black text-brand-cyan text-sm">{enc.ordenDeRetiro}</span>
                                                {pagado
                                                    ? <span className="text-[10px] font-black bg-green-100 text-green-700 px-2 py-0.5 rounded-full border border-green-200 uppercase">Pagado</span>
                                                    : autorizado
                                                        ? <span className="text-[10px] font-black bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full border border-amber-200 uppercase">Autorizado</span>
                                                        : <span className="text-[10px] font-black bg-red-100 text-red-600 px-2 py-0.5 rounded-full border border-red-200 uppercase">Pendiente</span>
                                                }
                                                <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full uppercase">{enc.estado}</span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <span className="text-xs font-bold text-slate-700 truncate">{enc.CliCodigoCliente} · {enc.TClDescripcion}</span>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="font-black text-slate-800 text-sm">{moneda} {enc.totalCost}</div>
                                            <div className="text-[10px] text-slate-400 flex items-center gap-1 justify-end"><Truck size={9} /> {enc.lugarRetiro}</div>
                                        </div>
                                    </div>

                                    {/* Actions row */}
                                    <div className="flex border-t border-slate-100 divide-x divide-slate-100">
                                        <button
                                            onClick={() => toggleRow(enc.ordenDeRetiro)}
                                            className="flex-1 py-2 text-xs font-bold text-slate-500 flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-colors"
                                        >
                                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                            {enc.orders?.length || 0} hijas
                                        </button>
                                        <button
                                            onClick={() => printLabels(enc)}
                                            className="flex-1 py-2 text-xs font-bold text-emerald-700 flex items-center justify-center gap-1.5 hover:bg-emerald-50 transition-colors"
                                        >
                                            <Tag size={13} /> Etiqueta
                                        </button>
                                        <button
                                            onClick={() => printTicketEncomienda(enc)}
                                            className="flex-1 py-2 text-xs font-bold text-slate-500 flex items-center justify-center gap-1.5 hover:bg-slate-50 transition-colors"
                                        >
                                            <Printer size={13} /> Ticket
                                        </button>
                                        <button
                                            onClick={() => ejecutarEntregarUna(enc.ordenDeRetiro, enc)}
                                            disabled={loading}
                                            className="flex-1 py-2 text-xs font-black text-brand-cyan flex items-center justify-center gap-1.5 hover:bg-brand-cyan/5 transition-colors disabled:opacity-40"
                                        >
                                            <CheckCircle size={13} /> Entregar
                                        </button>
                                    </div>

                                    {/* Expanded sub-orders */}
                                    {isExpanded && (
                                        <div className="border-t border-slate-100 bg-slate-50 rounded-b-xl divide-y divide-slate-100">
                                            {enc.orders?.map(o => (
                                                <div key={o.orderNumber} className="flex items-center justify-between px-4 py-2">
                                                    <span className="font-bold text-slate-700 text-xs">{o.orderNumber}</span>
                                                    <span className="text-xs text-slate-400">{o.orderEstado || '—'}</span>
                                                    <span className="font-black text-brand-cyan text-xs">{o.orderCosto}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {!loading && encomiendas.length === 0 && (
                            <div className="text-center py-12 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                                <Truck size={36} className="mx-auto mb-3 text-slate-300" />
                                <p className="font-bold text-slate-500">No hay órdenes para despachar</p>
                                <p className="text-sm text-slate-400">bajo los filtros seleccionados.</p>
                            </div>
                        )}
                        {loading && encomiendas.length === 0 && (
                            <div className="text-center py-10 text-brand-cyan">
                                <RefreshCcw className="animate-spin mx-auto mb-2" size={28} />
                                <p className="font-bold text-sm">Cargando...</p>
                            </div>
                        )}
                    </div>

                    {/* â”€â”€ DESKTOP: Table â”€â”€ */}
                    <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-left border-collapse text-sm">
                            <thead>
                                <tr className="bg-slate-100 text-slate-600 uppercase tracking-wider text-[11px] font-black border-b border-slate-200">
                                    <th className="p-4 w-10 text-center">
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan/40 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                            checked={selectedEncomiendas.size === encomiendas.length && encomiendas.length > 0}
                                            onChange={toggleAllEncomiendas}
                                            disabled={!lugaresRetiro.some(lr => String(lr.LReIdLugarRetiro) === filtroLugar && /encomienda|agencia/i.test(lr.LReNombreLugar))}
                                        />
                                    </th>
                                    <th className="p-4">Orden Retiro</th>
                                    <th className="p-4">Cliente</th>
                                    <th className="p-4">Total Importe</th>
                                    <th className="p-4">Estado / Lugar</th>
                                    <th className="p-4 text-center">Pago</th>
                                    <th className="p-4 text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {(filtroLogistica.trim()
                                    ? encomiendas.filter(enc => {
                                        const q = filtroLogistica.toLowerCase();
                                        return (
                                            (enc.ordenDeRetiro || '').toLowerCase().includes(q) ||
                                            (enc.CliCodigoCliente || '').toLowerCase().includes(q) ||
                                            (enc.CliNombre || '').toLowerCase().includes(q) ||
                                            (enc.estado || '').toLowerCase().includes(q) ||
                                            (enc.lugarRetiro || '').toLowerCase().includes(q) ||
                                            (enc.orders || []).some(o => (o.orderNumber || '').toLowerCase().includes(q))
                                        );
                                    })
                                    : encomiendas
                                ).map((enc) => {
                                    const isExpanded = expandedRows.has(enc.ordenDeRetiro);
                                    const isSelected = selectedEncomiendas.has(enc.ordenDeRetiro);
                                    const clienteEsComun = enc.TClIdTipoCliente !== 2 && enc.TClIdTipoCliente !== 3;

                                    return (
                                        <React.Fragment key={enc.ordenDeRetiro}>
                                            <tr className={`border-b border-slate-100 transition-colors ${isSelected ? 'bg-brand-cyan/5' : 'hover:bg-slate-50'}`}>
                                                <td className="p-4 text-center">
                                                    <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan/40 cursor-pointer" checked={isSelected} onChange={() => toggleCheckEncomienda(enc.ordenDeRetiro)} />
                                                </td>
                                                <td className="p-4">
                                                    <button onClick={() => toggleRow(enc.ordenDeRetiro)} className="flex items-center gap-2 font-black text-brand-cyan hover:opacity-75 transition-colors">
                                                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                        {enc.ordenDeRetiro}
                                                    </button>
                                                    <div className="flex items-center gap-2 ml-6 mt-1">
                                                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{enc.orders?.length || 0} HIJAS</span>
                                                        <button onClick={(e) => { e.stopPropagation(); printTicketEncomienda(enc); }} title="Imprimir ticket" className="w-5 h-5 flex items-center justify-center text-slate-300 hover:text-brand-cyan hover:bg-brand-cyan/5 rounded transition-colors">
                                                            <Printer size={12} />
                                                        </button>
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <span className="font-bold text-slate-800 block text-base leading-none mb-1">{enc.CliCodigoCliente}</span>
                                                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${clienteEsComun ? 'bg-slate-100 text-slate-500' : 'bg-purple-100 text-purple-700'}`}>{enc.TClDescripcion}</span>
                                                </td>
                                                <td className="p-4">
                                                    <span className="font-black text-slate-800 text-lg">{enc.orders?.[0]?.monedaId === 2 ? 'US$' : '$'} {enc.totalCost}</span>
                                                </td>
                                                <td className="p-4">
                                                    <span className="bg-slate-200/80 text-slate-700 px-3 py-1 rounded shadow-sm text-xs font-bold uppercase block w-fit mb-1">{enc.estado}</span>
                                                    <span className="text-xs font-bold text-slate-500 flex items-center gap-1"><Truck size={12} /> {enc.lugarRetiro}</span>
                                                </td>
                                                <td className="p-4 text-center">
                                                    {enc.pagorealizado === 1
                                                        ? <span className="text-green-700 font-black bg-green-100 px-3 py-1 rounded-md text-xs tracking-wider shadow-sm border border-green-200">PAGADO</span>
                                                        : enc.OReEstadoActual === 9
                                                            ? <span className="text-amber-700 font-black bg-amber-100 px-3 py-1 rounded-md text-xs tracking-wider shadow-sm border border-amber-300">AUTORIZADO</span>
                                                            : <span className="text-red-600 font-black bg-red-100 px-3 py-1 rounded-md text-xs tracking-wider shadow-sm border border-red-200">PENDIENTE</span>
                                                    }
                                                </td>
                                                <td className="p-4 text-center" onClick={e => e.stopPropagation()}>
                                                    <div className="flex items-center gap-1.5 justify-center">
                                                        <button title="Imprimir etiqueta" onClick={() => printLabels(enc)} className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg transition-colors"><Tag size={14} /></button>
                                                        <button title="Entregar esta orden" onClick={() => ejecutarEntregarUna(enc.ordenDeRetiro, enc)} disabled={loading} className="p-1.5 bg-brand-cyan/5 hover:bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/30 rounded-lg transition-colors disabled:opacity-40"><CheckCircle size={14} /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr className="bg-slate-50">
                                                    <td colSpan="7" className="p-0 border-b border-slate-200">
                                                        <div className="p-4 pl-14 pt-0">
                                                            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden mt-2">
                                                                <div className="bg-slate-100 px-4 py-2 border-b border-slate-200">
                                                                    <span className="text-xs font-black text-slate-500 uppercase">Composición de {enc.ordenDeRetiro}</span>
                                                                </div>
                                                                <table className="w-full text-xs text-left">
                                                                    <tbody>
                                                                        {enc.orders?.map(o => (
                                                                            <tr key={o.orderNumber} className="border-b border-slate-50 hover:bg-slate-50">
                                                                                <td className="p-3 pl-4 font-bold text-slate-700 w-32">{o.orderNumber}</td>
                                                                                <td className="p-3 text-slate-500 font-medium">{o.orderEstado || '—'}</td>
                                                                                <td className="p-3 font-bold text-brand-cyan text-right pr-4">{o.orderCosto}</td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                                {!loading && encomiendas.length === 0 && (
                                    <tr><td colSpan="7" className="p-10 text-center text-slate-500">
                                        <Truck size={40} className="mx-auto mb-3 text-slate-300" />
                                        <p className="font-bold text-lg">No hay órdenes para despachar</p>
                                        <p className="text-sm font-medium">bajo los filtros seleccionados.</p>
                                    </td></tr>
                                )}
                                {loading && encomiendas.length === 0 && (
                                    <tr><td colSpan="7" className="p-10 text-center text-brand-cyan">
                                        <RefreshCcw className="animate-spin mx-auto mb-3" size={30} />
                                        <p className="font-bold">Cargando...</p>
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                </div>
            )}

            {/* TAB: HISTORIAL DEL DÍA */}
            {activeTab === 'historial' && (
                <div className="bg-white p-4 md:p-6 rounded-none md:rounded-2xl shadow-sm border-b md:border border-slate-200">
                    <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center mb-6 gap-4">
                        <div>
                            <h2 className="text-xl font-black text-slate-800">Historial de fecha</h2>
                            <p className="text-sm text-slate-500 font-medium mt-1">Órdenes con movimientos en el día. Filtralas acá:</p>
                        </div>
                        <div className="flex items-center gap-3">
                            <select
                                value={filtroLugarHistorial}
                                onChange={e => setFiltroLugarHistorial(e.target.value)}
                                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 outline-none cursor-pointer"
                            >
                                <option value="todas">— Seleccionar (Todas) —</option>
                                {lugaresRetiro.map(lr => (
                                    <option key={lr.LReIdLugarRetiro} value={lr.LReIdLugarRetiro}>{lr.LReNombreLugar}</option>
                                ))}
                            </select>

                            <input
                                type="date"
                                value={filtroFechaHistorial}
                                onChange={e => setFiltroFechaHistorial(e.target.value)}
                                className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-2 text-sm font-bold text-slate-700 outline-none focus:ring-2 focus:ring-brand-cyan/40 cursor-pointer"
                            />
                            <button
                                onClick={loadHistorialHoy}
                                disabled={loadingHistorial}
                                className="p-2 text-slate-400 hover:text-brand-cyan hover:bg-brand-cyan/5 rounded-lg transition-colors"
                                title="Recargar"
                            >
                                <RefreshCcw size={18} className={loadingHistorial ? 'animate-spin' : ''} />
                            </button>
                            <button
                                onClick={() => {
                                    const sel = historialHoy.filter(e => selectedHistorial.has(e.ordenDeRetiro));
                                    if (sel.length === 0) return toast.warning('Seleccioná al menos una encomienda.');
                                    printLabels(sel);
                                }}
                                disabled={selectedHistorial.size === 0}
                                className="bg-emerald-50 hover:bg-emerald-100 disabled:opacity-40 text-emerald-700 font-bold px-4 py-2 rounded-xl text-sm transition-colors flex items-center gap-2 border border-emerald-200"
                            >
                                <Tag size={16} /> Reimprimir etiquetas ({selectedHistorial.size})
                            </button>
                        </div>
                    </div>

                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-left border-collapse text-sm">
                            <thead>
                                <tr className="bg-slate-100 text-slate-600 uppercase tracking-wider text-[11px] font-black border-b border-slate-200">
                                    <th className="p-4 w-10 text-center">
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan/40 cursor-pointer"
                                            checked={selectedHistorial.size === historialHoy.length && historialHoy.length > 0}
                                            onChange={() => {
                                                if (selectedHistorial.size === historialHoy.length) setSelectedHistorial(new Set());
                                                else setSelectedHistorial(new Set(historialHoy.map(e => e.ordenDeRetiro)));
                                            }}
                                        />
                                    </th>
                                    <th className="p-4">Retiro</th>
                                    <th className="p-4">Cliente</th>
                                    <th className="p-4">Receptor</th>
                                    <th className="p-4">Destino</th>
                                    <th className="p-4">Agencia</th>
                                    <th className="p-4 text-center">Pago</th>
                                    <th className="p-4 text-center">Acciones</th>
                                </tr>
                            </thead>
                            <tbody>
                                {historialHoy.map(enc => (
                                    <tr key={enc.ordenDeRetiro} className={`border-b border-slate-100 hover:bg-slate-50/80 transition-colors ${selectedHistorial.has(enc.ordenDeRetiro) ? 'bg-brand-cyan/5/50' : ''}`}>
                                        <td className="p-4 text-center">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 rounded border-slate-300 text-brand-cyan focus:ring-brand-cyan/40 cursor-pointer"
                                                checked={selectedHistorial.has(enc.ordenDeRetiro)}
                                                onChange={() => {
                                                    const s = new Set(selectedHistorial);
                                                    s.has(enc.ordenDeRetiro) ? s.delete(enc.ordenDeRetiro) : s.add(enc.ordenDeRetiro);
                                                    setSelectedHistorial(s);
                                                }}
                                            />
                                        </td>
                                        <td className="p-4 font-black text-slate-800">{enc.ordenDeRetiro}</td>
                                        <td className="p-4">
                                            <span className="font-bold text-slate-700">{enc.CliNombre || enc.CliCodigoCliente || '-'}</span>
                                            <span className={`ml-2 text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-500`}>{enc.TClDescripcion}</span>
                                        </td>
                                        <td className="p-4">
                                            <span className="font-bold text-brand-cyan">{enc.receptorNombre || '\u2014'}</span>
                                        </td>
                                        <td className="p-4 text-slate-500 font-medium text-xs">
                                            {[enc.localidadEnvio, enc.departamentoEnvio].filter(Boolean).join(' \u2022 ') || '\u2014'}
                                        </td>
                                        <td className="p-4 font-bold text-slate-600 text-xs">{enc.agenciaNombre || '\u2014'}</td>
                                        <td className="p-4 text-center">
                                            {enc.pagorealizado === 1
                                                ? <span className="text-green-700 font-black bg-green-100 px-3 py-1 rounded-md text-xs">PAGADO</span>
                                                : <span className="text-red-600 font-black bg-red-100 px-3 py-1 rounded-md text-xs">PENDIENTE</span>
                                            }
                                        </td>
                                        <td className="p-4 text-center">
                                            <div className="flex items-center gap-1.5 justify-center">
                                                {enc.comprobanteEntrega && (
                                                    <a
                                                        href={import.meta.env.VITE_COMPROBANTES_ENCOMIENDAS_PATH ? `${import.meta.env.VITE_COMPROBANTES_ENCOMIENDAS_PATH}/${enc.comprobanteEntrega.split('/').pop()}` : `${import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace('/api', '') : ''}${enc.comprobanteEntrega}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        title="Ver comprobante"
                                                        className="p-1.5 bg-brand-cyan/10 hover:bg-brand-cyan/20 text-brand-cyan border border-brand-cyan/20 rounded-lg transition-colors flex items-center justify-center"
                                                    >
                                                        <FileImage size={14} />
                                                    </a>
                                                )}
                                                <button
                                                    title="Reimprimir etiqueta"
                                                    onClick={() => printLabels(enc)}
                                                    className="p-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg transition-colors"
                                                >
                                                    <Tag size={14} />
                                                </button>
                                                <button
                                                    title="Reimprimir ticket"
                                                    onClick={() => printTicketEncomienda(enc)}
                                                    className="p-1.5 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 rounded-lg transition-colors"
                                                >
                                                    <Printer size={14} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}

                                {!loadingHistorial && historialHoy.length === 0 && (
                                    <tr>
                                        <td colSpan="8" className="p-10 text-center text-slate-500">
                                            <Package size={40} className="mx-auto mb-3 text-slate-300" />
                                            <p className="font-bold text-lg">Sin entregas hoy</p>
                                            <p className="text-sm font-medium">Las encomiendas entregadas aparecerán aquí.</p>
                                        </td>
                                    </tr>
                                )}

                                {loadingHistorial && (
                                    <tr>
                                        <td colSpan="8" className="p-10 text-center text-brand-cyan">
                                            <RefreshCcw className="animate-spin mx-auto mb-3 text-brand-cyan/500" size={30} />
                                            <p className="font-bold">Cargando...</p>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB MOSTRADOR — Lista completa + filtro + búsqueda puntual */}
            {
                activeTab === 'mostrador' && (
                    <div className="flex flex-col gap-6">

                        {/* â”€â”€ Buscador Puntual (arriba) â”€â”€ */}
                        <div className="bg-white p-4 md:p-6 rounded-none md:rounded-2xl shadow-sm border-b md:border border-slate-200 flex flex-wrap gap-4 items-end">
                            <div className="flex-1 min-w-[300px]">
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Buscar orden de retiro, depósito o cliente específico</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Ej: R-60653  |  DF-85423  |  MACROSOFT"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-brand-cyan/40 outline-none text-slate-700 font-bold transition-all"
                                        onKeyDown={(e) => e.key === 'Enter' && buscarMostrador()}
                                    />
                                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={20} />
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    // El filtro es en memoria, el botón solo refresca el foco
                                    if (!searchTerm.trim()) toast.warning('Ingresá un criterio de búsqueda.');
                                }}
                                disabled={false}
                                className="bg-brand-cyan hover:bg-brand-cyan text-white font-bold py-3 px-8 rounded-xl shadow-md transition-all flex items-center gap-2"
                            >
                                <Search size={18} />
                                Buscar Expediente
                            </button>
                        </div>

                        {/* â”€â”€ Todas las Órdenes Sin Retiro (debajo del buscador) â”€â”€ */}
                        <div className="bg-white rounded-none md:rounded-2xl shadow-sm border-y md:border border-slate-200 overflow-hidden">
                            <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-4 flex flex-wrap justify-between items-center gap-3">
                                <div>
                                    <div className="text-white font-black text-lg">Órdenes sin Retiro Asignado</div>
                                    <div className="text-amber-100 text-sm">
                                        {loadingMostradorAll ? 'Cargando...' : (() => {
                                            if (searchTerm.trim()) {
                                                const q = searchTerm.trim().toLowerCase();
                                                const count = mostradorAllSinRetiro.filter(o =>
                                                    (o.OrdCodigoOrden || '').toLowerCase().includes(q) ||
                                                    (o.CliNombre || '').toLowerCase().includes(q) ||
                                                    String(o.CliCodigo || '').toLowerCase().includes(q)
                                                ).length;
                                                return `${count} de ${mostradorAllSinRetiro.length} orden(es)`;
                                            }
                                            return `${mostradorAllSinRetiro.length} orden(es) pendientes`;
                                        })()}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    {/* Filtro por Lugar */}
                                    <select
                                        value={filtroLugarMostrador}
                                        onChange={e => {
                                            const v = e.target.value;
                                            setFiltroLugarMostrador(v);
                                            loadTodasSinRetiro(v);
                                            setSelectedSinRetiro(new Set());
                                        }}
                                        className="bg-amber-600/60 text-white font-bold text-sm rounded-xl px-3 py-2 border border-amber-400/40 outline-none focus:ring-2 focus:ring-amber-300 min-w-[180px]"
                                    >
                                        <option value="">— Todos los lugares —</option>
                                        {lugaresRetiro.map(l => (
                                            <option key={l.LReIdLugarRetiro} value={l.LReIdLugarRetiro}>{l.LReNombreLugar}</option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={() => loadTodasSinRetiro(filtroLugarMostrador)}
                                        className="bg-white/10 hover:bg-white/20 text-white font-bold px-3 py-2 rounded-xl border border-white/20 text-sm flex items-center gap-1"
                                    >
                                        <RefreshCcw size={14} className={loadingMostradorAll ? 'animate-spin' : ''} /> Actualizar
                                    </button>

                                </div>
                            </div>

                            {mostradorAllSinRetiro.length > 0 ? (() => {
                                // Filtro en memoria por código de orden, nombre o ID de cliente
                                const q = searchTerm.trim().toLowerCase();
                                const filteredSinRetiro = q
                                    ? mostradorAllSinRetiro.filter(o =>
                                        (o.OrdCodigoOrden || '').toLowerCase().includes(q) ||
                                        (o.CliNombre || '').toLowerCase().includes(q) ||
                                        String(o.CliCodigo || '').toLowerCase().includes(q)
                                    )
                                    : mostradorAllSinRetiro;

                                const selectedArr = filteredSinRetiro.filter(o => selectedSinRetiro.has(o.OrdIdOrden));
                                const allChecked = filteredSinRetiro.length > 0 && selectedArr.length === filteredSinRetiro.length;
                                const someChecked = selectedArr.length > 0;
                                const totalSel = selectedArr.reduce((s, o) => s + parseFloat(o.OrdCostoFinal || 0), 0);
                                return (
                                    <>
                                        {someChecked && (
                                            <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-100">
                                                <span className="text-xs font-bold text-amber-700">{selectedArr.length} seleccionadas</span>
                                                <button
                                                    onClick={() => {
                                                        const items = selectedArr.map(o => ({ ...o, codigo: o.OrdCodigoOrden, costo: o.OrdCostoFinal, simbolo: o.MonSimbolo }));
                                                        abrirModalPago(items, null, selectedArr[0]);
                                                    }}
                                                    className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"
                                                >
                                                    <DollarSign size={12} /> Pagar ({selectedArr.length})
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setRetiroModal({ ordenes: selectedArr });
                                                        setRetiroLugar(String(lugaresRetiro[0]?.LReIdLugarRetiro || ''));
                                                        setRetiroEnvio({ direccion: '', departamentoId: '', localidadId: '', agenciaId: '' });
                                                        setClienteEnvioDatos(null);
                                                        if (selectedArr[0]?.CliIdClienteFK) cargarEnvioCliente(selectedArr[0].CliIdClienteFK);
                                                    }}
                                                    className="bg-brand-cyan hover:bg-brand-cyan text-white font-bold px-3 py-1.5 rounded-lg text-xs flex items-center gap-1"
                                                >
                                                    <ClipboardList size={12} /> Generar Retiro ({selectedArr.length})
                                                </button>
                                            </div>
                                        )}
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-100">
                                                        <th className="p-3 pl-4 w-10">
                                                            <input type="checkbox" checked={allChecked}
                                                                onChange={e => {
                                                                    if (e.target.checked) setSelectedSinRetiro(new Set(filteredSinRetiro.map(o => o.OrdIdOrden)));
                                                                    else setSelectedSinRetiro(new Set());
                                                                }}
                                                                className="w-4 h-4 accent-amber-500 cursor-pointer"
                                                            />
                                                        </th>
                                                        <th className="p-3 text-left">Código</th>
                                                        <th className="p-3 text-left">Cliente</th>
                                                        <th className="p-3 text-left">Lugar Retiro</th>
                                                        <th className="p-3 text-left">Estado</th>
                                                        <th className="p-3 text-right">Importe</th>
                                                        <th className="p-3 pr-4 text-center">Acción</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {filteredSinRetiro.map(o => {
                                                        const isSel = selectedSinRetiro.has(o.OrdIdOrden);
                                                        return (
                                                            <tr key={o.OrdIdOrden}
                                                                className={`border-b border-slate-50 cursor-pointer transition-colors ${isSel ? 'bg-amber-50' : o.Pagada ? 'bg-green-50/60' : 'hover:bg-slate-50'}`}
                                                                onClick={() => setSelectedSinRetiro(prev => { const s = new Set(prev); if (s.has(o.OrdIdOrden)) s.delete(o.OrdIdOrden); else s.add(o.OrdIdOrden); return s; })}
                                                            >
                                                                <td className="p-3 pl-4" onClick={e => e.stopPropagation()}>
                                                                    <input type="checkbox" checked={isSel}
                                                                        onChange={() => setSelectedSinRetiro(prev => { const s = new Set(prev); if (s.has(o.OrdIdOrden)) s.delete(o.OrdIdOrden); else s.add(o.OrdIdOrden); return s; })}
                                                                        className="w-4 h-4 accent-amber-500 cursor-pointer"
                                                                    />
                                                                </td>
                                                                <td className="p-3 font-bold text-slate-800">
                                                                    {o.OrdCodigoOrden}
                                                                    {o.Pagada ? <span className="ml-2 text-[10px] bg-green-100 text-green-700 font-black px-1.5 py-0.5 rounded-full">✓ Paga</span> : null}
                                                                </td>
                                                                <td className="p-3 text-slate-600 font-medium">
                                                                    <div className="font-bold">{o.CliNombre || o.CliCodigo}</div>
                                                                    <div className="text-[10px] text-slate-400">{o.TClDescripcion}</div>
                                                                </td>
                                                                <td className="p-3">
                                                                    {o.LugarRetiroNombre
                                                                        ? <span className="bg-brand-cyan/10 text-brand-cyan text-[10px] font-bold px-2 py-0.5 rounded-full">{o.LugarRetiroNombre}</span>
                                                                        : <span className="text-slate-400 text-xs italic">Sin lugar</span>}
                                                                </td>
                                                                <td className="p-3 font-bold text-slate-800 text-xs">{o.OrdNombreTrabajo || o.estadoOrden || '-'}</td>
                                                                <td className="p-3 text-right font-black text-amber-700">{o.MonSimbolo} {parseFloat(o.OrdCostoFinal || 0).toFixed(2)}</td>
                                                                <td className="p-3 pr-4" onClick={e => e.stopPropagation()}>
                                                                    <div className="flex items-center gap-2 justify-center">
                                                                        {!o.Pagada && (
                                                                            <button
                                                                                onClick={() => abrirModalPago([{ ...o, codigo: o.OrdCodigoOrden, costo: o.OrdCostoFinal, simbolo: o.MonSimbolo }], null, o)}
                                                                                className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-2 py-1 rounded-lg text-xs flex items-center gap-1"
                                                                            >
                                                                                <DollarSign size={11} /> Pagar
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            onClick={() => {
                                                                                setRetiroModal({ ordenes: [o] });
                                                                                setRetiroLugar(o.LReIdLugarRetiro ? String(o.LReIdLugarRetiro) : String(lugaresRetiro[0]?.LReIdLugarRetiro || ''));
                                                                                setRetiroEnvio({ direccion: '', departamentoId: '', localidadId: '', agenciaId: '' });
                                                                                setClienteEnvioDatos(null);
                                                                                if (o.CliIdClienteFK) cargarEnvioCliente(o.CliIdClienteFK);
                                                                            }}
                                                                            className="bg-brand-cyan hover:bg-brand-cyan text-white font-bold px-2 py-1 rounded-lg text-xs flex items-center gap-1"
                                                                        >
                                                                            <ClipboardList size={11} /> Retiro
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                );
                            })() : (
                                <div className="p-10 text-center">
                                    {loadingMostradorAll
                                        ? <RefreshCcw className="animate-spin mx-auto mb-3 text-amber-400" size={28} />
                                        : <><Package size={36} className="mx-auto mb-3 text-slate-300" /><p className="font-bold text-slate-500">No hay órdenes sin retiro{filtroLugarMostrador ? ' para este lugar' : ''}</p></>}
                                </div>
                            )}
                        </div>

                        {/* Resultados de búsqueda puntual */}
                        {mostradorData && (
                            <div className="flex flex-col gap-4">
                                {/* Retiros con órdenes sin pagar */}
                                {mostradorData.retiros.map(ret => (
                                    <div key={ret.OReIdOrdenRetiro} className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                                        <div className="bg-gradient-to-r from-brand-cyan to-[#005080] px-6 py-4 flex justify-between items-center">
                                            <div>
                                                <div className="text-white font-black text-lg tracking-wide">{ret.etiqueta}</div>
                                                <div className="text-brand-cyan/60 text-sm font-medium">{ret.estadoRetiro} · {ret.lugarRetiro}</div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-white font-bold text-sm">{ret.CliNombre || ret.CliCodigo}</div>
                                                <div className="text-brand-cyan/70 text-xs">{ret.TClDescripcion}</div>
                                            </div>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-100">
                                                        <th className="p-3 pl-6 text-left">Código Orden</th>
                                                        <th className="p-3 text-left">Estado</th>
                                                        <th className="p-3 text-right">Importe</th>
                                                        <th className="p-3 pr-6 text-center">Acción</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {ret.ordenes.map(o => (
                                                        <tr key={o.OrdIdOrden} className="border-b border-slate-50 hover:bg-slate-50">
                                                            <td className="p-3 pl-6 font-bold text-slate-800">{o.codigo}</td>
                                                            <td className="p-3 text-slate-500 font-medium">{o.estado}</td>
                                                            <td className="p-3 text-right font-black text-brand-cyan">{o.simbolo} {parseFloat(o.costo || 0).toFixed(2)}</td>
                                                            <td className="p-3 pr-6 text-center">
                                                                <button
                                                                    onClick={() => abrirModalPago([o], ret.etiqueta, ret)}
                                                                    className="bg-green-500 hover:bg-green-600 text-white font-bold px-3 py-1 rounded-lg text-xs transition-colors flex items-center gap-1 mx-auto"
                                                                >
                                                                    <DollarSign size={12} /> Pagar
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="p-4 px-6 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
                                            <span className="text-xs font-bold text-slate-400 uppercase">{ret.ordenes.length} orden(es) sin pagar</span>
                                            <button
                                                onClick={() => abrirModalPago(ret.ordenes, ret.etiqueta, ret)}
                                                className="bg-brand-cyan hover:bg-brand-cyan text-white font-bold px-4 py-2 rounded-xl text-sm transition-colors flex items-center gap-2 shadow-sm"
                                            >
                                                <DollarSign size={14} /> Pagar Todas las Órdenes
                                            </button>
                                        </div>
                                    </div>
                                ))}

                                {/* Órdenes sin retiro */}
                                {mostradorData.sinRetiro.length > 0 && (() => {
                                    const totalSR = mostradorData.sinRetiro.length;
                                    const selectedArr = mostradorData.sinRetiro.filter(o => selectedSinRetiro.has(o.OrdIdOrden));
                                    const allChecked = selectedArr.length === totalSR;
                                    const someChecked = selectedArr.length > 0;
                                    const totalSeleccionado = selectedArr.reduce((s, o) => s + parseFloat(o.OrdCostoFinal || 0), 0);

                                    return (
                                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                                            {/* Header con acciones grupales */}
                                            <div className="bg-gradient-to-r from-amber-500 to-amber-600 px-6 py-4 flex justify-between items-center">
                                                <div>
                                                    <div className="text-white font-black text-lg">Órdenes sin Retiro</div>
                                                    <div className="text-amber-100 text-sm">Sin orden de retiro asignada · {totalSR} orden{totalSR !== 1 ? 'es' : ''}</div>
                                                </div>
                                                {someChecked && (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-white text-xs font-bold bg-amber-700/40 px-2 py-1 rounded-lg">
                                                            {selectedArr.length} sel. · $ {totalSeleccionado.toFixed(2)}
                                                        </span>
                                                        <button
                                                            onClick={() => {
                                                                const items = selectedArr.map(o => ({ ...o, codigo: o.OrdCodigoOrden, costo: o.OrdCostoFinal, simbolo: o.MonSimbolo }));
                                                                abrirModalPago(items, null, selectedArr[0]);
                                                            }}
                                                            className="bg-white text-amber-700 font-black px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 hover:bg-amber-50"
                                                        >
                                                            <DollarSign size={12} /> Pagar ({selectedArr.length})
                                                        </button>
                                                        <button
                                                            onClick={() => { setRetiroModal({ ordenes: selectedArr }); setRetiroLugar(lugaresRetiro[0]?.LReIdLugarRetiro || ''); }}
                                                            className="bg-brand-cyan text-white font-black px-3 py-1.5 rounded-lg text-xs flex items-center gap-1 hover:bg-brand-cyan"
                                                        >
                                                            <ClipboardList size={12} /> Generar Retiro ({selectedArr.length})
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <table className="w-full text-sm">
                                                <thead>
                                                    <tr className="bg-slate-50 text-slate-500 uppercase text-[10px] tracking-wider border-b border-slate-100">
                                                        <th className="p-3 pl-4 w-10">
                                                            <input
                                                                type="checkbox"
                                                                checked={allChecked}
                                                                onChange={e => {
                                                                    if (e.target.checked) setSelectedSinRetiro(new Set(mostradorData.sinRetiro.map(o => o.OrdIdOrden)));
                                                                    else setSelectedSinRetiro(new Set());
                                                                }}
                                                                className="w-4 h-4 accent-amber-500 cursor-pointer"
                                                            />
                                                        </th>
                                                        <th className="p-3 text-left">Código</th>
                                                        <th className="p-3 text-left">Cliente</th>
                                                        <th className="p-3 text-left">Estado</th>
                                                        <th className="p-3 text-right">Importe</th>
                                                        <th className="p-3 pr-6 text-center">Acción Individual</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {mostradorData.sinRetiro.map(o => {
                                                        const isSel = selectedSinRetiro.has(o.OrdIdOrden);
                                                        return (
                                                            <tr key={o.OrdIdOrden} className={`border-b border-slate-50 cursor-pointer transition-colors ${isSel ? 'bg-amber-50' : o.Pagada ? 'bg-green-50/60' : 'hover:bg-slate-50'}`}
                                                                onClick={() => setSelectedSinRetiro(prev => { const s = new Set(prev); if (s.has(o.OrdIdOrden)) s.delete(o.OrdIdOrden); else s.add(o.OrdIdOrden); return s; })}
                                                            >
                                                                <td className="p-3 pl-4" onClick={e => e.stopPropagation()}>
                                                                    <input
                                                                        type="checkbox"
                                                                        checked={isSel}
                                                                        onChange={() => setSelectedSinRetiro(prev => { const s = new Set(prev); if (s.has(o.OrdIdOrden)) s.delete(o.OrdIdOrden); else s.add(o.OrdIdOrden); return s; })}
                                                                        className="w-4 h-4 accent-amber-500 cursor-pointer"
                                                                    />
                                                                </td>
                                                                <td className="p-3 font-bold text-slate-800">
                                                                    {o.OrdCodigoOrden}
                                                                    {o.Pagada ? <span className="ml-2 text-[10px] bg-green-100 text-green-700 font-black px-1.5 py-0.5 rounded-full">✓ Paga</span> : null}
                                                                </td>
                                                                <td className="p-3 text-slate-600 font-medium">{o.CliNombre || o.CliCodigo}</td>
                                                                <td className="p-3 text-slate-500">{o.estadoOrden}</td>
                                                                <td className="p-3 text-right font-black text-amber-700">{o.MonSimbolo} {parseFloat(o.OrdCostoFinal || 0).toFixed(2)}</td>
                                                                <td className="p-3 pr-6" onClick={e => e.stopPropagation()}>
                                                                    <div className="flex items-center gap-2 justify-center">
                                                                        {!o.Pagada && (
                                                                            <button
                                                                                onClick={() => abrirModalPago([{ ...o, codigo: o.OrdCodigoOrden, costo: o.OrdCostoFinal, simbolo: o.MonSimbolo }], null, o)}
                                                                                className="bg-amber-500 hover:bg-amber-600 text-white font-bold px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1"
                                                                            >
                                                                                <DollarSign size={12} /> Pagar
                                                                            </button>
                                                                        )}
                                                                        <button
                                                                            onClick={() => {
                                                                                setRetiroModal({ ordenes: [o] });
                                                                                setRetiroLugar(
                                                                                    o.LReIdLugarRetiro
                                                                                        ? String(o.LReIdLugarRetiro)
                                                                                        : String(lugaresRetiro[0]?.LReIdLugarRetiro || '')
                                                                                );
                                                                                setRetiroEnvio({ direccion: '', departamentoId: '', localidadId: '', agenciaId: '' });
                                                                                setClienteEnvioDatos(null);
                                                                                if (o.CliIdClienteFK) cargarEnvioCliente(o.CliIdClienteFK);
                                                                            }}
                                                                            className="bg-brand-cyan hover:bg-brand-cyan text-white font-bold px-3 py-1.5 rounded-lg text-xs transition-colors flex items-center gap-1"
                                                                        >
                                                                            <ClipboardList size={12} /> Generar Retiro
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                    </div>
                )
            }

            {/* MODAL: GENERAR RETIRO (soporta una o varias órdenes) */}
            {
                retiroModal && (() => {
                    const ordenes = retiroModal.ordenes || [];
                    const totalCost = ordenes.reduce((s, o) => s + parseFloat(o.OrdCostoFinal || 0), 0);
                    const clienteNombre = ordenes[0]?.CliNombre || ordenes[0]?.CliCodigo || '';
                    const simboloTotal = ordenes[0]?.MonSimbolo || '$';
                    const lugarSeleccionado = lugaresRetiro.find(l => String(l.LReIdLugarRetiro) === String(retiroLugar));
                    const esEnvio = lugarSeleccionado && !/local|mostrador/i.test(lugarSeleccionado.LReNombreLugar);
                    return (
                        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
                                <div className="bg-gradient-to-r from-brand-cyan to-[#005080] px-6 py-4 rounded-t-2xl flex justify-between items-center sticky top-0 z-10">
                                    <div>
                                        <div className="text-white font-black text-lg">Generar Orden de Retiro</div>
                                        <div className="text-brand-cyan/70 text-sm">
                                            {ordenes.length === 1
                                                ? `${ordenes[0].OrdCodigoOrden} · ${clienteNombre}`
                                                : `${ordenes.length} órdenes · ${clienteNombre}`}
                                        </div>
                                    </div>
                                    <button onClick={() => setRetiroModal(null)} className="text-white hover:text-brand-cyan/70 text-2xl font-bold">&times;</button>
                                </div>
                                <div className="p-6 flex flex-col gap-4">
                                    {/* Lista de órdenes seleccionadas */}
                                    <div className="bg-slate-50 rounded-xl border border-slate-200 overflow-hidden">
                                        <div className="px-4 py-2 bg-slate-100 text-xs font-bold text-slate-500 uppercase tracking-wider">Incluye</div>
                                        <div className="divide-y divide-slate-100 max-h-36 overflow-y-auto">
                                            {ordenes.map(o => (
                                                <div key={o.OrdIdOrden} className="flex justify-between items-center px-4 py-2 text-sm">
                                                    <span className="font-bold text-slate-800">{o.OrdCodigoOrden}</span>
                                                    <span className="font-black text-brand-cyan">{o.MonSimbolo} {parseFloat(o.OrdCostoFinal || 0).toFixed(2)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="px-4 py-2 bg-brand-cyan/5 flex justify-between text-sm font-black">
                                            <span className="text-slate-600">TOTAL</span>
                                            <span className="text-brand-cyan">{simboloTotal} {totalCost.toFixed(2)}</span>
                                        </div>
                                    </div>

                                    {/* Lugar / Forma de Envío */}
                                    <div>
                                        <label className="block text-sm font-bold text-slate-700 mb-1">Lugar / Forma de Envío</label>
                                        <select
                                            value={retiroLugar}
                                            onChange={e => {
                                                setRetiroLugar(e.target.value);
                                                setRetiroEnvio({ direccion: '', ciudad: '', localidad: '', agenciaId: '' });
                                                setRetiroDirSeleccionada(null);
                                            }}
                                            className="w-full border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand-cyan/40"
                                        >
                                            {lugaresRetiro.map(l => (
                                                <option key={l.LReIdLugarRetiro} value={l.LReIdLugarRetiro}>{l.LReNombreLugar}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* â”€â”€ Sección Dirección: solo cuando NO es retiro local â”€â”€ */}
                                    {esEnvio && (
                                        <div className="flex flex-col gap-3 border border-brand-cyan/20 bg-brand-cyan/5/40 rounded-xl p-4">
                                            <p className="text-xs font-bold text-brand-cyan uppercase tracking-wide">Datos de Envío</p>

                                            {/* Selector de direcciones guardadas */}
                                            {clienteEnvioDatos?.direcciones?.length > 0 && (
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-600 mb-1">Dirección guardada</label>
                                                    <select
                                                        value={retiroDirSeleccionada || ''}
                                                        onChange={e => {
                                                            const id = e.target.value;
                                                            setRetiroDirSeleccionada(id);
                                                            const found = clienteEnvioDatos?.direcciones?.find(d => String(d.ID) === String(id));
                                                            if (found) {
                                                                // Buscar IDs a partir de los nombres guardados
                                                                const deptFound = departamentosLista.find(d => d.Nombre === found.Ciudad);
                                                                const newDeptId = deptFound?.ID || '';
                                                                if (newDeptId) {
                                                                    // Cargar localidades del depto encontrado
                                                                    api.get(`/nomenclators/localities/${newDeptId}`)
                                                                        .then(r => setLocalidadesLista(r.data?.data || r.data || []))
                                                                        .catch(() => { });
                                                                }
                                                                setRetiroEnvio({
                                                                    direccion: found.Direccion || '',
                                                                    departamentoId: String(found.DepartamentoID || newDeptId || ''),
                                                                    localidadId: String(found.LocalidadID || ''),
                                                                    agenciaId: String(found.AgenciaID || '')
                                                                });
                                                            }
                                                        }}
                                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand-cyan/40 bg-white"
                                                    >
                                                        <option value="">— Ingresar manualmente —</option>
                                                        {clienteEnvioDatos.direcciones.map(d => (
                                                            <option key={d.ID} value={d.ID}>{d.Alias || d.Direccion} {d.Ciudad ? `· ${d.Ciudad}` : ''}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}

                                            {/* Agencia — siempre visible si hay datos */}
                                            {agenciasLista.length > 0 && (
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-600 mb-1">Agencia de transporte</label>
                                                    <select
                                                        value={retiroEnvio.agenciaId || ''}
                                                        onChange={e => setRetiroEnvio(prev => ({ ...prev, agenciaId: e.target.value }))}
                                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand-cyan/40 bg-white"
                                                    >
                                                        <option value="">— Sin agencia —</option>
                                                        {agenciasLista.map(a => (
                                                            <option key={a.ID} value={a.ID}>{a.Nombre}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}

                                            {/* Dirección */}
                                            <div>
                                                <label className="block text-xs font-bold text-slate-600 mb-1">Dirección</label>
                                                <input
                                                    type="text"
                                                    value={retiroEnvio.direccion}
                                                    onChange={e => setRetiroEnvio(prev => ({ ...prev, direccion: e.target.value }))}
                                                    placeholder="Ej: Av. Italia 1234"
                                                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand-cyan/40"
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-3">
                                                {/* Departamento */}
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-600 mb-1">Departamento</label>
                                                    <select
                                                        value={retiroEnvio.departamentoId || ''}
                                                        onChange={e => handleDepartamentoChange(e.target.value)}
                                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand-cyan/40 bg-white"
                                                    >
                                                        <option value="">— Seleccionar —</option>
                                                        {departamentosLista.map(d => (
                                                            <option key={d.ID} value={d.ID}>{d.Nombre}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                {/* Localidad */}
                                                <div>
                                                    <label className="block text-xs font-bold text-slate-600 mb-1">Localidad</label>
                                                    <select
                                                        value={retiroEnvio.localidadId || ''}
                                                        onChange={e => setRetiroEnvio(prev => ({ ...prev, localidadId: e.target.value }))}
                                                        disabled={!retiroEnvio.departamentoId}
                                                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-brand-cyan/40 bg-white disabled:opacity-50"
                                                    >
                                                        <option value="">— Seleccionar —</option>
                                                        {localidadesLista.map(l => (
                                                            <option key={l.ID} value={l.ID}>{l.Nombre}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-3 mt-1">
                                        <button onClick={() => setRetiroModal(null)} className="flex-1 border border-slate-200 text-slate-600 font-bold py-2.5 rounded-xl hover:bg-slate-50 transition-colors">
                                            Cancelar
                                        </button>
                                        <button
                                            disabled={retiroGenerando || !retiroLugar}
                                            onClick={async () => {
                                                setRetiroGenerando(true);
                                                try {
                                                    const localidadNombre = localidadesLista.find(l => String(l.ID) === String(retiroEnvio.localidadId))?.Nombre || '';
                                                    const departamentoNombre = departamentosLista.find(d => String(d.ID) === String(retiroEnvio.departamentoId))?.Nombre || '';
                                                    const payload = {
                                                        orders: ordenes.map(o => ({ orderNumber: o.OrdCodigoOrden, orderId: o.OrdIdOrden })),
                                                        totalCost,
                                                        lugarRetiro: parseInt(retiroLugar),
                                                        ...(esEnvio ? {
                                                            direccion: retiroEnvio.direccion || null,
                                                            departamento: departamentoNombre || null,
                                                            localidad: localidadNombre || null,
                                                            agenciaId: retiroEnvio.agenciaId ? parseInt(retiroEnvio.agenciaId) : null
                                                        } : {})
                                                    };
                                                    const res = await api.post('/apiordenesRetiro/crear', payload);
                                                    const idRetiro = res.data.OReIdOrdenRetiro;
                                                    toast.success(`Retiro generado: RL-${idRetiro}`);
                                                    const lugarNombre = lugarSeleccionado?.LReNombreLugar || '';
                                                    printTicketEncomienda({
                                                        ordenDeRetiro: `RL-${idRetiro}`,
                                                        lugarRetiro: lugarNombre,
                                                        totalCost: totalCost.toFixed(2),
                                                        pagorealizado: 0,
                                                        orders: ordenes.map(o => ({ orderNumber: o.OrdCodigoOrden })),
                                                        TClDescripcion: ordenes[0]?.TipoCliente || '',
                                                        idcliente: ordenes[0]?.CliCodigo || '',
                                                    });
                                                    setRetiroModal(null);
                                                    setSelectedSinRetiro(new Set());
                                                    loadTodasSinRetiro(filtroLugarMostrador);
                                                    if (searchTerm.trim()) buscarMostrador();
                                                } catch (err) {
                                                    toast.error('Error al generar retiro: ' + (err.response?.data?.error || err.message));
                                                } finally {
                                                    setRetiroGenerando(false);
                                                }
                                            }}
                                            className="flex-1 bg-brand-cyan hover:bg-brand-cyan disabled:opacity-50 text-white font-black py-2.5 rounded-xl transition-colors shadow-md flex items-center justify-center gap-2"
                                        >
                                            <ClipboardList size={16} />
                                            {retiroGenerando ? 'Generando...' : `Generar${ordenes.length > 1 ? ` (${ordenes.length})` : ''} e Imprimir`}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()
            }

            {/* ALERTA DE AUTORIZACIÓN — Modal custom reemplaza Swal */}
            <AlertaAutorizacionModal
                visible={showAlertaAuth}
                titulo="!ALERTA!"
                subtitulo="Este retiro DEBE SER ABONADO. Por favor verifique que pase por caja y confirme el pago."
                leyenda="ESTO ES UNA EXCEPCIONALIDAD"
                onCancel={() => { setShowAlertaAuth(false); setPendingDelivery(null); }}
                onConfirm={async (password, observacion) => {
                    setShowAlertaAuth(false);
                    if (pendingDelivery) {
                        await ejecutarEntrega(pendingDelivery.ordenesParaEntregar, password, observacion);
                        setPendingDelivery(null);
                    }
                }}
            />

            {/* MODAL DE PAGO — igual a Caja */}
            {
                pagoModal && (
                    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
                            {/* Cabecera */}
                            <div className="bg-gradient-to-r from-brand-cyan to-[#005080] px-6 py-4 rounded-t-2xl flex justify-between items-center">
                                <div>
                                    <div className="text-white font-black text-lg">Registrar Pago</div>
                                    <div className="text-brand-cyan/60 text-sm">{pagoModal.retiroId || 'Orden directa'} · {pagoModal.ordenes.length} orden(es)</div>
                                </div>
                                <button onClick={() => setPagoModal(null)} className="text-white hover:text-brand-cyan/70 text-2xl font-bold leading-none">&times;</button>
                            </div>

                            <div className="p-6 flex flex-col gap-4">
                                {/* Cotización */}
                                {cotizacion && (
                                    <div className="bg-brand-cyan/5 border border-brand-cyan/30 rounded-xl px-4 py-2 text-sm text-brand-cyan font-bold text-center">
                                        Cotización: 1 USD = {Number(cotizacion).toFixed(2)} UYU
                                    </div>
                                )}

                                {/* Resumen órdenes */}
                                <div className="bg-slate-50 rounded-xl p-3 border border-slate-200">
                                    {pagoModal.ordenes.map(o => (
                                        <div key={o.OrdIdOrden} className="flex justify-between text-sm font-bold py-1 border-b border-slate-100 last:border-0">
                                            <span className="text-slate-600">{o.codigo || o.OrdCodigoOrden}</span>
                                            <span className="text-brand-cyan">{o.simbolo} {parseFloat(o.costo || o.OrdCostoFinal || 0).toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Forma de pago — select igual a Caja */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-sm font-bold text-zinc-800">Seleccionar forma de pago</label>
                                    <select
                                        value={formaPago}
                                        onChange={e => setFormaPago(e.target.value)}
                                        className="w-full bg-white border border-zinc-300 rounded-lg px-4 py-2.5 text-zinc-700 outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan/40 appearance-none"
                                    >
                                        <option value="">Seleccione un método</option>
                                        {metodosPago.map(m => (
                                            <option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>{m.MPaDescripcionMetodo}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* Moneda — igual a Caja */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-sm font-bold text-zinc-800">Seleccionar Moneda</label>
                                    <select
                                        value={monedaPago}
                                        onChange={e => handleCambioMoneda(e.target.value)}
                                        className="w-full bg-white border border-zinc-300 rounded-lg px-4 py-2.5 text-zinc-700 outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan/40 appearance-none"
                                    >
                                        <option value="UYU">UYU — Peso Uruguayo</option>
                                        <option value="USD">USD — Dólar</option>
                                    </select>
                                </div>

                                <div className="flex flex-col gap-1">
                                    <label className="text-sm font-bold text-zinc-800">Cargar comprobante (opcional)</label>
                                    <input
                                        type="file"
                                        accept="image/*,application/pdf"
                                        capture="environment"
                                        onChange={e => setFileComprobante(e.target.files[0])}
                                        className="w-full text-sm border border-zinc-300 p-2 rounded-lg cursor-pointer"
                                    />
                                </div>

                                {/* Monto */}
                                <div className="flex flex-col gap-1">
                                    <label className="text-sm font-bold text-zinc-800">Ingrese Monto ({monedaPago})</label>
                                    <input
                                        type="number"
                                        placeholder="Monto"
                                        step="0.01"
                                        value={montoPago}
                                        onChange={e => setMontoPago(e.target.value)}
                                        className="w-full bg-white border border-zinc-300 rounded-lg px-4 py-2.5 text-zinc-700 outline-none focus:border-brand-cyan focus:ring-1 focus:ring-brand-cyan/40 text-lg font-bold"
                                    />
                                </div>

                                {/* Botones */}
                                <div className="flex gap-3 mt-2">
                                    <button onClick={() => setPagoModal(null)} className="flex-1 border border-slate-200 text-slate-600 font-bold py-2.5 rounded-xl hover:bg-slate-50 transition-colors">Cancelar</button>
                                    <button
                                        onClick={confirmarPago}
                                        disabled={pagandoLoading}
                                        className="flex-1 bg-brand-cyan hover:bg-[#005080] disabled:opacity-50 text-white font-black py-2.5 rounded-full transition-colors flex items-center justify-center gap-2 shadow-md"
                                    >
                                        {pagandoLoading ? <RefreshCcw className="animate-spin" size={16} /> : <CheckCircle size={16} />}
                                        {pagandoLoading ? 'Registrando...' : 'Realizar Pago'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* TAB TRANSPORT (EN VIAJE) */}
            {activeTab === 'transport' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col flex-1 overflow-hidden min-h-[600px] mt-4">
                    <TransportView areaFilter="TODOS" mode="transport" originArea="LOGISTICA_ENCOMIENDAS" />
                </div>
            )}
        </div>
    );
};

export default EntregaPedidosView;

