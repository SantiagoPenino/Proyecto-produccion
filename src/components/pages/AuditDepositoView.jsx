import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/apiClient';
import { Toaster, toast } from 'react-hot-toast';
import { Loader2, CheckCircle2, AlertTriangle, Clock, XCircle, Search, HelpCircle, Download, Smartphone, Camera, ScanLine, X, ClipboardList, FileText, Repeat, Wrench, Bell, BellOff, Phone, Mail, CircleDollarSign, Receipt, Wallet, QrCode } from 'lucide-react';
import ScannerComponent from '../common/ScannerComponent';
import * as XLSX from 'xlsx';
import { socket } from '../../services/socketService';
import AuditDepositoSesionBar from './AuditDepositoSesionBar';
import AuditDepositoCasosTab from './AuditDepositoCasosTab';
import AuditDepositoReportesTab from './AuditDepositoReportesTab';
import AuditDepositoCiclicoTab from './AuditDepositoCiclicoTab';
import { useAuth } from '../../context/AuthContext';

// Categoría de una lectura de la pistola, con los mismos nombres que las tarjetas de la derecha.
const grupoScan = (s) => s.duplicado ? 'REPETIDA' : s.resultado === 'CORREGIDA' ? 'CORREGIDA' : ['SIN_INGRESO', 'DESCONOCIDO'].includes(s.resultado) ? 'FALTA_INGRESAR' : ['FUERA_ALCANCE', 'INGRESO_POSTERIOR'].includes(s.resultado) ? 'OTROS' : (s.resultado || 'PENDIENTE');
const FILTROS_SCAN = [['TODOS', 'Todas'], ['OK', 'OK'], ['ENTREGADA', 'Entregadas'], ['FALTA_INGRESAR', 'No ingresadas'], ['CORREGIDA', 'Corregidas'], ['REPETIDA', 'Repetidas'], ['OTROS', 'Otras'], ['PENDIENTE', 'Clasificando']];
// Estado escueto de la tarjeta
const estadoScan = (s) => {
  if (s.duplicado) return 'REPETIDA';
  switch (s.resultado) {
    case 'OK': return 'OK';
    case 'ENTREGADA': return 'ENTREGADA';
    case 'SIN_INGRESO': return 'NO INGRESADA';
    case 'DESCONOCIDO': return 'NO EXISTE';
    case 'CORREGIDA': return 'CORREGIDA';
    case 'FUERA_ALCANCE': return 'OTRA ÁREA';
    case 'INGRESO_POSTERIOR': return 'INGRESÓ DESPUÉS';
    default: return '…';
  }
};
const esRojaScan = (s) => !s.duplicado && ['ENTREGADA', 'SIN_INGRESO', 'DESCONOCIDO'].includes(s.resultado);
// Color pleno: verde OK · rojo error · ámbar repetida · verde azulado corregida · gris el resto
const fondoScan = (s) => s.duplicado ? 'bg-amber-500 border-amber-600 text-white' : s.resultado === 'OK' ? 'bg-green-600 border-green-700 text-white' : esRojaScan(s) ? 'bg-red-600 border-red-700 text-white' : s.resultado === 'CORREGIDA' ? 'bg-teal-600 border-teal-700 text-white' : s.resultado ? 'bg-slate-500 border-slate-600 text-white' : 'bg-slate-200 border-slate-300 text-slate-600';
// Explicación que abre el signo de pregunta
const ayudaScan = (s, sesionAbierta) => {
  if (s.duplicado) return 'Esta etiqueta ya se había leído en esta sesión. No suma.';
  switch (s.resultado) {
    case 'OK': return sesionAbierta ? 'Está en el depósito y en la fotografía. Nada que hacer.' : 'Está activa en el depósito. Nada que hacer.';
    case 'ENTREGADA': return 'En el sistema figura ENTREGADA, pero está físicamente acá. Acción: Regresar a Depósito (vuelve a "Pronto para entregar" y el retiro queda pendiente otra vez).';
    case 'SIN_INGRESO': return 'Existe en producción pero nunca se pistoleó al depósito. Acción: Ingresar al depósito (mismo proceso que la pantalla de Recepción).';
    case 'DESCONOCIDO': return 'No existe en el sistema. Si fue un error de lectura, quitala con la X; si es una orden real, hay que ingresarla a depósito mediante escaneo de su etiqueta.' + (sesionAbierta ? ' Al cerrar la auditoría queda como caso "Sin registro".' : '');
    case 'CORREGIDA': return 'Ya corregida durante esta auditoría. No genera caso.';
    case 'FUERA_ALCANCE': return 'Está activa, pero es de un área fuera del alcance de esta auditoría. No cuenta.';
    case 'INGRESO_POSTERIOR': return 'Ingresó al depósito después de abrir la auditoría. No cuenta como diferencia.';
    default: return 'Clasificando…';
  }
};

