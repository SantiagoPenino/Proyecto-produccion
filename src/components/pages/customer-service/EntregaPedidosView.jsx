import React, { useState, useEffect, useRef, useCallback } from 'react';
import TransportView from '../../logistics/TransportView';
import { useAuth } from '../../../context/AuthContext';
import api from '../../../services/api';
import { logisticsService } from '../../../services/modules/logisticsService';
import { socket } from '../../../services/socketService';
import useRecargaConFreno from '../../../hooks/useRecargaConFreno';
import { Package, Truck, Search, QrCode, FileText, CheckCircle, RefreshCcw, DollarSign, ChevronDown, ChevronRight, Printer, ClipboardList, Tag, History, ChevronUp, FileImage, Store, Loader2, X, Check, Hourglass, Upload } from 'lucide-react';
import { toast } from 'sonner';
import Swal from 'sweetalert2';
import AlertaAutorizacionModal from '../../modals/AlertaAutorizacionModal';
import Selector from '../../ui/Selector';
import SelectorFecha from '../../ui/SelectorFecha';

// Estética nueva (22/10/2026, como Reportes y Cotización): fondo claro, tarjetas blancas con borde, íconos de Lucide
// en brand-cyan sin fondo, pestañas con la elegida en negro (en el celular, un selector) y los selects / la fecha con
// el Selector y el SelectorFecha propios. El color queda para el estado de pago. Lo que se imprime (comprobante,
// etiquetas, hoja de despacho) no se tocó.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
// Versiones chicas para los renglones de las tablas.
const BTN_FILA_PRINCIPAL = 'inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-brand-cyan text-white text-xs font-bold whitespace-nowrap hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_FILA_SECUNDARIO = 'inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 whitespace-nowrap hover:bg-zinc-50 transition-colors disabled:opacity-50';
const BTN_ICONO_BASE = 'w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white hover:bg-zinc-50 hover:border-zinc-300 transition-colors disabled:opacity-40';
const BTN_ICONO = `${BTN_ICONO_BASE} text-zinc-500 hover:text-brand-cyan`;
const BTN_ICONO_PRINCIPAL = 'w-8 h-8 shrink-0 inline-flex items-center justify-center rounded-lg bg-brand-cyan text-white hover:bg-brand-cyan/90 transition-colors disabled:opacity-40';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CAMPO_SIMPLE = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CHIP = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';
const CHIP_GRIS = 'bg-zinc-100 text-zinc-600 border-zinc-200';
// Estado de pago del retiro: pagado (verde), autorizado sin pagar (brand-cyan), pendiente de pago (ámbar).
const PAGO_PAGADO = 'bg-emerald-50 text-emerald-700 border-emerald-200';
const PAGO_AUTORIZADO = 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20';
const PAGO_PENDIENTE = 'bg-amber-50 text-amber-700 border-amber-200';
// El tipo de cliente (COMUN, SEMANAL…) no es un estado: va en gris; solo DEUDOR, en rojo suave.
const chipTipoCliente = (desc) => (/deudor/i.test(desc || '') ? 'bg-rose-50 text-rose-700 border-rose-200' : CHIP_GRIS);

const PESTANAS = [
    { id: 'encomiendas', label: 'Logística y Despachos', icono: Package },
    { id: 'mostrador', label: 'Mostrador', icono: Store },
    { id: 'historial', label: 'Historial del día', icono: History },
    { id: 'transport', label: 'En Viaje', icono: Truck },
];

// ─── TICKET: Comprobante de Retiro (igual a WebRetirosPage) ───
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