// Señalética de pago: un ícono por situación, el detalle completo en el tooltip
const senalPago = (pagoEstado) => {
  const p = String(pagoEstado || '');
  if (p.startsWith('Pagado')) return { Icono: CheckCircle2, cls: 'text-green-600', label: 'Pagado' };
  if (p.startsWith('Facturado')) return { Icono: Receipt, cls: 'text-red-600', label: 'Fact. s/cobrar' };
  if (p.startsWith('En cta')) return { Icono: Wallet, cls: 'text-blue-600', label: 'Sin facturar' };
  if (!p || p === 'N/A') return { Icono: HelpCircle, cls: 'text-slate-300', label: 'S/D' };
  return { Icono: CircleDollarSign, cls: 'text-amber-600', label: 'Sin cobrar' };
};
const catPago = (p) => { const s = String(p || ''); if (s.startsWith('Pagado')) return 'PAGADO'; if (s.startsWith('Facturado')) return 'FACTURADO'; if (s.startsWith('En cta')) return 'SIN_FACTURAR'; return 'SIN_COBRAR'; };
// Pasos del filtro cíclico de pago (cada clic avanza al siguiente)
const PASOS_PAGO = [
  { k: '', label: 'Pago: todas', Icono: CircleDollarSign, cls: 'text-slate-500 border-slate-300 bg-white' },
  { k: 'PAGADO', label: 'Pagado', Icono: CheckCircle2, cls: 'text-green-700 border-green-300 bg-green-50' },
  { k: 'SIN_COBRAR', label: 'Sin cobrar', Icono: CircleDollarSign, cls: 'text-amber-700 border-amber-300 bg-amber-50' },
  { k: 'FACTURADO', label: 'Facturado sin cobrar', Icono: Receipt, cls: 'text-red-700 border-red-300 bg-red-50' },
  { k: 'SIN_FACTURAR', label: 'Sin facturar', Icono: Wallet, cls: 'text-blue-700 border-blue-300 bg-blue-50' },
];
function PagoIcono({ estado }) {
  const s = senalPago(estado); const I = s.Icono;
  return <span className={`inline-flex items-center gap-1 text-[11px] font-semibold whitespace-nowrap ${s.cls}`} title={estado || ''}><I size={14} />{s.label}</span>;
}
function AvisoIcono({ avisado, fecha }) {
  if (avisado === undefined || avisado === null) return <span className="text-xs text-slate-300">—</span>;
  if (avisado) return <span className="inline-flex items-center gap-1 text-xs text-green-700" title={fecha ? 'Avisada el ' + new Date(fecha).toLocaleString('es-UY') : 'Avisada'}><Bell size={14} />{fecha ? new Date(fecha).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit' }) : 'Sí'}</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-red-600" title="Nunca se avisó al cliente"><BellOff size={14} />Sin aviso</span>;
}

// Switch compacto de tres posiciones: solo el ícono (rojo = faltan · gris = todas · verde = ya están) y la bolita.
// Cada clic avanza: todas → rojo → verde → todas. El detalle y los conteos van en el tooltip.
function SwitchTriple({ valor, setValor, izq, der, iconos, titulo }) {
  const es = (k) => valor === k;
  const Ico = es(der.k) ? iconos.der : es(izq.k) ? iconos.izq : iconos.centro;
  const color = es(der.k) ? 'text-green-600' : es(izq.k) ? 'text-red-600' : 'text-slate-400';
  const ahora = es(der.k) ? `solo ${der.label} (${der.n})` : es(izq.k) ? `solo ${izq.label} (${izq.n})` : `todas · ${izq.label} ${izq.n} · ${der.label} ${der.n}`;
  return (
    <button onClick={() => setValor(v => (v === '' ? izq.k : v === izq.k ? der.k : ''))} className="inline-flex items-center gap-1 ml-1 select-none" title={`${titulo} · ahora: ${ahora}`}>
      <Ico size={16} className={color} />
      <span className={`relative inline-block w-8 h-4 rounded-full border transition-colors ${es(der.k) ? 'bg-green-600 border-green-700' : es(izq.k) ? 'bg-red-500 border-red-600' : 'bg-slate-300 border-slate-400'}`}>
        <span className={`absolute top-[1px] w-3 h-3 rounded-full bg-white shadow transition-all ${es(der.k) ? 'left-[17px]' : es(izq.k) ? 'left-[1px]' : 'left-[9px]'}`} />
      </span>
    </button>
  );
}

export default function AuditDepositoView() {
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [liveCodes, setLiveCodes] = useState([]);
  const [scanInput, setScanInput] = useState('');
  const [results, setResults] = useState(null);
  const [showCamera, setShowCamera] = useState(false);

  // Para seleccin mltiple en la vista de errores/sobrantes
  const [selectedOlvidadas, setSelectedOlvidadas] = useState(new Set());

  // Pestaa activa
  const [activeTab, setActiveTab] = useState('escaneo');
  const [dataLoaded, setDataLoaded] = useState(false); // lazy: se carga al entrar a un tab de datos

  // ── Sesión de auditoría (fotografía) + Registro de Casos ──
  // estadoSesion = GET /audit-deposito/sesion | null (cargando) | { sinSoporte: true } (backend viejo)
  const [estadoSesion, setEstadoSesion] = useState(null);
  const [liveScans, setLiveScans] = useState([]);   // escaneos de la sesión con su resultado (modo sesión)
  const [kpisCasos, setKpisCasos] = useState(null);
  const [refreshCasos, setRefreshCasos] = useState(0);
  const sesionAbierta = !!(estadoSesion && estadoSesion.sesion);
  // Escanear solo con auditoría abierta. Única excepción: backend viejo sin el módulo (modo anterior), para no cortar el depósito.
  const puedeEscanear = sesionAbierta || !!(estadoSesion && estadoSesion.sinSoporte);
  const [filtroScan, setFiltroScan] = useState('TODOS');
  // Lista de lecturas con su categoría. Con sesión abierta manda el servidor (incluye repetidas);
  // sin sesión son los códigos locales con la categoría que devolvió /check (hasta que llega: "clasificando").
  const listaEscaneos = React.useMemo(() => {
    if (sesionAbierta && liveScans.length) return liveScans.slice().reverse();
    const porCodigo = new Map(liveScans.map(s => [s.codigo, s]));
    return liveCodes.slice().reverse().map(c => porCodigo.get(c) || { codigo: c, resultado: null });
  }, [sesionAbierta, liveScans, liveCodes]);
  const conteoScan = React.useMemo(() => {
    const m = { TODOS: listaEscaneos.length };
    listaEscaneos.forEach(s => { const g = grupoScan(s); m[g] = (m[g] || 0) + 1; });
    return m;
  }, [listaEscaneos]);
  const listaEscaneosFiltrada = filtroScan === 'TODOS' ? listaEscaneos : listaEscaneos.filter(s => grupoScan(s) === filtroScan);
  const { user: usuarioActual } = useAuth();
  const [corrigiendo, setCorrigiendo] = useState(null); // código cuya corrección está en curso
  const [panelScan, setPanelScan] = useState(null);     // { codigo, tipo: 'AYUDA' | 'ACCIONES' } abierto en una tarjeta
  const togglePanel = (codigo, tipo) => setPanelScan(p => (p && p.codigo === codigo && p.tipo === tipo ? null : { codigo, tipo }));

  // ── "Órdenes Activas" es UNA lista (incluye Caducadas): filtros, búsqueda y selección ──
  const [buscaActivas, setBuscaActivas] = useState('');
  const [prefijoActivas, setPrefijoActivas] = useState('');
  const maxDiasCfg = results?.olvidadas?.[0]?.maxDiasDeposito || results?.totales?.[0]?.maxDiasDeposito || 15;
  const escaneadasSet = useMemo(() => new Set((results?.ok || []).map(o => o.codigo)), [results]);
  const prefijosActivas = useMemo(() => [...new Set((results?.totales || []).filter(o => String(o.codigo).includes('-')).map(o => String(o.codigo).split('-')[0]))].sort(), [results]);
  const sinCobrar = (o) => !String(o.pagoEstado || '').startsWith('Pagado');
  // Avance del escaneo: órdenes verificadas sobre el total en depósito (la fotografía, con sesión abierta)
  const totalOrdenes = results?.totales?.length || 0;
  const escaneadasOk = results?.ok?.length || 0;
  const pctEscaneadas = totalOrdenes ? Math.round((escaneadasOk / totalOrdenes) * 1000) / 10 : 0;
  const conteoActivas = useMemo(() => {
    const t = results?.totales || [];
    return {
      TODAS: t.length,
      CADUCADAS: t.filter(o => o.diasEnDeposito > maxDiasCfg).length,
      SIN_AVISO: t.filter(o => o.avisado === false).length,
      SIN_COBRAR: t.filter(sinCobrar).length,
      SIN_ESCANEAR: t.filter(o => !escaneadasSet.has(o.codigo)).length,
      ESCANEADAS: t.filter(o => escaneadasSet.has(o.codigo)).length,
    };
  }, [results, maxDiasCfg, escaneadasSet]);
  const [filtroEscaneo, setFiltroEscaneo] = useState(''); // '' todas · 'ESCANEADAS' · 'SIN_ESCANEAR' (switch con el QR)
  const [filtroAviso, setFiltroAviso] = useState('');     // '' todas · 'AVISADAS' · 'SIN_AVISO' (switch con la campana)
  const [filtroPago, setFiltroPago] = useState('');       // '' todas · PAGADO · SIN_COBRAR · FACTURADO · SIN_FACTURAR (ciclo)
  const [filtroPlazo, setFiltroPlazo] = useState('');     // '' todas · 'CADUCADAS' · 'EN_PLAZO' (switch con el reloj)
  const filtradoActivas = useMemo(() => {
    let l = results?.totales || [];
    if (prefijoActivas) l = l.filter(o => String(o.codigo).startsWith(prefijoActivas + '-'));
    if (buscaActivas.trim()) { const q = buscaActivas.trim().toLowerCase(); l = l.filter(o => String(o.codigo).toLowerCase().includes(q) || String(o.cliente || '').toLowerCase().includes(q)); }
    const caducadasN = l.filter(o => o.diasEnDeposito > maxDiasCfg).length;
    const enPlazoN = l.length - caducadasN;
    if (filtroPlazo === 'CADUCADAS') l = l.filter(o => o.diasEnDeposito > maxDiasCfg);
    else if (filtroPlazo === 'EN_PLAZO') l = l.filter(o => o.diasEnDeposito <= maxDiasCfg);
    if (filtroPago) l = l.filter(o => catPago(o.pagoEstado) === filtroPago);
    const avisadas = l.filter(o => o.avisado === true).length;
    const sinAvisoN = l.filter(o => o.avisado === false).length;
    if (filtroAviso === 'AVISADAS') l = l.filter(o => o.avisado === true);
    else if (filtroAviso === 'SIN_AVISO') l = l.filter(o => o.avisado === false);
    const escaneadas = l.filter(o => escaneadasSet.has(o.codigo)).length;
    const sinEscanearN = l.length - escaneadas;
    if (filtroEscaneo === 'ESCANEADAS') l = l.filter(o => escaneadasSet.has(o.codigo));
    else if (filtroEscaneo === 'SIN_ESCANEAR') l = l.filter(o => !escaneadasSet.has(o.codigo));
    return { lista: l.slice().sort((a, b) => (b.diasEnDeposito || 0) - (a.diasEnDeposito || 0)), escaneadas, sinEscanearN, avisadas, sinAvisoN, caducadasN, enPlazoN };
  }, [results, filtroPlazo, filtroPago, filtroAviso, filtroEscaneo, prefijoActivas, buscaActivas, maxDiasCfg, escaneadasSet]);
  const activasFiltradas = filtradoActivas.lista;
  // Corrección desde la tarjeta: la MISMA acción que el botón "Regresar a Depósito" de la pestaña Sobrantes.
  const regresarADeposito = async (s) => {
    if (!s.ordenCodigo) return;
    if (!window.confirm(`Regresar a Depósito la orden ${s.ordenCodigo}${s.cliente ? ' (' + s.cliente + ')' : ''}.\n\nFigura ENTREGADA en el sistema pero está físicamente acá. Vuelve a estado "Pronto para entregar" y su retiro queda pendiente otra vez (si el cliente tiene saldo, se aplica solo).\n\n¿Confirmar?`)) return;
    setCorrigiendo(s.codigo);
    try {
      const { data } = await api.post('/audit-deposito/actions', { codigos: [s.ordenCodigo], accion: 'A_DEPOSITO' });
      toast.success(data.message || `${s.ordenCodigo} regresada a depósito`);
      fetchAuditData(liveCodes);
    } catch (e) { toast.error('No se pudo regresar a depósito: ' + (e?.response?.data?.error || e.message)); }
    finally { setCorrigiendo(null); }
  };
  // Corrección desde la tarjeta: el MISMO proceso que la pantalla de Recepción (POST /logistics/receive, área DEPOSITO).
  const ingresarADeposito = async (s) => {
    const etiqueta = s.etiqueta || (String(s.codigo).includes('/B') ? s.codigo : null);
    if (!etiqueta) return toast.error('Esta orden no tiene bulto con etiqueta: generá la etiqueta desde el área antes de ingresarla.');
    if (!window.confirm(`Ingresar al depósito el bulto ${etiqueta}${s.ordenCodigo ? ' (orden ' + s.ordenCodigo + ')' : ''}.\n\nEs el MISMO proceso que la pantalla de Recepción: crea la orden en depósito, aplica el control de pedido completo y dispara los avisos.\n\n¿Confirmar?`)) return;
    setCorrigiendo(s.codigo);
    try {
      await api.post('/logistics/receive', { envioId: null, codigoEtiqueta: etiqueta, usuarioId: usuarioActual?.id, areaReceptora: 'DEPOSITO' });
      toast.success(`Bulto ${etiqueta} ingresado al depósito`);
      fetchAuditData(liveCodes);
    } catch (e) { toast.error('No se pudo ingresar: ' + (e?.response?.data?.error || e.message)); }
    finally { setCorrigiendo(null); }
  };
  const cargarEstadoSesion = () => api.get('/audit-deposito/sesion')
    .then(({ data }) => { if (data.success) setEstadoSesion(data); })
    .catch(err => setEstadoSesion({ sesion: null, sinSoporte: true, error: err?.response?.status || err.message }));
  const cargarKpisCasos = () => api.get('/audit-deposito/casos', { params: { estado: 'VIVOS', limit: 1 } })
    .then(({ data }) => { if (data.success) setKpisCasos(data.kpis); }).catch(() => {});
  const recargarTodo = () => {
    cargarEstadoSesion(); cargarKpisCasos(); setRefreshCasos(x => x + 1);
    api.get('/audit-deposito/init').then(({ data }) => {
      if (!data.success) return;
      setLiveCodes(Array.isArray(data.liveCodes) ? data.liveCodes : []);
      setLiveScans(Array.isArray(data.liveScans) ? data.liveScans : []);
      setResults(data.auditData || null);
    }).catch(() => {});
  };

  // Carga inicial: un solo request que devuelve liveCodes + auditData juntos (elimina round-trip extra en LAN)
  useEffect(() => {
    setLoading(true);
    api.get('/audit-deposito/init')
      .then(({ data }) => {
        if (data.success) {
          setLiveCodes(data.liveCodes || []);
          setLiveScans(data.liveScans || []);
          setResults(data.auditData || null);
        }
      })
      .catch(err => console.error('Error cargando init', err))
      .finally(() => setLoading(false));
    setDataLoaded(true);
    cargarEstadoSesion();
    cargarKpisCasos();

    // Conectar a WebSockets para sincronización en tiempo real entre Celular <-> PC
    const handleScanAdded = ({ codigo }) => {
      setLiveCodes(prev => {
        if (!prev.includes(codigo)) {
          const newLive = [...prev, codigo];
          // Refresh background data if active (usamos setDataLoaded state a través de dependencia o asumiendo true)
          fetchAuditData(newLive);
          return newLive;
        }
        return prev;
      });
    };

    const handleScanRemoved = ({ codigo }) => {
      setLiveCodes(prev => {
        const newLive = prev.filter(c => c !== codigo);
        fetchAuditData(newLive);
        return newLive;
      });
    };

    const handleScansCleared = () => {
      setLiveCodes([]);
      fetchAuditData([]);
    };

    socket.on('audit:scan_added', handleScanAdded);
    socket.on('audit:scan_removed', handleScanRemoved);
    socket.on('audit:scans_cleared', handleScansCleared);
    // Auditoría abierta / cerrada / anulada desde cualquier dispositivo: recargar todo
    const handleSesion = () => recargarTodo();
    socket.on('audit:sesion', handleSesion);
    socket.on('audit:cerrada', handleSesion);

    return () => {
      socket.off('audit:scan_added', handleScanAdded);
      socket.off('audit:scan_removed', handleScanRemoved);
      socket.off('audit:scans_cleared', handleScansCleared);
      socket.off('audit:sesion', handleSesion);
      socket.off('audit:cerrada', handleSesion);
    };
  }, []);

  const handleFinalizarInventario = () => {
    if (sesionAbierta) { toast('Hay una auditoría abierta: usá "Cerrar auditoría" en la barra de arriba para generar los casos.', { icon: 'ℹ️' }); return; }
    if (!results) return;
    const informe = `INFORME DE INVENTARIO FÍSICO
Fecha: ${new Date().toLocaleString()}
--------------------------------------------------
RESUMEN DE DISCREPANCIAS AL MOMENTO DEL CORTE:
- Faltan por Escanear (No halladas físicamente): ${results.faltaEnDeposito.length}
- Entregadas Erróneas (Físico presente, estado entregado en DB): ${results.sobraEnDeposito.length}
- Faltan por Ingresar (Desconocidas en el sistema): ${results.desconocido.length}
- Total Escaneadas Legítimas (Coincidencias): ${results.ok.length}

>> FALTANTES POR ESCANEAR:
${results.faltaEnDeposito.map(x => x.codigo).join(', ') || 'Ninguna'}

>> ENTREGADAS ERRÓNEAS (A REINGRESAR):
${results.sobraEnDeposito.map(x => x.codigo).join(', ') || 'Ninguna'}

>> DESCONOCIDAS (A INVESTIGAR):
${results.desconocido.map(x => x.code).join(', ') || 'Ninguna'}
--------------------------------------------------
Reporte Generado Automáticamente por USER.
`;

    const blob = new Blob([informe], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Reporte_Inventario_${new Date().toISOString().slice(0, 10)}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    if (confirm('Informe descargado. ¿Deseas limpiar todos los escaneos registrados para iniciar un nuevo inventario limpio?')) {
      setLoading(true);
      api.post('/audit-deposito/live/clear')
        .then(() => {
          setLiveCodes([]);
          fetchAuditData([]);
        })
        .catch(err => toast.error('Error al limpiar DB: ' + err.message))
        .finally(() => setLoading(false));
    }
  };

  const fetchAuditData = async (codesArray, codigoNuevo = null) => {
    setLoading(true);
    try {
      const { data } = await api.post('/audit-deposito/check', { scannedCodes: codesArray });
      if (data.success) {
        // Modo sesión: entregadasSinPago viene null ("sin cambios") y los escaneos son los de la sesión
        setResults(prev => ({ ...data.data, entregadasSinPago: data.data.entregadasSinPago ?? prev?.entregadasSinPago ?? [] }));
        if (Array.isArray(data.liveScans)) {
          setLiveScans(data.liveScans);
          if (codigoNuevo) { const s = data.liveScans.find(x => x.codigo === codigoNuevo); if (s) feedbackEscaneo(s); }
        }
        if (Array.isArray(data.liveCodes)) setLiveCodes(data.liveCodes);
        if (data.sesion) setEstadoSesion(prev => (prev && prev.sesion ? { ...prev, sesion: { ...prev.sesion, contadores: data.sesion.contadores } } : prev));
      } else {
        toast.error('Error al verificar: ' + data.error);
      }
    } catch (err) {
      toast.error('Error de red al comprobar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const processInputCodes = (text) => {
    return text
      .split(/[\n,]+/)
      .map(c => c.trim())
      .filter(c => c.length > 0)
      .map(c => {
        let code = c.split('$*')[0];
        code = code.split('|')[0];
        return code.trim().toUpperCase();
      });
  };

  const refreshData = () => {
    fetchAuditData(liveCodes);
  };

  // Handler de tabs: simplemente cambia el tab activo (los datos ya están cargados desde el mount)
  const handleTabClick = (tabId) => {
    setActiveTab(tabId);
  };

  // Qué es lo que se acaba de escanear (modo sesión): un aviso por resultado, sin ambigüedad.
  const feedbackEscaneo = (r) => {
    const ref = r.ordenCodigo ? `${r.ordenCodigo}${r.cliente ? ' · ' + r.cliente : ''}` : r.codigo;
    if (r.duplicado) return toast(`Ya estaba escaneada: ${ref}`, { icon: '⚠️' });
    switch (r.resultado) {
      case 'OK': return toast.success(r.ordenYaEscaneada ? `Otro bulto de la misma orden: ${ref}` : `${sesionAbierta ? 'OK, está en la fotografía' : 'OK, en depósito'}: ${ref}`);
      case 'ENTREGADA': return toast(`ENTREGADA ERRÓNEA: figura entregada en el sistema: ${ref}`, { icon: '🟠', duration: 5000 });
      case 'SIN_INGRESO': return toast(`FALTA POR INGRESAR: existe en producción pero nunca ingresó al depósito: ${ref}`, { icon: '🟣', duration: 5000 });
      case 'DESCONOCIDO': return toast.error(`FALTA POR INGRESAR: no existe en el sistema: ${r.codigo}`);
      case 'FUERA_ALCANCE': return toast(`Fuera del alcance de esta auditoría (otra área): ${ref}`, { icon: '⛔', duration: 5000 });
      case 'INGRESO_POSTERIOR': return toast(`Ingresó al depósito después de abrir la auditoría: ${ref} (no cuenta como diferencia)`, { icon: 'ℹ️', duration: 5000 });
      default: return toast(`${r.resultado}: ${ref}`);
    }
  };

  const processDiscoveredCode = (rawCode, fromCamera = false) => {
    if (!puedeEscanear) { toast.error('No hay auditoría abierta. Apretá "Abrir auditoría (tomar fotografía)" antes de escanear.'); return; }
    let parsed = processInputCodes(rawCode);
    if (parsed.length > 0) {
      const codeEscaneado = parsed[0];
      if (liveCodes.includes(codeEscaneado)) {
        if (!fromCamera) toast('Código ya escaneado: ' + codeEscaneado, { icon: '⚠️' });
        return;
      }
      const newLive = [...liveCodes, codeEscaneado];
      setLiveCodes(newLive);
      // Registrar en la base. Con auditoría abierta el servidor resuelve la orden y contesta qué es;
      // recién después se refrescan las listas (si no, el check correría antes de guardar el escaneo).
      api.post('/audit-deposito/live', { codigo: codeEscaneado })
        .then(({ data }) => {
          if (data && data.data) { feedbackEscaneo(data.data); fetchAuditData(newLive); }
          else if (dataLoaded) fetchAuditData(newLive, codeEscaneado);
        })
        .catch(e => {
          console.error('Error db temp', e);
          toast.error('No se pudo guardar el escaneo: ' + (e?.response?.data?.error || e.message));
          if (dataLoaded) fetchAuditData(newLive);
        });
    }
  };

  const handleLiveScan = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      processDiscoveredCode(scanInput, false);
      setScanInput('');
    }
  };

  const handleCameraScan = (decodedText) => {
    processDiscoveredCode(decodedText, true);
  };

  const handleRemoveLiveCode = (codeToRemove) => {
    const newLive = liveCodes.filter(c => c !== codeToRemove);
    setLiveCodes(newLive);
    fetchAuditData(newLive);
    // Eliminar de base de datos
    api.post('/audit-deposito/live/remove', { codigo: codeToRemove }).catch(e => console.error('Error db temp', e));
  };

  const handleToggleSet = (codigo, setFunc, currentSet) => {
    const newSet = new Set(currentSet);
    if (newSet.has(codigo)) newSet.delete(codigo);
    else newSet.add(codigo);
    setFunc(newSet);
  };

  const [notifyActionType, setNotifyActionType] = useState('ESTADO');
  const [emailTemplate, setEmailTemplate] = useState('Hola,\\n\\nQueremos avisarte que tu orden [CODIGO] sigue disponible para retirar en nuestro depósito.\\n¡Te esperamos pronto!');

  // "Marcar como Entregado": la orden ya salió del depósito sin pasar por el sistema (antes vivía en la pestaña Sin escanear)
  const marcarEntregadas = async () => {
    const codigos = Array.from(selectedOlvidadas);
    if (!codigos.length) return toast.error('Seleccioná al menos una orden de la lista.');
    if (!window.confirm(`Marcar como ENTREGADAS ${codigos.length} orden${codigos.length === 1 ? '' : 'es'}.\n\nSe usa cuando la orden ya salió del depósito sin pasar por el sistema: pasa a estado Entregado, su retiro queda entregado, se libera el estante y los bultos quedan despachados. No se deshace desde acá.\n\n¿Confirmar?`)) return;
    setLoading(true);
    try {
      const { data } = await api.post('/audit-deposito/actions', { codigos, accion: 'ENTREGADO' });
      if (data.success) { toast.success(data.message); setSelectedOlvidadas(new Set()); refreshData(); }
      else toast.error(data.error);
    } catch (err) { toast.error('Error al marcar entregadas: ' + (err?.response?.data?.error || err.message)); }
    finally { setLoading(false); }
  };
  const ejecutarAccionActivas = () => (notifyActionType === 'ENTREGADO' ? marcarEntregadas() : handleNotify());

  const handleNotify = async () => {
    if (selectedOlvidadas.size === 0) {
      toast.error('Seleccioná al menos una orden de la lista.');
      return;
    }
    const codigosArr = Array.from(selectedOlvidadas);
    const mgsConfirm = notifyActionType === 'EMAIL'
      ? `¿Enviar email (sin cambiar estado) a ${codigosArr.length} órdenes?`
      : `¿Cambiar estado a 'Avisar nuevamente' a ${codigosArr.length} órdenes?`;

    if (!confirm(mgsConfirm)) return;

    setLoading(true);
    try {
      const { data } = await api.post('/audit-deposito/notify', {
        codigos: codigosArr,
        accion: notifyActionType,
        mensaje: emailTemplate
      });
      if (data.success) {
        toast.success(data.message);
        setSelectedOlvidadas(new Set());
        // Recargar status
        refreshData();
      } else {
        toast.error(data.error);
      }
    } catch (err) {
      toast.error('Error al notificar: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = (dataArray, filename) => {
    if (!dataArray || dataArray.length === 0) {
      toast.error('No hay datos para exportar en esta pestaña.');
      return;
    }
    const worksheet = XLSX.utils.json_to_sheet(dataArray);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Auditoria");
    XLSX.writeFile(workbook, `${filename}.xlsx`);
  };

  // Tabs — el de escaneo siempre visible, los de datos muestran count solo cuando cargaron
  const tabsDef = [
    { id: 'escaneo', label: 'Escaneo Físico', count: liveCodes.length, icon: ScanLine, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200' },
    { id: 'totales', label: 'Situación depósito', count: results?.totales.length ?? '…', icon: Search, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
    { id: 'casos', label: 'Registro de Casos', count: kpisCasos ? kpisCasos.vivos : '…', icon: ClipboardList, color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
    { id: 'reportes', label: 'Reportes', count: '', icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
    { id: 'ciclico', label: 'Conteo cíclico', count: '', icon: Repeat, color: 'text-indigo-600', bg: 'bg-indigo-50', border: 'border-indigo-200' },
  ];



  return (
    <div className="px-0 lg:px-6 py-4 lg:py-6 max-w-7xl mx-auto font-sans text-slate-800">
      <Toaster position="top-right" />
      <div className="flex items-center justify-between mb-6 px-4 lg:px-0">
        <div>
          <h1 className="text-lg lg:text-2xl font-bold">Auditoría de Depósito / Control Físico</h1>
          <p className="text-sm text-slate-500 mt-1">Revisa el estado global del depósito, cruza códigos con escáner, exporta reportes y notifica clientes.</p>
        </div>
      </div>

      {/* BARRA DE SESIÓN: abrir (fotografía) / cerrar (motor de casos) / anular */}
      <AuditDepositoSesionBar estado={estadoSesion} loading={loading} onChange={recargarTodo} />

      {/* PANEL PRINCIPAL — siempre visible */}
      <div className="bg-white lg:rounded-xl shadow-sm border border-slate-200 overflow-hidden">

        {/* BARRA DE TABS — oculta en mobile, solo visible en desktop */}
        <div className="hidden lg:flex overflow-x-auto border-b border-slate-200 bg-slate-50/50">
          {tabsDef.map(tab => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition-all border-b-2 whitespace-nowrap ${isActive
                  ? `border-${tab.color.split('-')[1]}-600 ${tab.color} bg-white`
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <Icon size={18} className={isActive ? tab.color : 'text-slate-400'} />
                {tab.label}
                {tab.count !== '' && (
                  <span className={`px-2 py-0.5 rounded-full text-xs ${isActive ? `${tab.bg} ${tab.color}` : 'bg-slate-100 text-slate-500'}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="p-0 lg:p-6">

          {/* Skeleton para data tabs que aún no cargaron */}
          {!['escaneo', 'casos', 'reportes', 'ciclico'].includes(activeTab) && !results && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400">
              {loading
                ? <><div className="w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" /><p className="text-sm font-medium">Cargando datos...</p></>
                : <><Search size={32} className="opacity-40" /><p className="text-sm font-medium">Hacé clic en el tab para cargar los datos</p></>
              }
            </div>
          )}

          {/* ESCANEO FISICO */}
          {activeTab === 'escaneo' && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex flex-col lg:flex-row gap-6">
                {/* Columna Izquierda: Input y Tarjetas */}
                <div className="w-full bg-slate-50 p-4 lg:rounded-xl border border-slate-200 shadow-inner">
                  <h3 className="font-bold text-slate-800 mb-2 flex justify-between items-center w-full">
                    <span className="flex items-center gap-2"><ScanLine size={18} className="text-indigo-600" /> Pistola Escáner</span>
                    {sesionAbierta ? (
                      <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded">Auditoría {estadoSesion.sesion.codigo} abierta</span>
                    ) : (
                      <button onClick={handleFinalizarInventario} className="text-[10px] bg-slate-600 hover:bg-slate-700 text-white px-2 py-1.5 rounded shadow" title="Baja un .txt con el resumen y vacía la lista temporal. NO cierra ninguna auditoría ni genera casos.">
                        Vaciar lista temporal (.txt)
                      </button>
                    )}
                  </h3>
                  {sesionAbierta ? (
                    <p className="text-xs text-slate-500 mb-2 block">Cada lectura se guarda en la auditoría {estadoSesion.sesion.codigo} y se resuelve a su orden al instante.</p>
                  ) : (
                    <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      <b>No hay auditoría abierta: el escaneo está bloqueado.</b> Los escaneos solo cuentan dentro de una auditoría; sin ella no generan casos ni quedan en el historial.
                      Para auditar de verdad, primero apretá <b>"Abrir auditoría (tomar fotografía)"</b> en la barra de arriba y al terminar <b>"Cerrar auditoría y generar casos"</b>.
                    </div>
                  )}
                  {/* Termómetro de avance */}
                  {results && (
                    <div className="mb-4 xl:w-2/3 mx-auto">
                      <div className="flex justify-between items-baseline text-xs font-bold text-slate-700 mb-1">
                        <span>Escaneadas <span className="font-mono">{escaneadasOk}</span> de <span className="font-mono">{totalOrdenes}</span> órdenes{sesionAbierta ? ' de la fotografía' : ' en depósito'}</span>
                        <span className={`font-mono text-base ${pctEscaneadas >= 100 ? 'text-green-700' : 'text-indigo-700'}`}>{pctEscaneadas}%</span>
                      </div>
                      <div className="h-3 rounded-full bg-slate-200 overflow-hidden" title={`${escaneadasOk} de ${totalOrdenes}`}>
                        <div className={`h-full rounded-full transition-all duration-500 ${pctEscaneadas >= 100 ? 'bg-green-600' : pctEscaneadas >= 50 ? 'bg-indigo-600' : 'bg-indigo-400'}`} style={{ width: `${Math.min(100, pctEscaneadas)}%` }} />
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">{totalOrdenes - escaneadasOk > 0 ? `Faltan ${totalOrdenes - escaneadasOk} por escanear.` : totalOrdenes ? 'Todas escaneadas.' : 'Sin órdenes en depósito.'}</div>
                    </div>
                  )}
                  <div className="flex flex-col gap-3 mb-6">
                    <input
                      type="text"
                      className="w-full xl:w-2/3 mx-auto p-4 text-xl border-2 border-indigo-200 focus:border-indigo-500 rounded-xl shadow-sm text-center font-mono font-bold bg-white outline-none disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed"
                      placeholder={puedeEscanear ? 'Pistola láser aquí (Enter)' : 'Abrí una auditoría para escanear'}
                      disabled={!puedeEscanear}
                      value={scanInput}
                      onChange={e => setScanInput(e.target.value)}
                      onKeyDown={handleLiveScan}
                      autoFocus
                    />
                    <button
                      onClick={() => setShowCamera(true)}
                      disabled={!puedeEscanear}
                      className="xl:w-2/3 mx-auto flex items-center justify-center gap-2 bg-slate-800 text-white p-3 rounded-xl shadow hover:bg-slate-700 transition disabled:bg-slate-400 disabled:cursor-not-allowed"
                    >
                      <Smartphone size={20} />
                      Usar Cámara del Móvil
                    </button>
                  </div>

                  {showCamera && (
                    <ScannerComponent
                      onScan={handleCameraScan}
                      onClose={() => setShowCamera(false)}
                      scannedCodes={liveCodes}
                    />
                  )}

                  {listaEscaneos.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-4">
                      {FILTROS_SCAN.filter(([k]) => k === 'TODOS' || conteoScan[k]).map(([k, l]) => (
                        <button key={k} onClick={() => setFiltroScan(k)} className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${filtroScan === k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                          {l} <span className="opacity-70">{conteoScan[k] || 0}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-1.5 mt-2 max-h-[70vh] overflow-y-auto pr-1 items-start">
                    {listaEscaneosFiltrada.map((s, i) => (
                      <div key={s.codigo + '_' + i} className={`border rounded-md shadow-sm ${fondoScan(s)}`}>
                        <div className="flex items-center justify-between gap-1 px-2 py-1">
                          <div className="min-w-0 leading-tight">
                            <div className="font-mono font-bold text-sm truncate" title={s.ordenCodigo && s.ordenCodigo !== s.codigo ? `Etiqueta ${s.codigo}` : s.codigo}>{s.ordenCodigo || s.codigo}</div>
                            <div className="text-[10px] font-extrabold tracking-wide opacity-90">{estadoScan(s)}</div>
                          </div>
                          <div className="flex items-center shrink-0">
                            <button onClick={() => togglePanel(s.codigo, 'AYUDA')} className={`p-1 rounded hover:bg-white/25 ${panelScan && panelScan.codigo === s.codigo && panelScan.tipo === 'AYUDA' ? 'bg-white/30' : ''}`} title="¿Qué significa?"><HelpCircle size={14} /></button>
                            {esRojaScan(s) && <button onClick={() => togglePanel(s.codigo, 'ACCIONES')} className={`p-1 rounded hover:bg-white/25 ${panelScan && panelScan.codigo === s.codigo && panelScan.tipo === 'ACCIONES' ? 'bg-white/30' : ''}`} title="Acciones"><Wrench size={14} /></button>}
                            <button onClick={() => handleRemoveLiveCode(s.codigo)} className="p-1 rounded hover:bg-white/25" title="Quitar esta lectura"><X size={14} /></button>
                          </div>
                        </div>
                        {panelScan && panelScan.codigo === s.codigo && panelScan.tipo === 'AYUDA' && (
                          <div className="bg-white text-slate-700 text-[11px] leading-snug px-2 py-1.5 rounded-b-md border-t border-white/40">
                            {ayudaScan(s, sesionAbierta)}
                            {(s.cliente || (s.ordenCodigo && s.ordenCodigo !== s.codigo)) && (
                              <div className="mt-1 text-[10px] text-slate-500">{s.ordenCodigo && s.ordenCodigo !== s.codigo ? `Etiqueta leída: ${s.codigo}` : ''}{s.cliente ? `${s.ordenCodigo && s.ordenCodigo !== s.codigo ? ' · ' : ''}Cliente: ${s.cliente}` : ''}</div>
                            )}
                          </div>
                        )}
                        {panelScan && panelScan.codigo === s.codigo && panelScan.tipo === 'ACCIONES' && (
                          <div className="bg-white text-slate-700 text-[11px] px-2 py-1.5 rounded-b-md border-t border-white/40 flex flex-col gap-1.5">
                            {s.resultado === 'ENTREGADA' && (
                              <button onClick={() => regresarADeposito(s)} disabled={corrigiendo === s.codigo} className="px-2 py-1.5 rounded bg-orange-600 hover:bg-orange-700 disabled:bg-orange-300 text-white font-bold text-left">Regresar a Depósito <span className="font-normal opacity-80">· vuelve a Pronto para entregar</span></button>
                            )}
                            {(s.resultado === 'SIN_INGRESO' || (s.resultado === 'DESCONOCIDO' && String(s.codigo).includes('/B'))) && (
                              <button onClick={() => ingresarADeposito(s)} disabled={corrigiendo === s.codigo} className="px-2 py-1.5 rounded bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white font-bold text-left">Ingresar al depósito <span className="font-normal opacity-80">· mismo proceso que Recepción</span></button>
                            )}
                            {s.resultado === 'DESCONOCIDO' && !String(s.codigo).includes('/B') && (
                              <div className="text-slate-600">No hay corrección automática: no existe en el sistema. Si es una orden real, ingresala a depósito escaneando su etiqueta (Recepción).</div>
                            )}
                            <button onClick={() => handleRemoveLiveCode(s.codigo)} className="px-2 py-1.5 rounded bg-white border border-red-300 text-red-700 font-bold text-left hover:bg-red-50">Quitar la lectura <span className="font-normal opacity-80">· fue un error de escaneo</span></button>
                          </div>
                        )}
                      </div>
                    ))}
                    {listaEscaneos.length === 0 && <p className="text-xs text-center text-slate-400 py-4">Aún no has escaneado ninguna orden.</p>}
                    {listaEscaneos.length > 0 && listaEscaneosFiltrada.length === 0 && <p className="text-xs text-center text-slate-400 py-4">No hay lecturas en esta categoría.</p>}
                  </div>
                </div>

                {/* Las listas de la derecha se reemplazaron por la categoría en cada tarjeta (ver lista de la pistola) */}
              </div>
            </div>
          )}

          {/* ÓRDENES ACTIVAS (incluye Caducadas): lista única con filtros, selección, acciones de aviso y señalética */}
          {activeTab === 'totales' && results && (
            <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-3 gap-3">
                <div>
                  <h3 className="text-lg font-bold text-blue-800">Situación del depósito según el sistema</h3>
                  <p className="text-xs text-blue-700/80 mt-1 font-medium">Incluye las caducadas (más de {maxDiasCfg} días) y marca cuáles ya se escanearon. Ordenadas de la más antigua a la más nueva.</p>
                </div>
                <div className="flex flex-col gap-2 items-end w-full md:w-auto">
                  <div className="flex flex-wrap items-center gap-2">
                    <select value={notifyActionType} onChange={(e) => setNotifyActionType(e.target.value)} className="text-sm border-slate-300 rounded shadow-sm py-1.5">
                      <option value="ESTADO">Avisar nuevamente (cambia el estado y reenvía el WhatsApp)</option>
                      <option value="EMAIL">Solo enviar email (no cambia el estado)</option>
                      <option value="ENTREGADO">Marcar como Entregado (ya salió del depósito sin pasar por el sistema)</option>
                    </select>
                    <button onClick={ejecutarAccionActivas} disabled={selectedOlvidadas.size === 0 || loading} className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white rounded text-sm font-bold shadow-sm">Ejecutar en {selectedOlvidadas.size} seleccionada{selectedOlvidadas.size === 1 ? '' : 's'}</button>
                    {selectedOlvidadas.size > 0 && <button onClick={() => setSelectedOlvidadas(new Set())} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 rounded text-sm">Quitar selección</button>}
                    <button onClick={() => exportToExcel(activasFiltradas.map(o => ({ Código: o.codigo, Cliente: o.cliente, Tipo: o.clienteTipo, Días: o.diasEnDeposito, Caducada: o.diasEnDeposito > maxDiasCfg ? 'SI' : '', Avisada: o.avisado == null ? '' : o.avisado ? 'SI' : 'NO', 'Fecha aviso': o.fechaAviso ? new Date(o.fechaAviso).toLocaleDateString('es-UY') : '', Pago: o.pagoEstado, Teléfono: o.clienteTelefono || '', Email: o.clienteEmail || '', Retiro: o.ordenRetiro, Estante: o.estante || '', Escaneada: escaneadasSet.has(o.codigo) ? 'SI' : 'NO' })), 'Ordenes_Deposito')} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded shadow-sm hover:bg-green-700"><Download size={16} /> Excel</button>
                  </div>
                  {notifyActionType === 'EMAIL' && (
                    <div className="w-full mt-1 bg-purple-50 p-3 rounded-lg border border-purple-100">
                      <label className="block text-xs font-bold text-purple-800 mb-1">Plantilla de Email (usa [CODIGO] para la orden)</label>
                      <textarea className="w-full text-sm p-2 border-slate-300 rounded focus:ring-purple-500 resize-y" rows="3" value={emailTemplate} onChange={(e) => setEmailTemplate(e.target.value)} />
                    </div>
                  )}
                </div>
              </div>
              {/* Filtros */}
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {/* Plazo en depósito: reloj rojo = caducadas · gris = todas · verde = en plazo */}
                <SwitchTriple valor={filtroPlazo} setValor={setFiltroPlazo} titulo={`Plazo en depósito (${maxDiasCfg} días)`}
                  izq={{ k: 'CADUCADAS', label: 'caducadas', n: filtradoActivas.caducadasN }} der={{ k: 'EN_PLAZO', label: 'en plazo', n: filtradoActivas.enPlazoN }}
                  iconos={{ izq: Clock, centro: Clock, der: Clock }} />
                {/* Switches: escaneo (QR) y aviso (campana). Izquierda = los que faltan, centro = todas, derecha = los que ya están */}
                <SwitchTriple valor={filtroEscaneo} setValor={setFiltroEscaneo} titulo="Escaneo"
                  izq={{ k: 'SIN_ESCANEAR', label: 'Sin escanear', n: filtradoActivas.sinEscanearN }} der={{ k: 'ESCANEADAS', label: 'Escaneadas', n: filtradoActivas.escaneadas }}
                  iconos={{ izq: QrCode, centro: QrCode, der: QrCode }} />
                <SwitchTriple valor={filtroAviso} setValor={setFiltroAviso} titulo="Aviso al cliente"
                  izq={{ k: 'SIN_AVISO', label: 'Sin aviso', n: filtradoActivas.sinAvisoN }} der={{ k: 'AVISADAS', label: 'Avisadas', n: filtradoActivas.avisadas }}
                  iconos={{ izq: BellOff, centro: Bell, der: Bell }} />
                {/* Situación de pago: un solo botón que recorre los estados */}
                {(() => {
                  const i = Math.max(0, PASOS_PAGO.findIndex(p => p.k === filtroPago));
                  const p = PASOS_PAGO[i]; const I = p.Icono;
                  return (
                    <button onClick={() => setFiltroPago(PASOS_PAGO[(i + 1) % PASOS_PAGO.length].k)} className={`inline-flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full border text-[11px] font-bold ${p.cls}`}
                      title="Situación de pago. Cada clic pasa al siguiente: todas → pagado → sin cobrar → facturado sin cobrar → sin facturar">
                      <I size={14} />{p.label}
                    </button>
                  );
                })()}
                <select value={prefijoActivas} onChange={e => setPrefijoActivas(e.target.value)} className="text-xs border-slate-300 rounded py-1">
                  <option value="">Todas las áreas</option>
                  {prefijosActivas.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <div className="relative"><Search size={14} className="absolute left-2 top-2 text-slate-400" /><input value={buscaActivas} onChange={e => setBuscaActivas(e.target.value)} placeholder="Código o cliente…" className="pl-7 pr-2 py-1 text-xs border border-slate-300 rounded w-48" /></div>
                <span className="text-xs text-slate-500">{activasFiltradas.length} de {conteoActivas.TODAS}</span>
              </div>
              {/* Señalética */}
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 mb-2">
                <span className="inline-flex items-center gap-1"><CheckCircle2 size={13} className="text-green-600" /> Pagado</span>
                <span className="inline-flex items-center gap-1"><CircleDollarSign size={13} className="text-amber-600" /> Sin cobrar</span>
                <span className="inline-flex items-center gap-1"><Receipt size={13} className="text-red-600" /> Facturado sin cobrar</span>
                <span className="inline-flex items-center gap-1"><Wallet size={13} className="text-blue-600" /> Sin facturar (cargo en cuenta corriente)</span>
                <span className="inline-flex items-center gap-1"><Bell size={13} className="text-green-600" /> Avisada (fecha)</span>
                <span className="inline-flex items-center gap-1"><BellOff size={13} className="text-red-600" /> Sin aviso</span>
                <span className="inline-flex items-center gap-1"><Clock size={13} className="text-red-600" /> Caducada</span>
                <span className="inline-flex items-center gap-1"><QrCode size={13} className="text-green-600" /> Escaneada</span>
                <span className="inline-flex items-center gap-1"><XCircle size={13} className="text-red-500" /> Sin escanear</span>
              </div>
              {activasFiltradas.length > 0 ? (
                <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-sm">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 text-[11px]">
                      <tr>
                        <th className="px-2 py-1.5 w-8 text-center"><input type="checkbox" checked={activasFiltradas.length > 0 && activasFiltradas.every(o => selectedOlvidadas.has(o.codigo))} onChange={e => { const s = new Set(selectedOlvidadas); activasFiltradas.forEach(o => (e.target.checked ? s.add(o.codigo) : s.delete(o.codigo))); setSelectedOlvidadas(s); }} title="Seleccionar todas las filtradas" /></th>
                        <th className="px-2 py-1.5">Código</th><th className="px-2 py-1.5">Días</th><th className="px-2 py-1.5">Cliente</th><th className="px-2 py-1.5">Contacto</th><th className="px-2 py-1.5">Aviso</th><th className="px-2 py-1.5">Pago</th><th className="px-2 py-1.5">Retiro</th><th className="px-2 py-1.5">Escaneo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activasFiltradas.map(o => {
                        const caducada = o.diasEnDeposito > maxDiasCfg;
                        return (
                          <tr key={o.codigo} className={`hover:bg-slate-50/70 ${selectedOlvidadas.has(o.codigo) ? 'bg-purple-50/40' : ''}`}>
                            <td className="px-2 py-1 text-center"><input type="checkbox" className="w-3.5 h-3.5 cursor-pointer rounded border-slate-300" checked={selectedOlvidadas.has(o.codigo)} onChange={() => handleToggleSet(o.codigo, setSelectedOlvidadas, selectedOlvidadas)} /></td>
                            <td className="px-2 py-1 font-mono font-bold text-blue-900 whitespace-nowrap">{o.codigo}{o.estante && <span className="ml-1 text-[10px] font-normal text-slate-400" title="Estante">{o.estante}</span>}</td>
                            <td className={`px-2 py-1 font-mono font-bold whitespace-nowrap ${caducada ? 'text-red-600' : 'text-slate-700'}`}><span className="inline-flex items-center gap-1">{caducada && <Clock size={12} />}{o.diasEnDeposito} d</span></td>
                            <td className="px-2 py-1 max-w-[190px]"><span className="block truncate" title={`${o.cliente || ''} (${o.clienteTipo})`}>{o.cliente} <span className="text-[9px] text-slate-500 bg-slate-100 px-1 rounded uppercase">{o.clienteTipo}</span></span></td>
                            <td className="px-2 py-1 text-[11px] text-slate-600 max-w-[230px]"><span className="flex items-center gap-1 whitespace-nowrap"><Phone size={11} className="text-slate-400 shrink-0" />{o.clienteTelefono || <span className="text-red-500">sin teléfono</span>}<Mail size={11} className="text-slate-400 ml-2 shrink-0" /><span className="truncate" title={o.clienteEmail || ''}>{o.clienteEmail || '—'}</span></span></td>
                            <td className="px-2 py-1 whitespace-nowrap"><AvisoIcono avisado={o.avisado} fecha={o.fechaAviso} /></td>
                            <td className="px-2 py-1"><PagoIcono estado={o.pagoEstado} /></td>
                            <td className="px-2 py-1 text-[11px] font-mono whitespace-nowrap" title={o.ordenRetiro}>{String(o.ordenRetiro || '').replace('ID: ', '')}</td>
                            <td className="px-2 py-1 whitespace-nowrap">{escaneadasSet.has(o.codigo) ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-green-700" title="Leída con la pistola"><QrCode size={14} /> Escaneada</span> : <span className="inline-flex items-center gap-1 text-[11px] text-red-500" title="Todavía no se leyó con la pistola"><XCircle size={13} /> Sin escanear</span>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : <EmptyState text={conteoActivas.TODAS ? 'No hay órdenes con este filtro.' : 'No hay órdenes en depósito según el sistema.'} />}
            </div>
          )}
          {/* REGISTRO DE CASOS (lista única y permanente) */}
          {activeTab === 'casos' && (
            <AuditDepositoCasosTab estado={estadoSesion} refreshKey={refreshCasos} onKpis={setKpisCasos} />
          )}

          {/* REPORTES (Fase 4): ejecutivo / completo, PDF por impresión y Excel multi-hoja */}
          {activeTab === 'reportes' && (
            <AuditDepositoReportesTab refreshKey={refreshCasos} />
          )}

          {/* CONTEO CÍCLICO (Fase 5): áreas por clase ABC, última auditoría y vencimiento */}
          {activeTab === 'ciclico' && (
            <AuditDepositoCiclicoTab estado={estadoSesion} refreshKey={refreshCasos} onChange={recargarTodo} />
          )}


        </div>
      </div>
    </div>
  );
}

// Subcomponente reciclable para tablas estandar
function TableRender({ data, columns, rowMap, hasSelection, selectedSet, onToggle }) {
  return (
    <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-sm">
      <table className="w-full text-left text-sm whitespace-nowrap">
        <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
          <tr>
            {hasSelection && <th className="px-4 py-3 w-10 text-center">Sel</th>}
            {columns.map(c => <th key={c} className="px-4 py-3">{c}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map((item, idx) => (
            <tr key={idx} className="hover:bg-slate-50/70 transition-colors">
              {hasSelection && (
                <td className="px-4 py-3 text-center">
                  <input
                    type="checkbox"
                    className="w-4 h-4 cursor-pointer text-indigo-600 focus:ring-indigo-500 rounded border-slate-300"
                    checked={selectedSet.has(item.codigo)}
                    onChange={() => onToggle(item.codigo)}
                  />
                </td>
              )}
              {rowMap(item).map((cellData, i) => (
                <td key={i} className="px-4 py-3">{cellData}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EmptyState({ text }) {
  return (
    <div className="py-12 flex flex-col items-center justify-center text-slate-400 bg-slate-50/50 rounded-xl border border-dashed border-slate-200 mt-2">
      <Search size={32} className="mb-3 opacity-50" />
      <p className="text-sm font-medium">{text}</p>
    </div>
  );
}