// ─── LABEL: Shared label HTML generator ───
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
            <div class="rem-dir">Inca 2228</div>
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
    // Comprobante de una encomienda ya entregada sin foto (29/10/2026, caso RW-35433)
    const [subiendoComprobante, setSubiendoComprobante] = useState(null); // ordenDeRetiro en curso
    const comprobanteInputRef = useRef(null);
    const comprobanteDestinoRef = useRef(null);

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
    // Mostrador: «Órdenes sin retiro asignado» de a 50 (eran ~700 filas dibujadas de una). Cuando el final de la
    // lista se acerca a la pantalla se agregan 50 más; vuelve a 50 al cambiar la lista o la búsqueda.
    const [verSinRetiro, setVerSinRetiro] = useState(50);
    useEffect(() => { setVerSinRetiro(50); }, [mostradorAllSinRetiro, searchTerm]);
    const obsSinRetiro = useRef(null);
    const centinelaSinRetiro = useCallback((nodo) => {
        if (obsSinRetiro.current) obsSinRetiro.current.disconnect();
        if (!nodo) return;
        obsSinRetiro.current = new IntersectionObserver(([e]) => { if (e.isIntersecting) setVerSinRetiro(v => v + 50); },
            { rootMargin: '0px 0px 600px 0px' });
        obsSinRetiro.current.observe(nodo);
    }, []);
    // Recargas por aviso del socket, con freno (la lista de despachos usa la consulta cara de retiros).
    const avisarDespachos = useRecargaConFreno(() => loadDespachoRef.current?.());
    const avisarSinRetiro = useRecargaConFreno(() => loadSinRetiroRef.current?.());

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
                // Alguien creó un retiro → refrescar sinRetiro
                avisarSinRetiro();
            } else if (tipo === 'pago_web' || tipo === 'estado' || tipo === '') {
                // Refrescar encomiendas
                avisarDespachos();
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
            // Estados (tabla EstadosOrdenesRetiro): 1 Ingresado, 2 Pasar por caja, 3 Abonado, 4 Abonado de antemano,
            // 5 Entregado, 6 Cancelado, 7 Empaquetado sin abonar, 8 Empaquetado y abonado, 9 Autorizado, 10 En viaje
            const res = await api.get(`/apiordenesRetiro/estados?estados=1,2,3,4,5,6,7,8,9,10&date=${filtroFechaHistorial}`);

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

    // Encomienda entregada sin comprobante (se tocó «Entregar» sin Generar Remito, o se confirmó en
    // En Viaje sin foto): la foto se guarda sin cambiar el estado ni la fecha de entrega.
    const elegirComprobante = (enc) => {
        comprobanteDestinoRef.current = enc.ordenDeRetiro;
        comprobanteInputRef.current?.click();
    };

    const subirComprobanteElegido = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = null;
        const codigo = comprobanteDestinoRef.current;
        comprobanteDestinoRef.current = null;
        if (!file || !codigo) return;
        setSubiendoComprobante(codigo);
        try {
            await logisticsService.subirComprobanteEncomienda(codigo, file);
            toast.success(`Comprobante de ${codigo} guardado`);
            loadHistorialHoy();
        } catch (err) {
            toast.error(err.response?.data?.error || 'No se pudo subir el comprobante');
        } finally {
            setSubiendoComprobante(null);
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
                url = `/apiordenesRetiro/estados?estados=1,2,3,4,7,8,9${pagas ? '&pagas=true' : ''}${nopagas ? '&no_pagas=true' : ''}`;
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
                showConfirmButton: false, timer: 4000, confirmButtonColor: '#006E97',
                showClass: { popup: 'animate-[slideInRight_0.3s_ease-out]' },
                hideClass: { popup: 'animate-[slideOutRight_0.3s_ease-in]' }
            });
            return;
        }

        // Todas pagas o autorizadas → entregar directamente
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
                showConfirmButton: false, timer: 3000, confirmButtonColor: '#006E97',
                showClass: { popup: 'animate-[slideInRight_0.3s_ease-out]' },
                hideClass: { popup: 'animate-[slideOutRight_0.3s_ease-in]' }
            });
            loadDespachos();
        } catch (error) {
            const errorMsg = error.response?.data?.error || 'Error al procesar la entrega.';
            Swal.fire({ title: 'Error', html: errorMsg, icon: 'error', confirmButtonColor: '#006E97' });
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
                    toast: true, position: 'top-end', icon: 'warning', title: `"${ordenCodigo}" no está paga ni autorizada. Debe pasar por Caja.`, showConfirmButton: false, timer: 4000, confirmButtonColor: '#006E97',
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
            // Todas en USD → mostrar en USD directamente
            monedaInicial = 'USD';
            total = ordenes.reduce((a, o) => a + parseFloat(o.costo || o.OrdCostoFinal || 0), 0);
        } else if (todasUYU) {
            // Todas en UYU → mostrar en UYU directamente
            monedaInicial = 'UYU';
            total = ordenes.reduce((a, o) => a + parseFloat(o.costo || o.OrdCostoFinal || 0), 0);
        } else {
            // Mixto → convertir todo a UYU
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
            toast.success('Pago registrado correctamente');
            setPagoModal(null);
            // Refrescar la sección correcta según el origen del pago
            if (searchTerm.trim()) {
                buscarMostrador();           // venía del buscador → actualizar resultados
            } else {
                loadTodasSinRetiro(filtroLugarMostrador); // venía de "Sin Retiro" → actualizar esa lista
            }

        } catch (err) {
            console.error('[PAGO MOSTRADOR] Error:', err.response?.data || err.message);
            toast.error(err.response?.data?.error || 'Error al registrar el pago.');
        } finally {
            setPagandoLoading(false);
        }
    };


    return (
        <div className="p-3 md:p-6 w-full min-h-full bg-slate-50 text-zinc-800 flex flex-col gap-4">
            {/* Cabecera y pestañas */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    <Package size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight">Entrega de Pedidos & Logística</h1>
                        <p className="text-sm text-zinc-400">Gestión integral de despachos, retiros y cobranza remota.</p>
                    </div>
                </div>

                {/* Escritorio: pestañas */}
                <div className="hidden sm:inline-flex flex-wrap items-center gap-0.5 p-0.5 rounded-xl border border-zinc-200 bg-white">
                    {PESTANAS.map(tab => {
                        const Icono = tab.icono;
                        const activa = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => setActiveTab(tab.id)}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${activa ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800'}`}
                            >
                                <Icono size={15} className={activa ? '' : 'text-brand-cyan'} />
                                {tab.label}
                            </button>
                        );
                    })}
                </div>

                {/* Celular: selector */}
                <div className="w-full sm:hidden">
                    <Selector value={activeTab} onChange={e => setActiveTab(e.target.value)} aria-label="Sección" className="font-semibold">
                        {PESTANAS.map(tab => (
                            <option key={tab.id} value={tab.id}>
                                <span className="flex items-center gap-2"><tab.icono size={15} className="shrink-0 text-brand-cyan" />{tab.label}</span>
                            </option>
                        ))}
                    </Selector>
                </div>
            </div>

            {/* TAB: ENCOMIENDAS (DESPACHOS) */}
            {activeTab === 'encomiendas' && (
                <div className="flex flex-col gap-3">
                    <div className={`${CARD} p-4 md:p-5 flex flex-col gap-3`}>
                        <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3">
                            <div className="min-w-0">
                                <h2 className="text-lg font-black text-zinc-800">Órdenes a Despachar / Entregar</h2>
                                <p className="text-sm text-zinc-400">{loading ? 'Cargando…' : `${encomiendas.length} orden(es) de retiro`}</p>
                            </div>

                            {/* Filtros Especiales */}
                            <div className="flex flex-wrap gap-2 items-center w-full xl:w-auto">
                                <span className="text-[11px] font-black text-zinc-400 uppercase tracking-wide">Lugar de Retiro</span>
                                <Selector
                                    filtro
                                    aria-label="Lugar de retiro"
                                    value={filtroLugar}
                                    onChange={(e) => setFiltroLugar(e.target.value)}
                                >
                                    <option value="">— Todas —</option>
                                    {lugaresRetiro.map(lr => (
                                        <option key={lr.LReIdLugarRetiro} value={lr.LReIdLugarRetiro}>{lr.LReNombreLugar}</option>
                                    ))}
                                    {lugaresRetiro.length === 0 && <option value="" disabled>Cargando...</option>}
                                </Selector>

                                <Selector
                                    filtro
                                    aria-label="Filtrar por pago"
                                    value={filtroPagoEncomiendas}
                                    onChange={(e) => setFiltroPagoEncomiendas(e.target.value)}
                                >
                                    <option value="todas"><span className="flex items-center gap-2"><CheckCircle size={14} className="shrink-0 text-brand-cyan" />Mostrar Todas</span></option>
                                    <option value="pagas"><span className="flex items-center gap-2"><DollarSign size={14} className="shrink-0 text-brand-cyan" />Sólo Pagas</span></option>
                                    <option value="nopagas"><span className="flex items-center gap-2"><Hourglass size={14} className="shrink-0 text-brand-cyan" />No Pagas</span></option>
                                </Selector>

                                <button
                                    onClick={() => loadDespachos(filtroLugar, filtroPagoEncomiendas)}
                                    disabled={loading}
                                    className={BTN_SECUNDARIO}
                                >
                                    <Search size={15} />
                                    {loading ? 'Buscando...' : 'Buscar'}
                                </button>

                                <button onClick={() => loadDespachos(filtroLugar, filtroPagoEncomiendas)} disabled={loading} className={BTN_SECUNDARIO} title="Recargar" aria-label="Recargar">
                                    <RefreshCcw size={15} className={loading ? 'animate-spin' : ''} />
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col lg:flex-row lg:items-center gap-2">
                            {/* Buscador rápido dentro de Logística */}
                            <div className="relative flex-1 min-w-0">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={15} />
                                <input
                                    type="text"
                                    placeholder="Filtrar por orden, cliente o estado..."
                                    aria-label="Filtrar por orden, cliente o estado"
                                    value={filtroLogistica}
                                    onChange={e => setFiltroLogistica(e.target.value)}
                                    className={CAMPO}
                                />
                            </div>

                            {/* Acciones sobre los seleccionados */}
                            <div className="flex flex-wrap items-center gap-2">
                                <button
                                    onClick={generarRemitoLogistico}
                                    disabled={selectedEncomiendas.size === 0 || loading}
                                    className={BTN_SECUNDARIO}
                                    title="Generar Remito Logístico"
                                >
                                    <Package size={15} /> Generar Remito ({selectedEncomiendas.size})
                                </button>
                                <button
                                    onClick={() => printResumenSeleccionados() /* sin el evento: si no, el clic entraba como remitoCode y la hoja salía con un QR de "[object Object]" */}
                                    disabled={selectedEncomiendas.size === 0}
                                    className={BTN_SECUNDARIO}
                                    title="Imprimir hoja de despacho"
                                >
                                    <FileText size={15} /> Despacho ({selectedEncomiendas.size})
                                </button>
                                <button
                                    onClick={() => {
                                        const sel = encomiendas.filter(e => selectedEncomiendas.has(e.ordenDeRetiro));
                                        if (sel.length === 0) return toast.warning('Seleccioná al menos una orden.');
                                        printLabels(sel);
                                    }}
                                    disabled={selectedEncomiendas.size === 0}
                                    className={BTN_SECUNDARIO}
                                    title="Imprimir etiquetas de los seleccionados"
                                >
                                    <Tag size={15} /> Etiquetas ({selectedEncomiendas.size})
                                </button>
                                <button
                                    onClick={marcarEntregadas}
                                    disabled={selectedEncomiendas.size === 0 || loading}
                                    className={BTN_PRINCIPAL}
                                >
                                    <CheckCircle size={15} /> {loading ? <Loader2 className="animate-spin" size={15} /> : `Entregar (${selectedEncomiendas.size})`}
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* ── MOBILE: Card list ── */}
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
                                    className={`rounded-2xl border overflow-hidden transition-colors ${isSelected ? 'border-brand-cyan bg-brand-cyan/5 ring-1 ring-brand-cyan/20' : 'border-zinc-200 bg-white'}`}>

                                    {/* Card header row */}
                                    <div className="flex items-center gap-3 p-3">
                                        <input
                                            type="checkbox"
                                            className="w-5 h-5 rounded accent-brand-cyan shrink-0"
                                            checked={isSelected}
                                            onChange={() => toggleCheckEncomienda(enc.ordenDeRetiro)}
                                        />
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="font-black text-zinc-800 text-sm">{enc.ordenDeRetiro}</span>
                                                {pagado
                                                    ? <span className={`${CHIP} ${PAGO_PAGADO} uppercase`}>Pagado</span>
                                                    : autorizado
                                                        ? <span className={`${CHIP} ${PAGO_AUTORIZADO} uppercase`}>Autorizado</span>
                                                        : <span className={`${CHIP} ${PAGO_PENDIENTE} uppercase`}>Pendiente</span>
                                                }
                                                <span className={`${CHIP} ${CHIP_GRIS} uppercase`}>{enc.estado}</span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1">
                                                <span className="text-xs font-bold text-zinc-600 truncate">{enc.CliCodigoCliente} · {enc.TClDescripcion}</span>
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            <div className="font-black text-zinc-800 text-sm tabular-nums">{moneda} {enc.totalCost}</div>
                                            <div className="text-[11px] text-zinc-400 flex items-center gap-1 justify-end"><Truck size={11} className="shrink-0 text-brand-cyan" /> {enc.lugarRetiro}</div>
                                        </div>
                                    </div>

                                    {/* Actions row */}
                                    <div className="flex border-t border-zinc-100 divide-x divide-zinc-100">
                                        <button
                                            onClick={() => toggleRow(enc.ordenDeRetiro)}
                                            className="flex-1 py-2.5 text-xs font-bold text-zinc-600 flex items-center justify-center gap-1.5 hover:bg-zinc-50 transition-colors"
                                        >
                                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                            {enc.orders?.length || 0} hijas
                                        </button>
                                        <button
                                            onClick={() => printLabels(enc)}
                                            className="flex-1 py-2.5 text-xs font-bold text-zinc-600 flex items-center justify-center gap-1.5 hover:bg-zinc-50 transition-colors"
                                        >
                                            <Tag size={13} /> Etiqueta
                                        </button>
                                        <button
                                            onClick={() => printTicketEncomienda(enc)}
                                            className="flex-1 py-2.5 text-xs font-bold text-zinc-600 flex items-center justify-center gap-1.5 hover:bg-zinc-50 transition-colors"
                                        >
                                            <Printer size={13} /> Ticket
                                        </button>
                                        <button
                                            onClick={() => ejecutarEntregarUna(enc.ordenDeRetiro, enc)}
                                            disabled={loading}
                                            className="flex-1 py-2.5 text-xs font-black text-brand-cyan flex items-center justify-center gap-1.5 hover:bg-brand-cyan/5 transition-colors disabled:opacity-40"
                                        >
                                            <CheckCircle size={13} /> Entregar
                                        </button>
                                    </div>

                                    {/* Expanded sub-orders */}
                                    {isExpanded && (
                                        <div className="border-t border-zinc-100 bg-zinc-50 divide-y divide-zinc-100">
                                            {enc.orders?.map(o => (
                                                <div key={o.orderNumber} className="flex items-center justify-between gap-2 px-4 py-2">
                                                    <span className="font-bold text-zinc-700 text-xs">{o.orderNumber}</span>
                                                    <span className="text-xs text-zinc-400">{o.orderEstado || '—'}</span>
                                                    <span className="font-black text-zinc-800 text-xs tabular-nums">{o.orderCosto}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}

                        {!loading && encomiendas.length === 0 && (
                            <div className={`${CARD} py-12 px-4 text-center`}>
                                <Truck size={40} className="mx-auto mb-3 text-zinc-200" />
                                <p className="font-bold text-zinc-500">No hay órdenes para despachar</p>
                                <p className="text-sm text-zinc-400">bajo los filtros seleccionados.</p>
                            </div>
                        )}
                        {loading && encomiendas.length === 0 && (
                            <div className={`${CARD} py-10 px-4 text-center`}>
                                <Loader2 className="animate-spin mx-auto mb-3 text-brand-cyan" size={30} />
                                <p className="text-sm text-zinc-400">Cargando...</p>
                            </div>
                        )}
                    </div>

                    {/* ── DESKTOP: Table ── */}
                    <div className={`hidden md:block ${CARD} overflow-hidden`}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-zinc-50 border-b border-zinc-200">
                                    <tr className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                        <th className="px-4 py-2.5 w-10 text-center">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 rounded border-zinc-300 accent-brand-cyan cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                                checked={selectedEncomiendas.size === encomiendas.length && encomiendas.length > 0}
                                                onChange={toggleAllEncomiendas}
                                                disabled={!lugaresRetiro.some(lr => String(lr.LReIdLugarRetiro) === filtroLugar && /encomienda|agencia/i.test(lr.LReNombreLugar))}
                                            />
                                        </th>
                                        <th className="px-4 py-2.5">Orden Retiro</th>
                                        <th className="px-4 py-2.5">Cliente</th>
                                        <th className="px-4 py-2.5">Total Importe</th>
                                        <th className="px-4 py-2.5">Estado / Lugar</th>
                                        <th className="px-4 py-2.5 text-center">Pago</th>
                                        <th className="px-4 py-2.5 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
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

                                        return (
                                            <React.Fragment key={enc.ordenDeRetiro}>
                                                <tr className={`transition-colors ${isSelected ? 'bg-brand-cyan/5' : 'hover:bg-zinc-50'}`}>
                                                    <td className="px-4 py-3 text-center">
                                                        <input type="checkbox" className="w-4 h-4 rounded border-zinc-300 accent-brand-cyan cursor-pointer" checked={isSelected} onChange={() => toggleCheckEncomienda(enc.ordenDeRetiro)} />
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <button onClick={() => toggleRow(enc.ordenDeRetiro)} className="flex items-center gap-1.5 font-black text-zinc-800 hover:text-brand-cyan transition-colors">
                                                            {isExpanded ? <ChevronDown size={16} className="text-brand-cyan" /> : <ChevronRight size={16} className="text-zinc-400" />}
                                                            {enc.ordenDeRetiro}
                                                        </button>
                                                        <div className="flex items-center gap-2 ml-[22px] mt-1">
                                                            <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wide">{enc.orders?.length || 0} HIJAS</span>
                                                            <button onClick={(e) => { e.stopPropagation(); printTicketEncomienda(enc); }} title="Imprimir ticket" aria-label="Imprimir ticket" className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-brand-cyan hover:bg-zinc-100 rounded-md transition-colors">
                                                                <Printer size={13} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="font-bold text-zinc-800 block leading-tight mb-1">{enc.CliCodigoCliente}</span>
                                                        <span className={`${CHIP} uppercase ${chipTipoCliente(enc.TClDescripcion)}`}>{enc.TClDescripcion}</span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className="font-black text-zinc-800 text-base tabular-nums whitespace-nowrap">{enc.orders?.[0]?.monedaId === 2 ? 'US$' : '$'} {enc.totalCost}</span>
                                                    </td>
                                                    <td className="px-4 py-3">
                                                        <span className={`${CHIP} ${CHIP_GRIS} uppercase inline-block mb-1`}>{enc.estado}</span>
                                                        <span className="text-xs font-bold text-zinc-500 flex items-center gap-1"><Truck size={12} className="shrink-0 text-brand-cyan" /> {enc.lugarRetiro}</span>
                                                    </td>
                                                    <td className="px-4 py-3 text-center">
                                                        {enc.pagorealizado === 1
                                                            ? <span className={`${CHIP} ${PAGO_PAGADO}`}>PAGADO</span>
                                                            : enc.OReEstadoActual === 9
                                                                ? <span className={`${CHIP} ${PAGO_AUTORIZADO}`}>AUTORIZADO</span>
                                                                : <span className={`${CHIP} ${PAGO_PENDIENTE}`}>PENDIENTE</span>
                                                        }
                                                    </td>
                                                    <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                                                        <div className="flex items-center gap-1.5 justify-center">
                                                            <button title="Imprimir etiqueta" aria-label="Imprimir etiqueta" onClick={() => printLabels(enc)} className={BTN_ICONO}><Tag size={14} /></button>
                                                            <button title="Entregar esta orden" aria-label="Entregar esta orden" onClick={() => ejecutarEntregarUna(enc.ordenDeRetiro, enc)} disabled={loading} className={BTN_ICONO_PRINCIPAL}><CheckCircle size={14} /></button>
                                                        </div>
                                                    </td>
                                                </tr>
                                                {isExpanded && (
                                                    <tr className="bg-zinc-50">
                                                        <td colSpan="7" className="p-0">
                                                            <div className="px-4 pb-4 pt-2 pl-14">
                                                                <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                                                                    <div className="px-4 py-2 bg-zinc-50 border-b border-zinc-200">
                                                                        <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">Composición de {enc.ordenDeRetiro}</span>
                                                                    </div>
                                                                    <table className="w-full text-xs text-left">
                                                                        <tbody className="divide-y divide-zinc-100">
                                                                            {enc.orders?.map(o => (
                                                                                <tr key={o.orderNumber} className="hover:bg-zinc-50">
                                                                                    <td className="px-4 py-2.5 font-bold text-zinc-700 w-32">{o.orderNumber}</td>
                                                                                    <td className="px-4 py-2.5 text-zinc-500">{o.orderEstado || '—'}</td>
                                                                                    <td className="px-4 py-2.5 font-bold text-zinc-800 text-right tabular-nums">{o.orderCosto}</td>
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
                                        <tr><td colSpan="7" className="py-16 px-4 text-center">
                                            <Truck size={40} className="mx-auto mb-3 text-zinc-200" />
                                            <p className="font-bold text-zinc-500">No hay órdenes para despachar</p>
                                            <p className="text-sm text-zinc-400">bajo los filtros seleccionados.</p>
                                        </td></tr>
                                    )}
                                    {loading && encomiendas.length === 0 && (
                                        <tr><td colSpan="7" className="py-16 px-4 text-center">
                                            <Loader2 className="animate-spin mx-auto mb-3 text-brand-cyan" size={30} />
                                            <p className="text-sm text-zinc-400">Cargando...</p>
                                        </td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                </div>
            )}

            {/* TAB: HISTORIAL DEL DÍA */}
            {activeTab === 'historial' && (
                <div className="flex flex-col gap-3">
                    <input
                        type="file"
                        ref={comprobanteInputRef}
                        className="hidden"
                        accept="image/*"
                        onChange={subirComprobanteElegido}
                    />
                    <div className={`${CARD} p-4 md:p-5 flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3`}>
                        <div className="min-w-0">
                            <h2 className="text-lg font-black text-zinc-800">Historial de fecha</h2>
                            <p className="text-sm text-zinc-400">Órdenes con movimientos en el día. Filtralas acá:</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Selector
                                filtro
                                aria-label="Lugar de retiro"
                                value={filtroLugarHistorial}
                                onChange={e => setFiltroLugarHistorial(e.target.value)}
                            >
                                <option value="todas">— Seleccionar (Todas) —</option>
                                {lugaresRetiro.map(lr => (
                                    <option key={lr.LReIdLugarRetiro} value={lr.LReIdLugarRetiro}>{lr.LReNombreLugar}</option>
                                ))}
                            </Selector>

                            <SelectorFecha
                                filtro
                                resaltar={false}
                                aria-label="Fecha"
                                value={filtroFechaHistorial}
                                onChange={e => setFiltroFechaHistorial(e.target.value)}
                            />
                            <button
                                onClick={loadHistorialHoy}
                                disabled={loadingHistorial}
                                className={BTN_SECUNDARIO}
                                title="Recargar"
                                aria-label="Recargar"
                            >
                                <RefreshCcw size={15} className={loadingHistorial ? 'animate-spin' : ''} />
                            </button>
                            <button
                                onClick={() => {
                                    const sel = historialHoy.filter(e => selectedHistorial.has(e.ordenDeRetiro));
                                    if (sel.length === 0) return toast.warning('Seleccioná al menos una encomienda.');
                                    printLabels(sel);
                                }}
                                disabled={selectedHistorial.size === 0}
                                className={BTN_SECUNDARIO}
                            >
                                <Tag size={15} /> Reimprimir etiquetas ({selectedHistorial.size})
                            </button>
                        </div>
                    </div>

                    <div className={`${CARD} overflow-hidden`}>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left text-sm">
                                <thead className="bg-zinc-50 border-b border-zinc-200">
                                    <tr className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                        <th className="px-4 py-2.5 w-10 text-center">
                                            <input
                                                type="checkbox"
                                                className="w-4 h-4 rounded border-zinc-300 accent-brand-cyan cursor-pointer"
                                                checked={selectedHistorial.size === historialHoy.length && historialHoy.length > 0}
                                                onChange={() => {
                                                    if (selectedHistorial.size === historialHoy.length) setSelectedHistorial(new Set());
                                                    else setSelectedHistorial(new Set(historialHoy.map(e => e.ordenDeRetiro)));
                                                }}
                                            />
                                        </th>
                                        <th className="px-4 py-2.5">Retiro</th>
                                        <th className="px-4 py-2.5">Cliente</th>
                                        <th className="px-4 py-2.5">Receptor</th>
                                        <th className="px-4 py-2.5">Destino</th>
                                        <th className="px-4 py-2.5">Agencia</th>
                                        <th className="px-4 py-2.5 text-center">Pago</th>
                                        <th className="px-4 py-2.5 text-center">Acciones</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-zinc-100">
                                    {historialHoy.map(enc => (
                                        <tr key={enc.ordenDeRetiro} className={`transition-colors ${selectedHistorial.has(enc.ordenDeRetiro) ? 'bg-brand-cyan/5' : 'hover:bg-zinc-50'}`}>
                                            <td className="px-4 py-3 text-center">
                                                <input
                                                    type="checkbox"
                                                    className="w-4 h-4 rounded border-zinc-300 accent-brand-cyan cursor-pointer"
                                                    checked={selectedHistorial.has(enc.ordenDeRetiro)}
                                                    onChange={() => {
                                                        const s = new Set(selectedHistorial);
                                                        s.has(enc.ordenDeRetiro) ? s.delete(enc.ordenDeRetiro) : s.add(enc.ordenDeRetiro);
                                                        setSelectedHistorial(s);
                                                    }}
                                                />
                                            </td>
                                            <td className="px-4 py-3 font-black text-zinc-800 whitespace-nowrap">{enc.ordenDeRetiro}</td>
                                            <td className="px-4 py-3">
                                                <span className="font-bold text-zinc-700">{enc.CliNombre || enc.CliCodigoCliente || '-'}</span>
                                                <span className={`ml-2 ${CHIP} uppercase ${chipTipoCliente(enc.TClDescripcion)}`}>{enc.TClDescripcion}</span>
                                            </td>
                                            <td className="px-4 py-3">
                                                <span className="font-bold text-zinc-700">{enc.receptorNombre || '\u2014'}</span>
                                            </td>
                                            <td className="px-4 py-3 text-zinc-500 text-xs">
                                                {[enc.localidadEnvio, enc.departamentoEnvio].filter(Boolean).join(' \u2022 ') || '\u2014'}
                                            </td>
                                            <td className="px-4 py-3 font-bold text-zinc-600 text-xs">{enc.agenciaNombre || '\u2014'}</td>
                                            <td className="px-4 py-3 text-center">
                                                {enc.pagorealizado === 1
                                                    ? <span className={`${CHIP} ${PAGO_PAGADO}`}>PAGADO</span>
                                                    : <span className={`${CHIP} ${PAGO_PENDIENTE}`}>PENDIENTE</span>
                                                }
                                            </td>
                                            <td className="px-4 py-3 text-center">
                                                <div className="flex items-center gap-1.5 justify-center">
                                                    {enc.comprobanteEntrega && (
                                                        <a
                                                            href={import.meta.env.VITE_COMPROBANTES_ENCOMIENDAS_PATH ? `${import.meta.env.VITE_COMPROBANTES_ENCOMIENDAS_PATH}/${enc.comprobanteEntrega.split('/').pop()}` : `${import.meta.env.VITE_API_URL ? import.meta.env.VITE_API_URL.replace('/api', '') : ''}${enc.comprobanteEntrega}`}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            title="Ver comprobante"
                                                            aria-label="Ver comprobante"
                                                            className={`${BTN_ICONO_BASE} text-brand-cyan`}
                                                        >
                                                            <FileImage size={14} />
                                                        </a>
                                                    )}
                                                    {!enc.comprobanteEntrega && enc.OReEstadoActual === 5 && String(enc.formaEnvioId) === '2' && (
                                                        <button
                                                            title="Subir comprobante de la agencia"
                                                            aria-label="Subir comprobante de la agencia"
                                                            onClick={() => elegirComprobante(enc)}
                                                            disabled={subiendoComprobante !== null}
                                                            className={BTN_ICONO}
                                                        >
                                                            {subiendoComprobante === enc.ordenDeRetiro
                                                                ? <Loader2 size={14} className="animate-spin" />
                                                                : <Upload size={14} />}
                                                        </button>
                                                    )}
                                                    <button
                                                        title="Reimprimir etiqueta"
                                                        aria-label="Reimprimir etiqueta"
                                                        onClick={() => printLabels(enc)}
                                                        className={BTN_ICONO}
                                                    >
                                                        <Tag size={14} />
                                                    </button>
                                                    <button
                                                        title="Reimprimir ticket"
                                                        aria-label="Reimprimir ticket"
                                                        onClick={() => printTicketEncomienda(enc)}
                                                        className={BTN_ICONO}
                                                    >
                                                        <Printer size={14} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}

                                    {!loadingHistorial && historialHoy.length === 0 && (
                                        <tr>
                                            <td colSpan="8" className="py-16 px-4 text-center">
                                                <Package size={40} className="mx-auto mb-3 text-zinc-200" />
                                                <p className="font-bold text-zinc-500">Sin entregas hoy</p>
                                                <p className="text-sm text-zinc-400">Las encomiendas entregadas aparecerán aquí.</p>
                                            </td>
                                        </tr>
                                    )}

                                    {loadingHistorial && (
                                        <tr>
                                            <td colSpan="8" className="py-16 px-4 text-center">
                                                <Loader2 className="animate-spin mx-auto mb-3 text-brand-cyan" size={30} />
                                                <p className="text-sm text-zinc-400">Cargando...</p>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* TAB MOSTRADOR — Lista completa + filtro + búsqueda puntual */}
            {
                activeTab === 'mostrador' && (
                    <div className="flex flex-col gap-3">

                        {/* ── Buscador Puntual (arriba) ── */}
                        <div className={`${CARD} p-4 md:p-5 flex flex-wrap gap-3 items-end`}>
                            <div className="flex-1 min-w-[240px]">
                                <label className="block text-[11px] font-black text-zinc-400 uppercase tracking-wide mb-1.5">Buscar orden de retiro, depósito o cliente específico</label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        placeholder="Ej: R-60653  |  DF-85423  |  MACROSOFT"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        className={CAMPO}
                                        onKeyDown={(e) => e.key === 'Enter' && buscarMostrador()}
                                    />
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" size={15} />
                                </div>
                            </div>
                            <button
                                onClick={() => {
                                    // El filtro es en memoria, el botón solo refresca el foco
                                    if (!searchTerm.trim()) toast.warning('Ingresá un criterio de búsqueda.');
                                }}
                                disabled={false}
                                className={`${BTN_PRINCIPAL} h-[42px]`}
                            >
                                <Search size={15} />
                                Buscar Expediente
                            </button>
                        </div>

                        {/* ── Todas las Órdenes Sin Retiro (debajo del buscador) ── */}
                        <div className={`${CARD} overflow-hidden`}>
                            <div className="px-4 md:px-5 py-3 border-b border-zinc-100 flex flex-wrap justify-between items-center gap-3">
                                <div className="min-w-0">
                                    <h3 className="text-sm font-black text-zinc-800">Órdenes sin Retiro Asignado</h3>
                                    <p className="text-xs text-zinc-400">
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
                                    </p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                    {/* Filtro por Lugar */}
                                    <Selector
                                        filtro
                                        aria-label="Filtrar por lugar de retiro"
                                        value={filtroLugarMostrador}
                                        onChange={e => {
                                            const v = e.target.value;
                                            setFiltroLugarMostrador(v);
                                            loadTodasSinRetiro(v);
                                            setSelectedSinRetiro(new Set());
                                        }}
                                    >
                                        <option value="">— Todos los lugares —</option>
                                        {lugaresRetiro.map(l => (
                                            <option key={l.LReIdLugarRetiro} value={l.LReIdLugarRetiro}>{l.LReNombreLugar}</option>
                                        ))}
                                    </Selector>
                                    <button
                                        onClick={() => loadTodasSinRetiro(filtroLugarMostrador)}
                                        className={BTN_SECUNDARIO}
                                    >
                                        <RefreshCcw size={15} className={loadingMostradorAll ? 'animate-spin' : ''} /> Actualizar
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
                                            <div className="flex flex-wrap items-center gap-2 px-4 md:px-5 py-2.5 bg-brand-cyan/5 border-b border-zinc-100">
                                                <span className="text-xs font-bold text-brand-cyan">{selectedArr.length} seleccionadas</span>
                                                <button
                                                    onClick={() => {
                                                        const items = selectedArr.map(o => ({ ...o, codigo: o.OrdCodigoOrden, costo: o.OrdCostoFinal, simbolo: o.MonSimbolo }));
                                                        abrirModalPago(items, null, selectedArr[0]);
                                                    }}
                                                    className={BTN_FILA_PRINCIPAL}
                                                >
                                                    <DollarSign size={13} /> Pagar ({selectedArr.length})
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setRetiroModal({ ordenes: selectedArr });
                                                        setRetiroLugar(String(lugaresRetiro[0]?.LReIdLugarRetiro || ''));
                                                        setRetiroEnvio({ direccion: '', departamentoId: '', localidadId: '', agenciaId: '' });
                                                        setClienteEnvioDatos(null);
                                                        if (selectedArr[0]?.CliIdClienteFK) cargarEnvioCliente(selectedArr[0].CliIdClienteFK);
                                                    }}
                                                    className={BTN_FILA_SECUNDARIO}
                                                >
                                                    <ClipboardList size={13} /> Generar Retiro ({selectedArr.length})
                                                </button>
                                            </div>
                                        )}
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead className="bg-zinc-50 border-b border-zinc-200">
                                                    <tr className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                                        <th className="px-4 py-2.5 w-10">
                                                            <input type="checkbox" checked={allChecked}
                                                                onChange={e => {
                                                                    if (e.target.checked) setSelectedSinRetiro(new Set(filteredSinRetiro.map(o => o.OrdIdOrden)));
                                                                    else setSelectedSinRetiro(new Set());
                                                                }}
                                                                className="w-4 h-4 rounded accent-brand-cyan cursor-pointer"
                                                            />
                                                        </th>
                                                        <th className="px-3 py-2.5 text-left">Código</th>
                                                        <th className="px-3 py-2.5 text-left">Cliente</th>
                                                        <th className="px-3 py-2.5 text-left">Lugar Retiro</th>
                                                        <th className="px-3 py-2.5 text-left">Estado</th>
                                                        <th className="px-3 py-2.5 text-right">Importe</th>
                                                        <th className="px-4 py-2.5 text-center">Acción</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100">
                                                    {filteredSinRetiro.slice(0, verSinRetiro).map(o => {
                                                        const isSel = selectedSinRetiro.has(o.OrdIdOrden);
                                                        return (
                                                            <tr key={o.OrdIdOrden}
                                                                className={`cursor-pointer transition-colors ${isSel ? 'bg-brand-cyan/5' : o.Pagada ? 'bg-emerald-50/40 hover:bg-emerald-50' : 'hover:bg-zinc-50'}`}
                                                                onClick={() => setSelectedSinRetiro(prev => { const s = new Set(prev); if (s.has(o.OrdIdOrden)) s.delete(o.OrdIdOrden); else s.add(o.OrdIdOrden); return s; })}
                                                            >
                                                                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                                                    <input type="checkbox" checked={isSel}
                                                                        onChange={() => setSelectedSinRetiro(prev => { const s = new Set(prev); if (s.has(o.OrdIdOrden)) s.delete(o.OrdIdOrden); else s.add(o.OrdIdOrden); return s; })}
                                                                        className="w-4 h-4 rounded accent-brand-cyan cursor-pointer"
                                                                    />
                                                                </td>
                                                                <td className="px-3 py-3 font-bold text-zinc-800 whitespace-nowrap">
                                                                    {o.OrdCodigoOrden}
                                                                    {o.Pagada ? <span className={`ml-2 ${CHIP} ${PAGO_PAGADO} inline-flex items-center gap-1 align-middle`}><Check size={11} /> Paga</span> : null}
                                                                </td>
                                                                <td className="px-3 py-3 text-zinc-600">
                                                                    <div className="font-bold text-zinc-700">{o.CliNombre || o.CliCodigo}</div>
                                                                    <div className="text-[11px] text-zinc-400">{o.TClDescripcion}</div>
                                                                </td>
                                                                <td className="px-3 py-3">
                                                                    {o.LugarRetiroNombre
                                                                        ? <span className={`${CHIP} bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20 whitespace-nowrap`}>{o.LugarRetiroNombre}</span>
                                                                        : <span className="text-zinc-400 text-xs italic">Sin lugar</span>}
                                                                </td>
                                                                <td className="px-3 py-3 font-bold text-zinc-700 text-xs">{o.OrdNombreTrabajo || o.estadoOrden || '-'}</td>
                                                                <td className="px-3 py-3 text-right font-black text-zinc-800 tabular-nums whitespace-nowrap">{o.MonSimbolo} {parseFloat(o.OrdCostoFinal || 0).toFixed(2)}</td>
                                                                <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                                                    <div className="flex items-center gap-2 justify-center">
                                                                        {!o.Pagada && (
                                                                            <button
                                                                                onClick={() => abrirModalPago([{ ...o, codigo: o.OrdCodigoOrden, costo: o.OrdCostoFinal, simbolo: o.MonSimbolo }], null, o)}
                                                                                className={BTN_FILA_PRINCIPAL}
                                                                            >
                                                                                <DollarSign size={13} /> Pagar
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
                                                                            className={BTN_FILA_SECUNDARIO}
                                                                        >
                                                                            <ClipboardList size={13} /> Retiro
                                                                        </button>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                    {filteredSinRetiro.length > verSinRetiro && (
                                                        <tr ref={centinelaSinRetiro}>
                                                            <td colSpan={7} className="px-4 py-3 text-center text-xs text-zinc-400">
                                                                Mostrando {verSinRetiro} de {filteredSinRetiro.length}…
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </>
                                );
                            })() : (
                                <div className="py-16 px-4 text-center">
                                    {loadingMostradorAll
                                        ? <Loader2 className="animate-spin mx-auto mb-3 text-brand-cyan" size={30} />
                                        : <><Package size={40} className="mx-auto mb-3 text-zinc-200" /><p className="text-zinc-400">No hay órdenes sin retiro{filtroLugarMostrador ? ' para este lugar' : ''}</p></>}
                                </div>
                            )}
                        </div>

                        {/* Resultados de búsqueda puntual */}
                        {mostradorData && (
                            <div className="flex flex-col gap-3">
                                {/* Retiros con órdenes sin pagar */}
                                {mostradorData.retiros.map(ret => (
                                    <div key={ret.OReIdOrdenRetiro} className={`${CARD} overflow-hidden`}>
                                        <div className="px-4 md:px-5 py-3 border-b border-zinc-100 flex flex-wrap justify-between items-center gap-3">
                                            <div className="min-w-0">
                                                <h3 className="text-sm font-black text-zinc-800 tracking-wide">{ret.etiqueta}</h3>
                                                <p className="text-xs text-zinc-400">{ret.estadoRetiro} · {ret.lugarRetiro}</p>
                                            </div>
                                            <div className="text-right min-w-0">
                                                <div className="text-sm font-bold text-zinc-700">{ret.CliNombre || ret.CliCodigo}</div>
                                                <div className="text-xs text-zinc-400">{ret.TClDescripcion}</div>
                                            </div>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-sm">
                                                <thead className="bg-zinc-50 border-b border-zinc-200">
                                                    <tr className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                                        <th className="px-4 md:px-5 py-2.5 text-left">Código Orden</th>
                                                        <th className="px-3 py-2.5 text-left">Estado</th>
                                                        <th className="px-3 py-2.5 text-right">Importe</th>
                                                        <th className="px-4 md:px-5 py-2.5 text-center">Acción</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-100">
                                                    {ret.ordenes.map(o => (
                                                        <tr key={o.OrdIdOrden} className="hover:bg-zinc-50 transition-colors">
                                                            <td className="px-4 md:px-5 py-3 font-bold text-zinc-800 whitespace-nowrap">{o.codigo}</td>
                                                            <td className="px-3 py-3 text-zinc-500">{o.estado}</td>
                                                            <td className="px-3 py-3 text-right font-black text-zinc-800 tabular-nums whitespace-nowrap">{o.simbolo} {parseFloat(o.costo || 0).toFixed(2)}</td>
                                                            <td className="px-4 md:px-5 py-3 text-center">
                                                                <button
                                                                    onClick={() => abrirModalPago([o], ret.etiqueta, ret)}
                                                                    className={`${BTN_FILA_PRINCIPAL} mx-auto`}
                                                                >
                                                                    <DollarSign size={13} /> Pagar
                                                                </button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="px-4 md:px-5 py-3 bg-zinc-50 border-t border-zinc-100 flex flex-wrap justify-between items-center gap-2">
                                            <span className="text-[11px] font-black text-zinc-400 uppercase tracking-wide">{ret.ordenes.length} orden(es) sin pagar</span>
                                            <button
                                                onClick={() => abrirModalPago(ret.ordenes, ret.etiqueta, ret)}
                                                className={BTN_PRINCIPAL}
                                            >
                                                <DollarSign size={15} /> Pagar Todas las Órdenes
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
                                        <div className={`${CARD} overflow-hidden`}>
                                            {/* Header con acciones grupales */}
                                            <div className="px-4 md:px-5 py-3 border-b border-zinc-100 flex flex-wrap justify-between items-center gap-3">
                                                <div className="min-w-0">
                                                    <h3 className="text-sm font-black text-zinc-800">Órdenes sin Retiro</h3>
                                                    <p className="text-xs text-zinc-400">Sin orden de retiro asignada · {totalSR} orden{totalSR !== 1 ? 'es' : ''}</p>
                                                </div>
                                                {someChecked && (
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <span className="text-xs font-bold text-brand-cyan bg-brand-cyan/5 border border-brand-cyan/20 px-2 py-1 rounded-lg tabular-nums">
                                                            {selectedArr.length} sel. · $ {totalSeleccionado.toFixed(2)}
                                                        </span>
                                                        <button
                                                            onClick={() => {
                                                                const items = selectedArr.map(o => ({ ...o, codigo: o.OrdCodigoOrden, costo: o.OrdCostoFinal, simbolo: o.MonSimbolo }));
                                                                abrirModalPago(items, null, selectedArr[0]);
                                                            }}
                                                            className={BTN_FILA_PRINCIPAL}
                                                        >
                                                            <DollarSign size={13} /> Pagar ({selectedArr.length})
                                                        </button>
                                                        <button
                                                            onClick={() => { setRetiroModal({ ordenes: selectedArr }); setRetiroLugar(lugaresRetiro[0]?.LReIdLugarRetiro || ''); }}
                                                            className={BTN_FILA_SECUNDARIO}
                                                        >
                                                            <ClipboardList size={13} /> Generar Retiro ({selectedArr.length})
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                            <div className="overflow-x-auto">
                                                <table className="w-full text-sm">
                                                    <thead className="bg-zinc-50 border-b border-zinc-200">
                                                        <tr className="text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                                            <th className="px-4 py-2.5 w-10">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={allChecked}
                                                                    onChange={e => {
                                                                        if (e.target.checked) setSelectedSinRetiro(new Set(mostradorData.sinRetiro.map(o => o.OrdIdOrden)));
                                                                        else setSelectedSinRetiro(new Set());
                                                                    }}
                                                                    className="w-4 h-4 rounded accent-brand-cyan cursor-pointer"
                                                                />
                                                            </th>
                                                            <th className="px-3 py-2.5 text-left">Código</th>
                                                            <th className="px-3 py-2.5 text-left">Cliente</th>
                                                            <th className="px-3 py-2.5 text-left">Estado</th>
                                                            <th className="px-3 py-2.5 text-right">Importe</th>
                                                            <th className="px-4 md:px-5 py-2.5 text-center">Acción Individual</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-zinc-100">
                                                        {mostradorData.sinRetiro.map(o => {
                                                            const isSel = selectedSinRetiro.has(o.OrdIdOrden);
                                                            return (
                                                                <tr key={o.OrdIdOrden} className={`cursor-pointer transition-colors ${isSel ? 'bg-brand-cyan/5' : o.Pagada ? 'bg-emerald-50/40 hover:bg-emerald-50' : 'hover:bg-zinc-50'}`}
                                                                    onClick={() => setSelectedSinRetiro(prev => { const s = new Set(prev); if (s.has(o.OrdIdOrden)) s.delete(o.OrdIdOrden); else s.add(o.OrdIdOrden); return s; })}
                                                                >
                                                                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                                                                        <input
                                                                            type="checkbox"
                                                                            checked={isSel}
                                                                            onChange={() => setSelectedSinRetiro(prev => { const s = new Set(prev); if (s.has(o.OrdIdOrden)) s.delete(o.OrdIdOrden); else s.add(o.OrdIdOrden); return s; })}
                                                                            className="w-4 h-4 rounded accent-brand-cyan cursor-pointer"
                                                                        />
                                                                    </td>
                                                                    <td className="px-3 py-3 font-bold text-zinc-800 whitespace-nowrap">
                                                                        {o.OrdCodigoOrden}
                                                                        {o.Pagada ? <span className={`ml-2 ${CHIP} ${PAGO_PAGADO} inline-flex items-center gap-1 align-middle`}><Check size={11} /> Paga</span> : null}
                                                                    </td>
                                                                    <td className="px-3 py-3 font-bold text-zinc-700">{o.CliNombre || o.CliCodigo}</td>
                                                                    <td className="px-3 py-3 text-zinc-500">{o.estadoOrden}</td>
                                                                    <td className="px-3 py-3 text-right font-black text-zinc-800 tabular-nums whitespace-nowrap">{o.MonSimbolo} {parseFloat(o.OrdCostoFinal || 0).toFixed(2)}</td>
                                                                    <td className="px-4 md:px-5 py-3" onClick={e => e.stopPropagation()}>
                                                                        <div className="flex items-center gap-2 justify-center">
                                                                            {!o.Pagada && (
                                                                                <button
                                                                                    onClick={() => abrirModalPago([{ ...o, codigo: o.OrdCodigoOrden, costo: o.OrdCostoFinal, simbolo: o.MonSimbolo }], null, o)}
                                                                                    className={BTN_FILA_PRINCIPAL}
                                                                                >
                                                                                    <DollarSign size={13} /> Pagar
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
                                                                                className={BTN_FILA_SECUNDARIO}
                                                                            >
                                                                                <ClipboardList size={13} /> Generar Retiro
                                                                            </button>
                                                                        </div>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
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
                        <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-4">
                            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto text-zinc-800">
                                <div className="bg-white px-5 py-4 border-b border-zinc-200 rounded-t-2xl flex justify-between items-center gap-3 sticky top-0 z-10">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <ClipboardList size={24} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                                        <div className="min-w-0">
                                            <p className="text-lg font-black text-zinc-800 leading-tight">Generar Orden de Retiro</p>
                                            <p className="text-sm text-zinc-400 truncate">
                                                {ordenes.length === 1
                                                    ? `${ordenes[0].OrdCodigoOrden} · ${clienteNombre}`
                                                    : `${ordenes.length} órdenes · ${clienteNombre}`}
                                            </p>
                                        </div>
                                    </div>
                                    <button onClick={() => setRetiroModal(null)} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors" title="Cerrar" aria-label="Cerrar">
                                        <X size={18} />
                                    </button>
                                </div>
                                <div className="p-5 flex flex-col gap-4">
                                    {/* Lista de órdenes seleccionadas */}
                                    <div className="bg-zinc-50 rounded-xl border border-zinc-200 overflow-hidden">
                                        <div className="px-4 py-2 border-b border-zinc-200 text-[10px] font-black text-zinc-400 uppercase tracking-wide">Incluye</div>
                                        <div className="divide-y divide-zinc-100 max-h-36 overflow-y-auto">
                                            {ordenes.map(o => (
                                                <div key={o.OrdIdOrden} className="flex justify-between items-center gap-2 px-4 py-2 text-sm">
                                                    <span className="font-bold text-zinc-800">{o.OrdCodigoOrden}</span>
                                                    <span className="font-black text-zinc-700 tabular-nums">{o.MonSimbolo} {parseFloat(o.OrdCostoFinal || 0).toFixed(2)}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="px-4 py-2 bg-white border-t border-zinc-200 flex justify-between text-sm font-black">
                                            <span className="text-zinc-500">TOTAL</span>
                                            <span className="text-zinc-800 tabular-nums">{simboloTotal} {totalCost.toFixed(2)}</span>
                                        </div>
                                    </div>

                                    {/* Lugar / Forma de Envío */}
                                    <div>
                                        <label className="block text-sm font-bold text-zinc-700 mb-1.5">Lugar / Forma de Envío</label>
                                        <Selector
                                            aria-label="Lugar / Forma de Envío"
                                            value={retiroLugar}
                                            onChange={e => {
                                                setRetiroLugar(e.target.value);
                                                setRetiroEnvio({ direccion: '', ciudad: '', localidad: '', agenciaId: '' });
                                                setRetiroDirSeleccionada(null);
                                            }}
                                        >
                                            {lugaresRetiro.map(l => (
                                                <option key={l.LReIdLugarRetiro} value={l.LReIdLugarRetiro}>{l.LReNombreLugar}</option>
                                            ))}
                                        </Selector>
                                    </div>

                                    {/* ── Sección Dirección: solo cuando NO es retiro local ── */}
                                    {esEnvio && (
                                        <div className="flex flex-col gap-3 border border-zinc-200 bg-zinc-50 rounded-xl p-4">
                                            <p className="text-[11px] font-black text-zinc-400 uppercase tracking-wide flex items-center gap-1.5"><Truck size={14} className="shrink-0 text-brand-cyan" /> Datos de Envío</p>

                                            {/* Selector de direcciones guardadas */}
                                            {clienteEnvioDatos?.direcciones?.length > 0 && (
                                                <div>
                                                    <label className="block text-xs font-bold text-zinc-600 mb-1">Dirección guardada</label>
                                                    <Selector
                                                        aria-label="Dirección guardada"
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
                                                    >
                                                        <option value="">— Ingresar manualmente —</option>
                                                        {clienteEnvioDatos.direcciones.map(d => (
                                                            <option key={d.ID} value={d.ID}>{d.Alias || d.Direccion} {d.Ciudad ? `· ${d.Ciudad}` : ''}</option>
                                                        ))}
                                                    </Selector>
                                                </div>
                                            )}

                                            {/* Agencia — siempre visible si hay datos */}
                                            {agenciasLista.length > 0 && (
                                                <div>
                                                    <label className="block text-xs font-bold text-zinc-600 mb-1">Agencia de transporte</label>
                                                    <Selector
                                                        aria-label="Agencia de transporte"
                                                        value={retiroEnvio.agenciaId || ''}
                                                        onChange={e => setRetiroEnvio(prev => ({ ...prev, agenciaId: e.target.value }))}
                                                    >
                                                        <option value="">— Sin agencia —</option>
                                                        {agenciasLista.map(a => (
                                                            <option key={a.ID} value={a.ID}>{a.Nombre}</option>
                                                        ))}
                                                    </Selector>
                                                </div>
                                            )}

                                            {/* Dirección */}
                                            <div>
                                                <label className="block text-xs font-bold text-zinc-600 mb-1">Dirección</label>
                                                <input
                                                    type="text"
                                                    value={retiroEnvio.direccion}
                                                    onChange={e => setRetiroEnvio(prev => ({ ...prev, direccion: e.target.value }))}
                                                    placeholder="Ej: Av. Italia 1234"
                                                    className={CAMPO_SIMPLE}
                                                />
                                            </div>

                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                {/* Departamento */}
                                                <div className="min-w-0">
                                                    <label className="block text-xs font-bold text-zinc-600 mb-1">Departamento</label>
                                                    <Selector
                                                        aria-label="Departamento"
                                                        value={retiroEnvio.departamentoId || ''}
                                                        onChange={e => handleDepartamentoChange(e.target.value)}
                                                    >
                                                        <option value="">— Seleccionar —</option>
                                                        {departamentosLista.map(d => (
                                                            <option key={d.ID} value={d.ID}>{d.Nombre}</option>
                                                        ))}
                                                    </Selector>
                                                </div>
                                                {/* Localidad */}
                                                <div className="min-w-0">
                                                    <label className="block text-xs font-bold text-zinc-600 mb-1">Localidad</label>
                                                    <Selector
                                                        aria-label="Localidad"
                                                        value={retiroEnvio.localidadId || ''}
                                                        onChange={e => setRetiroEnvio(prev => ({ ...prev, localidadId: e.target.value }))}
                                                        disabled={!retiroEnvio.departamentoId}
                                                    >
                                                        <option value="">— Seleccionar —</option>
                                                        {localidadesLista.map(l => (
                                                            <option key={l.ID} value={l.ID}>{l.Nombre}</option>
                                                        ))}
                                                    </Selector>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    <div className="flex gap-3 mt-1">
                                        <button onClick={() => setRetiroModal(null)} className={`${BTN_SECUNDARIO} flex-1`}>
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
                                            className={`${BTN_PRINCIPAL} flex-1`}
                                        >
                                            {retiroGenerando ? <Loader2 size={15} className="animate-spin" /> : <ClipboardList size={15} />}
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
                    <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto text-zinc-800">
                            {/* Cabecera */}
                            <div className="bg-white px-5 py-4 border-b border-zinc-200 rounded-t-2xl flex justify-between items-center gap-3 sticky top-0 z-10">
                                <div className="flex items-center gap-3 min-w-0">
                                    <DollarSign size={24} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                                    <div className="min-w-0">
                                        <p className="text-lg font-black text-zinc-800 leading-tight">Registrar Pago</p>
                                        <p className="text-sm text-zinc-400 truncate">{pagoModal.retiroId || 'Orden directa'} · {pagoModal.ordenes.length} orden(es)</p>
                                    </div>
                                </div>
                                <button onClick={() => setPagoModal(null)} className="w-8 h-8 shrink-0 flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors" title="Cerrar" aria-label="Cerrar">
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="p-5 flex flex-col gap-4">
                                {/* Cotización */}
                                {cotizacion && (
                                    <div className="bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl px-4 py-2 text-sm text-brand-cyan font-bold text-center">
                                        Cotización: 1 USD = {Number(cotizacion).toFixed(2)} UYU
                                    </div>
                                )}

                                {/* Resumen órdenes */}
                                <div className="bg-zinc-50 rounded-xl px-4 py-2 border border-zinc-200 divide-y divide-zinc-100">
                                    {pagoModal.ordenes.map(o => (
                                        <div key={o.OrdIdOrden} className="flex justify-between gap-2 text-sm font-bold py-1.5">
                                            <span className="text-zinc-600">{o.codigo || o.OrdCodigoOrden}</span>
                                            <span className="text-zinc-800 tabular-nums">{o.simbolo} {parseFloat(o.costo || o.OrdCostoFinal || 0).toFixed(2)}</span>
                                        </div>
                                    ))}
                                </div>

                                {/* Forma de pago — select igual a Caja */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-bold text-zinc-700">Seleccionar forma de pago</label>
                                    <Selector
                                        aria-label="Forma de pago"
                                        value={formaPago}
                                        onChange={e => setFormaPago(e.target.value)}
                                    >
                                        <option value="">Seleccione un método</option>
                                        {metodosPago.map(m => (
                                            <option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>{m.MPaDescripcionMetodo}</option>
                                        ))}
                                    </Selector>
                                </div>

                                {/* Moneda — igual a Caja */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-bold text-zinc-700">Seleccionar Moneda</label>
                                    <Selector
                                        aria-label="Moneda"
                                        value={monedaPago}
                                        onChange={e => handleCambioMoneda(e.target.value)}
                                    >
                                        <option value="UYU">UYU — Peso Uruguayo</option>
                                        <option value="USD">USD — Dólar</option>
                                    </Selector>
                                </div>

                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-bold text-zinc-700">Cargar comprobante (opcional)</label>
                                    <input
                                        type="file"
                                        accept="image/*,application/pdf"
                                        capture="environment"
                                        onChange={e => setFileComprobante(e.target.files[0])}
                                        className="w-full text-sm text-zinc-600 bg-white border border-zinc-200 p-2 rounded-xl cursor-pointer file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-zinc-100 file:text-xs file:font-bold file:text-zinc-700 hover:file:bg-zinc-200"
                                    />
                                </div>

                                {/* Monto */}
                                <div className="flex flex-col gap-1.5">
                                    <label className="text-sm font-bold text-zinc-700">Ingrese Monto ({monedaPago})</label>
                                    <input
                                        type="number"
                                        placeholder="Monto"
                                        step="0.01"
                                        value={montoPago}
                                        onChange={e => setMontoPago(e.target.value)}
                                        className="w-full bg-white border border-zinc-200 rounded-xl px-4 py-2.5 text-lg font-bold text-zinc-800 tabular-nums placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15"
                                    />
                                </div>

                                {/* Botones */}
                                <div className="flex gap-3 mt-1">
                                    <button onClick={() => setPagoModal(null)} className={`${BTN_SECUNDARIO} flex-1`}>Cancelar</button>
                                    <button
                                        onClick={confirmarPago}
                                        disabled={pagandoLoading}
                                        className={`${BTN_PRINCIPAL} flex-1`}
                                    >
                                        {pagandoLoading ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle size={15} />}
                                        {pagandoLoading ? 'Registrando...' : 'Realizar Pago'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* TAB TRANSPORT (EN VIAJE) — TransportView ya trae su fondo claro y su margen (p-3 md:p-6): el margen
                negativo lo alinea con el resto de la página en vez de sumarle otro recuadro. Arriba no más que el gap
                (gap-4 = 16 px): con -mt-6 tapaba el subtítulo del encabezado. */}
            {activeTab === 'transport' && (
                <div className="flex flex-col flex-1 -mx-3 -mb-3 -mt-3 md:-mx-6 md:-mb-6 md:-mt-4">
                    <TransportView areaFilter="TODOS" mode="transport" originArea="LOGISTICA_ENCOMIENDAS" />
                </div>
            )}
        </div>
    );
};

export default EntregaPedidosView;

