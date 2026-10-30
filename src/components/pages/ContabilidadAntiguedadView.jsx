/**
 * ContabilidadAntiguedadView.jsx
 * Reporte de antigüedad de deuda — tabla resumen de todos los clientes con saldo.
 * Tramos: Al día / 1-30d / 31-60d / 61-90d / +90d
 */

import React, { useState, useEffect, useCallback, Fragment } from 'react';
import { RefreshCw, Download, AlertTriangle, Calendar, ChevronDown, ChevronUp, FileText, Printer, Search, Loader2, SearchX } from 'lucide-react';
import { toast } from 'sonner';

import api from '../../services/api';
import { generarPdfComprobanteDGI } from '../../utils/pdfGenerator';
import { parsearNumeroOficialCfe } from '../../utils/numeroCfe';
import Selector from '../ui/Selector';

// Estética nueva (27/10/2026): encabezado, tarjetas, control de crédito, filtros con Selector, tabla clara (en el
// celular, una tarjeta por cuenta) y una sola escala de color para los tramos: al día verde, vencido de ámbar a
// magenta, por vencer de ámbar (hoy) a cian y verde (lejos). La lógica no cambió.

const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ROTULO = 'text-[10px] font-black uppercase tracking-widest text-zinc-400';
const TH = 'px-4 py-3 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400';
const CHIP = 'inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap';

const fetchAPI = async (url) => {
  try {
    const cleanUrl = url.startsWith('/api') ? url.replace('/api', '') : url;
    const res = await api.get(cleanUrl);
    return res.data;
  } catch (error) {
    if (error.response?.data) throw new Error(error.response.data.error || 'Error en la solicitud');
    throw error;
  }
};

// maximumFractionDigits: sin el tope, un importe con 4 decimales salía "84.422,271" y se leía como miles
const fmt = (n) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0));

// ── Semáforo de vencimiento por cliente (control de cobranzas) ───────────────
const alertaVenc = (d) => {
  const vencido = Number(d.Dias1_30 ?? 0) + Number(d.Dias31_60 ?? 0) + Number(d.Dias61_90 ?? 0) + Number(d.Mas90 ?? 0);
  const max = Number(d.MaxDiasVencido ?? 0);
  if (vencido > 0) return max > 30
    ? { nivel: 5, txt: `Vencida +30 d (${max} d)`, cls: 'bg-brand-magenta text-white border-brand-magenta' }
    : { nivel: 4, txt: `Vencida (${max} d)`, cls: 'bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20' };
  if (Number(d.VenceHoy ?? 0) > 0) return { nivel: 3, txt: 'Vence hoy', cls: 'bg-amber-100 text-amber-800 border-amber-300' };
  const p = d.DiasProxVencimiento;
  if (p != null && p <= 3) return { nivel: 2, txt: `Vence en ${p} d`, cls: 'bg-amber-50 text-amber-700 border-amber-200' };
  if (p != null && p <= 7) return { nivel: 1, txt: `Vence en ${p} d`, cls: 'bg-amber-50/60 text-amber-600 border-amber-100' };
  return { nivel: 0, txt: p != null ? `Al día · vence en ${p} d` : 'Al día', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
};

// ── Semáforo de crédito: utilizado vs. límite aprobado (0–70 normal · 71–85 atención ·
//    86–99 cerca del límite · 100 alcanzado · +100 excedido). Sin límite cargado = no se evalúa.
const estadoCredito = (utilizado, limite) => {
  if (!(limite > 0)) return { nivel: -1, txt: 'sin límite', pct: null, cls: 'text-zinc-400', bar: 'bg-zinc-300' };
  const pct = utilizado / limite * 100;
  if (pct > 100)  return { nivel: 4, txt: `Excedido en ${fmt(utilizado - limite)}`, pct, cls: 'text-brand-magenta', bar: 'bg-brand-magenta' };
  if (pct >= 100) return { nivel: 3, txt: 'Límite alcanzado', pct, cls: 'text-brand-magenta', bar: 'bg-brand-magenta/80' };
  if (pct >= 86)  return { nivel: 2, txt: 'Cerca del límite', pct, cls: 'text-amber-700', bar: 'bg-amber-500' };
  if (pct >= 71)  return { nivel: 1, txt: 'Atención', pct, cls: 'text-amber-600', bar: 'bg-amber-400' };
  return { nivel: 0, txt: 'Normal', pct, cls: 'text-emerald-600', bar: 'bg-emerald-500' };
};

// Escala de los tramos: punto de la tarjeta / columna y color del importe en la tabla
const TRAMO = {
  AlDia:      { punto: 'bg-emerald-500',        texto: 'text-zinc-700' },
  Dias1_30:   { punto: 'bg-amber-400',          texto: 'text-amber-700' },
  Dias31_60:  { punto: 'bg-amber-600',          texto: 'text-amber-700' },
  Dias61_90:  { punto: 'bg-brand-magenta/70',   texto: 'text-brand-magenta' },
  Mas90:      { punto: 'bg-brand-magenta',      texto: 'text-brand-magenta' },
  VenceHoy:   { punto: 'bg-amber-600' },
  Vence1_7:   { punto: 'bg-amber-400' },
  Vence8_15:  { punto: 'bg-brand-cyan' },
  Vence16_30: { punto: 'bg-brand-cyan/50' },
  VenceMas30: { punto: 'bg-emerald-500' },
};
const Punto = ({ tramo }) => <span className={`w-2 h-2 rounded-full shrink-0 ${TRAMO[tramo]?.punto || 'bg-zinc-300'}`} />;

// En el celular, tarjetas en vez de la tabla de 11 columnas (una vista sola: no se dibujan las dos ocultando una)
const MQ_TABLA = '(min-width: 768px)';
function useConTabla() {
  const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
  useEffect(() => {
    const mq = window.matchMedia(MQ_TABLA);
    const cambio = () => setConTabla(mq.matches);
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, []);
  return conTabla;
}

// ── BARRA DE ANTIGÜEDAD ───────────────────────────────────────────────────────
const BarraAntiguedad = ({ alDia, d30, d60, d90, mas90, sym = '$U' }) => {
  const total = alDia + d30 + d60 + d90 + mas90;
  if (total === 0) return null;
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden gap-0.5 w-full bg-zinc-100">
      {alDia > 0 && <div title={`Al día: ${sym} ${fmt(alDia)}`} style={{ width: pct(alDia) }} className={`${TRAMO.AlDia.punto} rounded-full`} />}
      {d30 > 0 && <div title={`1-30d: ${sym} ${fmt(d30)}`} style={{ width: pct(d30) }} className={`${TRAMO.Dias1_30.punto} rounded-full`} />}
      {d60 > 0 && <div title={`31-60d: ${sym} ${fmt(d60)}`} style={{ width: pct(d60) }} className={`${TRAMO.Dias31_60.punto} rounded-full`} />}
      {d90 > 0 && <div title={`61-90d: ${sym} ${fmt(d90)}`} style={{ width: pct(d90) }} className={`${TRAMO.Dias61_90.punto} rounded-full`} />}
      {mas90 > 0 && <div title={`+90d: ${sym} ${fmt(mas90)}`} style={{ width: pct(mas90) }} className={`${TRAMO.Mas90.punto} rounded-full`} />}
    </div>
  );
};

// Celda "Documento" del detalle por cliente: tipo + número interno, el número oficial
// si DGI lo aceptó, y el botón del PDF (mismo endpoint y generador que la Bandeja CFE).
const CeldaDocumento = ({ doc }) => {
  const [bajando, setBajando] = useState(false);
  const tieneDoc = !!doc.DocIdDocumento;
  const interno = [doc.DocSerie, doc.DocNumero].filter(Boolean).join('-');
  const oficial = parsearNumeroOficialCfe(doc);

  const verPdf = async (e) => {
    e.stopPropagation();
    if (bajando) return;
    setBajando(true);
    const toastId = toast.loading('Generando PDF...');
    try {
      const { data } = await api.get(`/contabilidad/cfe/documentos/${doc.DocIdDocumento}/detalle`);
      if (data && data.doc) {
        await generarPdfComprobanteDGI(data.doc, data.detalles || []);
        toast.success('PDF descargado', { id: toastId });
      } else {
        toast.error('No se encontró el documento', { id: toastId });
      }
    } catch (err) {
      toast.error('No se pudo generar el PDF: ' + (err.response?.data?.error || err.message), { id: toastId });
    } finally {
      setBajando(false);
    }
  };

  if (!tieneDoc) {
    return (
      <div className="flex items-center gap-2 font-mono font-bold text-zinc-700">
        <FileText size={14} className="text-zinc-300" />
        <div>
          <div>{doc.CodigoOrden || `DOC #${doc.DDeIdDocumento}`}</div>
          <div className="font-sans text-[10px] font-bold uppercase tracking-wider text-zinc-400">Sin documento (orden sin facturar)</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={verPdf}
        disabled={bajando}
        title="Imprimir / descargar el PDF de este documento"
        aria-label="PDF del documento"
        className="p-1.5 rounded-lg border border-zinc-200 bg-white text-brand-cyan hover:bg-brand-cyan/5 hover:border-brand-cyan/30 disabled:opacity-50 transition-colors"
      >
        {bajando ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />}
      </button>
      <div>
        <div className="font-mono font-bold text-zinc-700">
          <span className="font-sans text-[10px] uppercase tracking-wider text-zinc-500 mr-1.5">{doc.DocTipoReal || 'Documento'}</span>
          {interno || `#${doc.DocIdDocumento}`}
        </div>
        {oficial ? (
          <span className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
            DGI · Serie {oficial.serie} N° {oficial.numero}
          </span>
        ) : (
          <span className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-zinc-100 text-zinc-500">
            {doc.CfeEstado === 'ACEPTADO_DGI' ? 'DGI · aceptado (sin número guardado)' : 'No enviado a DGI'}
          </span>
        )}
      </div>
    </div>
  );
};

const EstadoDoc = ({ doc }) => doc.DiasVencido > 0
  ? <span className={`${CHIP} bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20`}>Vencido ({doc.DiasVencido} d)</span>
  : <span className={`${CHIP} bg-emerald-50 text-emerald-700 border-emerald-200`}>No vencida</span>;

// embebido = true cuando se muestra dentro de Reportes de Contabilidad: esa página ya pone
// el título y el scroll, así que acá no se repite el encabezado ni el fondo/padding propio.
export default function ContabilidadAntiguedadView({ embebido = false }) {
  const [datos, setDatos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState('');
  // Solo deuda de DOCUMENTOS emitidos (e-Ticket, e-Factura, Pedido Caja): las órdenes sueltas
  // sin documento no entran. Antes había un selector Consolidado / Solo Facturas / Solo Órdenes;
  // se sacó a pedido (08-oct-2026) y la página quedó fija en 'OFICIAL' (backend: DocIdDocumento IS NOT NULL).
  const modo = 'OFICIAL';
  const [ordenCol, setOrdenCol] = useState('TotalDeuda');
  const [ordenDir, setOrdenDir] = useState('desc');
  const [expanded, setExpanded] = useState({}); // { 'CliIdCliente-CueTipo': boolean }
  const [detallesDeuda, setDetallesDeuda] = useState({}); // { 'CliIdCliente': [documents] }
  const [loadingDetalles, setLoadingDetalles] = useState({});
  // Control de crédito: compara contra el límite LO MISMO que muestra la página (solo documentos).
  const [fVendedor, setFVendedor] = useState('');
  const [fTipoCliente, setFTipoCliente] = useState(''); // '' = todos · texto de TiposClientes · SIN_TIPO
  const [soloCredito, setSoloCredito] = useState(false);   // solo clientes cerca / al límite / excedidos
  // Tipo de cambio para comparar la deuda de las dos monedas contra el único límite del
  // cliente: viene la cotización del día con el reporte y se puede pisar a mano.
  const [tc, setTc] = useState('');
  const [tcFecha, setTcFecha] = useState(null);
  const conTabla = useConTabla();

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI(`/api/contabilidad/reportes/antiguedad-deuda?modo=${modo}`);
      setDatos(data.data || []);
      if (data.cotizacion?.dolar > 0) { setTc(v => v || String(data.cotizacion.dolar)); setTcFecha(data.cotizacion.fecha); }
      setExpanded({});
      setDetallesDeuda({});
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [modo]);

  useEffect(() => { cargar(); }, [cargar]);

  const toggleOrden = (col) => {
    if (ordenCol === col) setOrdenDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setOrdenCol(col); setOrdenDir('desc'); }
  };

  const toggleExpand = async (d) => {
    const key = `${d.CliIdCliente}-${d.CueTipo}`;
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

    if (!detallesDeuda[d.CliIdCliente] && !loadingDetalles[d.CliIdCliente]) {
      setLoadingDetalles(prev => ({ ...prev, [d.CliIdCliente]: true }));
      try {
        const res = await fetchAPI(`/api/contabilidad/clientes/${d.CliIdCliente}/deudas-vivas?modo=${modo}`);
        setDetallesDeuda(prev => ({ ...prev, [d.CliIdCliente]: res.data || [] }));
      } catch (e) {
        toast.error('Error cargando detalles');
      } finally {
        setLoadingDetalles(prev => ({ ...prev, [d.CliIdCliente]: false }));
      }
    }
  };

  const tcNum   = Number(String(tc).replace(',', '.')) || 0;
  const montoDe = (d) => Number(d.TotalDeuda ?? 0); // el backend ya filtró por el modo elegido
  const MODO_TXT = { OFICIAL: 'solo documentos emitidos (e-Ticket, e-Factura, Pedido Caja)' };
  const esUSDrow = (d) => String(d.Moneda || '').includes('USD');
  // Crédito por CLIENTE (no por fila): un límite en una moneda vs. la deuda de las dos
  // monedas convertida al TC. Las filas $ y US$ del mismo cliente muestran el mismo resultado.
  const creditoPorCliente = {};
  for (const d of datos) {
    const x = creditoPorCliente[d.CliIdCliente] = creditoPorCliente[d.CliIdCliente] || { limite: 0, moneda: 'UYU', uyu: 0, usd: 0 };
    if (Number(d.LimiteCredito) > 0 && !x.limite) { x.limite = Number(d.LimiteCredito); x.moneda = d.LimiteMoneda || 'UYU'; }
    if (esUSDrow(d)) x.usd += montoDe(d); else x.uyu += montoDe(d);
  }
  for (const x of Object.values(creditoPorCliente)) {
    x.utilizado = x.moneda === 'USD' ? x.usd + (tcNum > 0 ? x.uyu / tcNum : 0) : x.uyu + x.usd * tcNum;
    x.faltaTc = x.limite > 0 && !(tcNum > 0) && (x.moneda === 'USD' ? x.uyu > 0 : x.usd > 0);
    x.estado = estadoCredito(x.utilizado, x.limite);
  }
  const creditoDe   = (d) => creditoPorCliente[d.CliIdCliente]?.estado || estadoCredito(0, 0);
  const vendedores  = [...new Set(datos.map(d => d.Vendedor).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  // Tipo de cliente tal cual está en TiposClientes; los clientes sin tipo cargado van a "Sin tipo"
  const tipoDe = (d) => d.TipoCliente || 'SIN_TIPO';
  const tiposCliente = [...new Map(datos.map(d => [tipoDe(d), d.TipoClienteId ?? 99])).entries()]
    .sort((a, b) => a[1] - b[1]).map(([t]) => t);

  const filtrados = datos
    .filter(d => !filtro || d.NombreCliente?.toLowerCase().includes(filtro.toLowerCase()))
    .filter(d => !fVendedor || d.Vendedor === fVendedor)
    .filter(d => !fTipoCliente || tipoDe(d) === fTipoCliente)
    .filter(d => !soloCredito || creditoDe(d).nivel >= 2)
    .sort((a, b) => {
      const va = Number(a[ordenCol] ?? 0);
      const vb = Number(b[ordenCol] ?? 0);
      return ordenDir === 'asc' ? va - vb : vb - va;
    });

  const calcTotales = (filtroMoneda) => filtrados.filter(filtroMoneda).reduce((acc, d) => ({
    AlDia:     acc.AlDia     + Number(d.AlDia ?? 0),
    Dias1_30:  acc.Dias1_30  + Number(d.Dias1_30 ?? 0),
    Dias31_60: acc.Dias31_60 + Number(d.Dias31_60 ?? 0),
    Dias61_90: acc.Dias61_90 + Number(d.Dias61_90 ?? 0),
    Mas90:     acc.Mas90     + Number(d.Mas90 ?? 0),
    TotalDeuda:acc.TotalDeuda+ Number(d.TotalDeuda ?? 0),
    VenceHoy:  acc.VenceHoy  + Number(d.VenceHoy ?? 0),
    Vence1_7:  acc.Vence1_7  + Number(d.Vence1_7 ?? 0),
    Vence8_15: acc.Vence8_15 + Number(d.Vence8_15 ?? 0),
    Vence16_30:acc.Vence16_30+ Number(d.Vence16_30 ?? 0),
    VenceMas30:acc.VenceMas30+ Number(d.VenceMas30 ?? 0),
  }), { AlDia: 0, Dias1_30: 0, Dias31_60: 0, Dias61_90: 0, Mas90: 0, TotalDeuda: 0, VenceHoy: 0, Vence1_7: 0, Vence8_15: 0, Vence16_30: 0, VenceMas30: 0 });

  const totalesUYU = calcTotales(d => !d.Moneda?.includes('USD'));
  const totalesUSD = calcTotales(d => d.Moneda?.includes('USD'));

  // Resumen de crédito sobre lo filtrado: cuenta CLIENTES (una vez cada uno, aunque tenga fila en $ y en US$)
  const resumenCredito = [...new Set(filtrados.map(d => d.CliIdCliente))].reduce((acc, cli) => {
    const e = creditoPorCliente[cli]?.estado || estadoCredito(0, 0);
    if (e.nivel < 0) acc.sinLimite++; else acc.conLimite++;
    if (e.nivel === 4) acc.excedidos++;
    else if (e.nivel >= 2) acc.cerca++;
    return acc;
  }, { sinLimite: 0, conLimite: 0, excedidos: 0, cerca: 0 });

  const exportarCSV = () => {
    const cols = ['Cliente', 'Tipo de cliente', 'Vendedor', 'Condición', 'Moneda', 'Alerta', 'Al Día', 'Vence hoy', 'Vence 1-7d', 'Vence 8-15d', 'Vence 16-30d', 'Vence +30d',
      '1-30d', '31-60d', '61-90d', '+90d', 'Total documentos', 'Límite crédito', 'Moneda límite', 'Utilizado (moneda del límite)', '% límite', 'Estado crédito'];
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = filtrados.map(d => {
      const c = creditoPorCliente[d.CliIdCliente] || {}, e = c.estado || estadoCredito(0, 0);
      return [q(d.NombreCliente), q(d.TipoCliente || 'Sin tipo'), q(d.Vendedor), q(d.CondicionPago), q(d.Moneda), q(alertaVenc(d).txt), d.AlDia, d.VenceHoy, d.Vence1_7, d.Vence8_15, d.Vence16_30, d.VenceMas30,
        d.Dias1_30, d.Dias31_60, d.Dias61_90, d.Mas90, d.TotalDeuda,
        c.limite > 0 ? c.limite : '', c.limite > 0 ? c.moneda : '', c.limite > 0 ? (c.utilizado ?? 0).toFixed(2) : '',
        e.pct != null ? e.pct.toFixed(1) : '', q(e.txt)].join(',');
    });
    const csv = [cols.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `antiguedad_deuda_${new Date().toISOString().split('T')[0]}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const ColHeader = ({ col, label, className = '' }) => (
    <th className={`${TH} cursor-pointer select-none hover:text-zinc-700 transition-colors ${ordenCol === col ? 'text-zinc-700' : ''} ${className}`}
      onClick={() => toggleOrden(col)}>
      <div className="flex items-center gap-1.5">
          {TRAMO[col] && <Punto tramo={col} />}
          {label}
          {ordenCol === col && (ordenDir === 'asc' ? <ChevronUp size={12} className="text-brand-cyan" /> : <ChevronDown size={12} className="text-brand-cyan" />)}
      </div>
    </th>
  );

  // Importe de un tramo en la tabla: en el color del tramo; sin deuda, una raya gris
  const celdaTramo = (d, key, sym, extra = '') => Number(d[key]) > 0
    ? <td className={`px-4 py-3 text-sm font-semibold tabular-nums ${TRAMO[key].texto} ${extra}`}>{sym} {fmt(d[key])}</td>
    : <td className={`px-4 py-3 text-sm text-zinc-300 ${extra}`}>—</td>;

  const kpi = (label, k, ancho = '') => (
    <div className={`${CARD} px-4 py-3.5 flex flex-col gap-2 min-w-0 ${ancho}`}>
      <p className={`${ROTULO} flex items-center gap-2`}><Punto tramo={k} /> {label}</p>
      <div className="flex flex-col gap-0.5">
        <p className={`text-lg font-black leading-tight tabular-nums truncate ${totalesUYU[k] > 0 ? 'text-zinc-900' : 'text-zinc-300'}`}><span className="text-[10px] font-bold text-zinc-400 mr-1">$U</span>{fmt(totalesUYU[k])}</p>
        <p className={`text-sm font-black leading-tight tabular-nums truncate ${totalesUSD[k] > 0 ? 'text-zinc-700' : 'text-zinc-300'}`}><span className="text-[10px] font-bold text-zinc-400 mr-1">US$</span>{fmt(totalesUSD[k])}</p>
      </div>
    </div>
  );

  const creditoCliente = (d) => {
    const c = creditoPorCliente[d.CliIdCliente], e = c?.estado || estadoCredito(0, 0);
    if (!c || e.nivel < 0) return <span className="text-[11px] text-zinc-400" title="Cargar el límite en la Vista 360 → pestaña Límites">sin límite cargado</span>;
    const simL = c.moneda === 'USD' ? 'US$' : '$';
    const dosMonedas = c.uyu > 0 && c.usd > 0;
    return (
      <div className="min-w-[190px]" title={`Deuda del cliente en las dos monedas: $ ${fmt(c.uyu)} + US$ ${fmt(c.usd)}${tcNum > 0 ? ` · TC ${fmt(tcNum)}` : ''}`}>
        <p className={`text-[11px] font-bold ${e.cls}`}>{Math.round(e.pct)}% · {e.txt}{c.faltaTc ? ' · falta TC' : ''}</p>
        <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden mt-1"><div className={`h-full ${e.bar}`} style={{ width: `${Math.min(e.pct, 100)}%` }} /></div>
        <p className="text-[10px] text-zinc-400 mt-0.5 tabular-nums">{simL} {fmt(c.utilizado)} de {simL} {fmt(c.limite)}{dosMonedas ? ` · $ ${fmt(c.uyu)} + US$ ${fmt(c.usd)}` : ''}</p>
      </div>
    );
  };

  const alertaCliente = (d) => {
    const a = alertaVenc(d);
    return <span className={`${CHIP} uppercase tracking-wide text-[10px] ${a.cls}`} title={`${d.DocsVencidos || 0} vencido(s) de ${d.DocsPendientes || 0} documento(s) pendiente(s)`}>{a.txt}</span>;
  };

  // Documentos pendientes de una cuenta (tabla en escritorio, lista en el celular)
  const detalleDocumentos = (d, docs) => {
    if (loadingDetalles[d.CliIdCliente]) {
      return (
        <div className="flex items-center gap-2 text-sm text-zinc-500 font-bold">
          <Loader2 size={16} className="animate-spin text-brand-cyan" /> Cargando documentos...
        </div>
      );
    }
    if (docs.length === 0) {
      return (
        <div className="flex items-center gap-2 text-sm text-amber-700 font-bold bg-amber-50 px-4 py-3 rounded-xl border border-amber-200 w-fit">
          <AlertTriangle size={16} /> No hay documentos pendientes para esta cuenta.
        </div>
      );
    }
    if (!conTabla) {
      return (
        <div className="flex flex-col gap-2">
          {docs.map(doc => (
            <div key={doc.DDeIdDocumento} className="bg-white rounded-xl border border-zinc-200 p-3 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <CeldaDocumento doc={doc} />
                <EstadoDoc doc={doc} />
              </div>
              {doc.NombreTrabajo && <div className="text-xs font-bold text-zinc-600">{doc.NombreTrabajo}</div>}
              <div className="flex items-end justify-between gap-2 text-[11px] text-zinc-500">
                <span className="tabular-nums">Emitido {new Date(doc.DDeFechaEmision).toLocaleDateString('es-UY')} · vence {new Date(doc.DDeFechaVencimiento).toLocaleDateString('es-UY')}</span>
                <span className="text-sm font-black text-zinc-900 tabular-nums whitespace-nowrap"><span className="text-[10px] font-bold text-zinc-400 mr-1">{doc.MonSimbolo}</span>{fmt(doc.DDeImportePendiente)}</span>
              </div>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
        <table className="w-full text-left whitespace-nowrap text-sm">
          <thead className="bg-zinc-50 border-b border-zinc-200">
            <tr>
              <th className={TH}>Documento</th>
              <th className={TH}>Detalle / Orden</th>
              <th className={TH}>Emisión</th>
              <th className={TH}>Vencimiento</th>
              <th className={TH}>Estado</th>
              <th className={`${TH} text-right`}>Importe orig.</th>
              <th className={`${TH} text-right`}>Saldo pendiente</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {docs.map(doc => (
              <React.Fragment key={doc.DDeIdDocumento}>
                <tr className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <CeldaDocumento doc={doc} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-zinc-600 truncate max-w-[250px] font-bold" title={doc.NombreTrabajo}>
                      {doc.NombreTrabajo || 'Sin descripción'}
                    </div>
                    {doc.CicSaldoFacturar !== undefined && doc.CicSaldoFacturar !== null && (
                      <div className="flex gap-1.5 mt-1.5 flex-wrap">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
                          Deudas: <span className="text-zinc-700 tabular-nums">{fmt(doc.CicTotalOrdenes || 0)}</span>
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
                          Pagos: <span className="text-emerald-600 tabular-nums">{fmt(doc.CicTotalPagos || 0)}</span>
                        </span>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-brand-cyan bg-brand-cyan/10 px-1.5 py-0.5 rounded border border-brand-cyan/20">
                          Facturado: <span className="font-black tabular-nums">{fmt(doc.CicSaldoFacturar)}</span>
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 tabular-nums">
                    {new Date(doc.DDeFechaEmision).toLocaleDateString('es-UY')}
                  </td>
                  <td className="px-4 py-3 text-zinc-500 font-medium tabular-nums">
                    {new Date(doc.DDeFechaVencimiento).toLocaleDateString('es-UY')}
                  </td>
                  <td className="px-4 py-3"><EstadoDoc doc={doc} /></td>
                  <td className="px-4 py-3 text-right font-medium text-zinc-500 tabular-nums">
                    <span className="text-zinc-400 text-[10px] mr-1">{doc.MonSimbolo}</span>
                    {fmt(doc.DDeImporteOriginal || doc.DDeImporteTotal || doc.DDeImportePendiente)}
                  </td>
                  <td className="px-4 py-3 text-right font-black text-zinc-900 tabular-nums">
                    <span className="text-zinc-400 text-xs font-normal mr-1">{doc.MonSimbolo}</span>
                    {fmt(doc.DDeImportePendiente)}
                  </td>
                </tr>
                {/* Con documento el detalle ya está en el PDF: la lista de órdenes solo va si no hay documento */}
                {!doc.DocIdDocumento && doc.SubOrdenes && doc.SubOrdenes.length > 0 && (
                  <tr className="bg-zinc-50/60">
                    <td colSpan="7" className="px-8 py-3 border-t border-zinc-100">
                      <div className="flex flex-col gap-1.5 ml-4 border-l-2 border-brand-cyan/30 pl-4 py-1">
                        <span className={`${ROTULO} mb-1`}>Órdenes que componen esta factura:</span>
                        {doc.SubOrdenes.map(sub => (
                          <div key={sub.OrdIdOrden} className="flex justify-between items-center text-xs">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-zinc-600 bg-white border border-zinc-200 px-1.5 py-0.5 rounded">{sub.CodigoOrden}</span>
                              <span className="text-zinc-500">{sub.Concepto || 'Sin detalle'}</span>
                            </div>
                            <span className="font-bold text-zinc-600 tabular-nums">
                              <span className="text-zinc-400 text-[10px] mr-1">{doc.MonSimbolo}</span>
                              {fmt(sub.Importe)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const vacio = (
    <div className="flex flex-col items-center justify-center text-center py-16">
      <SearchX size={40} className="mb-3 text-brand-cyan" />
      <span className="text-sm font-bold text-zinc-700">No hay cuentas por cobrar con los filtros actuales</span>
      <span className="text-xs text-zinc-400 mt-1">Probá con otro cliente, vendedor o tipo de cliente.</span>
    </div>
  );

  return (
    <div className={embebido ? 'text-zinc-700' : 'px-3 sm:px-6 py-5 min-h-full text-zinc-700'}>
      <div className="flex flex-col gap-5">

      {/* Encabezado (embebido: la página contenedora ya muestra el título) */}
      <div className="flex flex-wrap items-center gap-3">
        {embebido ? (
          <p className="text-zinc-500 text-xs max-w-2xl flex-1 min-w-[240px]">Deuda pendiente por cliente y moneda, en tramos de vencimiento. <b className="text-zinc-600">Solo documentos emitidos</b> (e-Ticket, e-Factura, Pedido Caja): las órdenes que todavía no tienen documento no entran en las tarjetas, la tabla ni el control de crédito.</p>
        ) : (
          <>
            <Calendar size={30} className="text-brand-cyan shrink-0" />
            <div className="min-w-[240px] flex-1">
              <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Antigüedad de deuda</h1>
              <p className="text-sm text-zinc-500 mt-1 max-w-3xl">
                Deuda pendiente de documentos emitidos (e-Ticket, e-Factura, Pedido Caja) por tramos de vencimiento y clientes. Las órdenes sin documento no entran.
              </p>
            </div>
          </>
        )}
        <div className="flex items-center gap-2 w-full sm:w-auto sm:ml-auto">
          <button onClick={exportarCSV} className={`${BTN_SECUNDARIO} flex-1 sm:flex-none`}>
            <Download size={15} className="text-brand-cyan" /> Exportar a CSV
          </button>
          <button onClick={cargar} disabled={loading} className={`${BTN_PRINCIPAL} flex-1 sm:flex-none`}>
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Recargar
          </button>
        </div>
      </div>

      {/* KPIs — dos bloques que NO se pisan: lo VENCIDO (4 tramos) y lo POR VENCER (5 tramos).
          Cada título lleva su total; vencido + por vencer = deuda total de la vista elegida. */}
      <div>
        <p className={`${ROTULO} mb-2 px-1 tabular-nums`}>
          Vencido · total $U {fmt(totalesUYU.TotalDeuda - totalesUYU.AlDia)} · US$ {fmt(totalesUSD.TotalDeuda - totalesUSD.AlDia)}
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpi('Vencido 1–30 días', 'Dias1_30')}
          {kpi('Vencido 31–60 días', 'Dias31_60')}
          {kpi('Vencido 61–90 días', 'Dias61_90')}
          {kpi('Crítico +90 días', 'Mas90')}
        </div>
      </div>

      {/* POR VENCER: lo que todavía no venció, en tramos — qué hay que cobrar esta semana / este mes */}
      <div>
        <p className={`${ROTULO} mb-2 px-1 tabular-nums`}>
          Por vencer (al día) · total $U {fmt(totalesUYU.AlDia)} · US$ {fmt(totalesUSD.AlDia)}
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {kpi('Vence hoy', 'VenceHoy')}
          {kpi('Vence en 1–7 días', 'Vence1_7')}
          {kpi('Vence en 8–15 días', 'Vence8_15')}
          {kpi('Vence en 16–30 días', 'Vence16_30')}
          {kpi('Vence en +30 días', 'VenceMas30', 'col-span-2 lg:col-span-1')}
        </div>
      </div>

      {/* CONTROL DE CRÉDITO: utilizado vs. límite aprobado por cliente */}
      <div className={`${CARD} p-4 flex flex-col gap-4`}>
        <div>
          <p className={ROTULO}>Control de crédito</p>
          <p className="text-xs text-zinc-500 mt-1">Todo lo que debe cada cliente, en $ y en US$ convertido al tipo de cambio, contra su único límite aprobado. El límite (y su moneda) y la condición de pago se cargan en la Vista 360 → pestaña "Límites". Solo alerta: no bloquea ventas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <div className="flex items-center gap-2">
            <span className={ROTULO}>TC</span>
            <input type="number" min="0" step="0.01" value={tc} onChange={e => setTc(e.target.value)} aria-label="Tipo de cambio" title={tcFecha ? `Cotización del ${new Date(tcFecha).toLocaleDateString('es-UY')} — se puede pisar a mano` : 'Pesos por dólar'}
              className="w-24 px-3 py-1.5 bg-white border border-zinc-200 rounded-xl text-sm font-bold text-zinc-800 tabular-nums focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15" />
            <span className="text-[11px] text-zinc-400">$ por US$</span>
          </div>
          <div className="text-[11px] text-zinc-600 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-1.5" title="Las órdenes que todavía no tienen documento no suman al utilizado">
            Comparando contra el límite: <b>{MODO_TXT[modo]}</b>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {[
              { label: 'Excedidos',          n: resumenCredito.excedidos, cls: resumenCredito.excedidos ? 'text-brand-magenta' : 'text-zinc-300' },
              { label: 'Cerca / al límite',  n: resumenCredito.cerca,     cls: resumenCredito.cerca ? 'text-amber-600' : 'text-zinc-300' },
              { label: 'Con límite cargado', n: resumenCredito.conLimite, cls: 'text-zinc-900' },
              { label: 'Sin límite',         n: resumenCredito.sinLimite, cls: 'text-zinc-400' },
            ].map(k => (
              <div key={k.label} className="flex flex-col">
                <span className={`text-xl font-black leading-none tabular-nums ${k.cls}`}>{k.n}</span>
                <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider mt-1">{k.label}</span>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setSoloCredito(v => !v)} aria-pressed={soloCredito}
            className={`ml-auto inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-bold transition-colors ${soloCredito ? 'bg-brand-cyan/10 border-brand-cyan/30 text-brand-cyan' : 'bg-white border-zinc-200 text-zinc-600 hover:bg-zinc-50'}`}>
            <span className={`w-4 h-4 rounded border flex items-center justify-center ${soloCredito ? 'bg-brand-cyan border-brand-cyan text-white' : 'border-zinc-300 bg-white'}`}>
              {soloCredito && <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.5 2.5 4.5-5" /></svg>}
            </span>
            Solo clientes cerca del límite o excedidos
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className={`${CARD} p-4 grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end`}>
        <div className="col-span-2 md:flex-1 min-w-0 md:min-w-[220px]">
          <span className={`${ROTULO} block mb-1.5`}>Cliente</span>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Filtrar por nombre de cliente..."
              value={filtro}
              onChange={e => setFiltro(e.target.value)}
              aria-label="Filtrar por nombre de cliente"
              className={CAMPO}
            />
          </div>
        </div>
        {vendedores.length > 0 && (
          <div className="min-w-0 md:w-56">
            <span className={`${ROTULO} block mb-1.5`}>Vendedor</span>
            <Selector filtro className="w-full" value={fVendedor} onChange={e => setFVendedor(e.target.value)} aria-label="Vendedor" anchoLista={240}>
              <option value="">Todos</option>
              {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
            </Selector>
          </div>
        )}
        {tiposCliente.length > 0 && (
          <div className="min-w-0">
            <span className={`${ROTULO} block mb-1.5`}>Tipo de cliente</span>
            <div className="hidden md:inline-flex flex-wrap rounded-xl border border-zinc-200 bg-white p-1 gap-1">
              {['', ...tiposCliente].map(t => (
                <button key={t || 'todos'} onClick={() => setFTipoCliente(t)}
                  title={t ? `Mostrar solo clientes de tipo "${t === 'SIN_TIPO' ? 'sin tipo cargado' : t}" (afecta tarjetas, tabla y control de crédito)` : 'Mostrar todos los tipos de cliente'}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-colors whitespace-nowrap ${fTipoCliente === t ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>
                  {!t ? 'Todos' : t === 'SIN_TIPO' ? 'Sin tipo' : t}
                </button>
              ))}
            </div>
            <div className="md:hidden">
              <Selector filtro className="w-full" value={fTipoCliente} onChange={e => setFTipoCliente(e.target.value)} aria-label="Tipo de cliente">
                {['', ...tiposCliente].map(t => <option key={t || 'todos'} value={t}>{!t ? 'Todos' : t === 'SIN_TIPO' ? 'Sin tipo' : t}</option>)}
              </Selector>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-baseline justify-between gap-3 px-1 -mb-2">
        <h3 className={ROTULO}>Cuentas por cobrar</h3>
        {!loading && <span className="text-xs font-bold text-zinc-400 tabular-nums">{filtrados.length} resultado{filtrados.length !== 1 ? 's' : ''}</span>}
      </div>

      {loading ? (
        <div className={`${CARD} flex justify-center py-16`}>
          <span className="inline-flex items-center gap-2 text-sm text-zinc-400">
            <Loader2 size={18} className="animate-spin text-brand-cyan" /> Cargando deuda...
          </span>
        </div>
      ) : !conTabla ? (
        filtrados.length === 0 ? <div className={CARD}>{vacio}</div> : (
          <div className="flex flex-col gap-2.5">
            {filtrados.map((d, index) => {
              const key = `${d.CliIdCliente}-${d.CueTipo}`;
              const isExpanded = !!expanded[key];
              const docs = (detallesDeuda[d.CliIdCliente] || []).filter(doc => doc.CueTipo === d.CueTipo);
              const sym = d.Moneda?.includes('USD') ? 'US$' : '$U';
              const tramos = [['AlDia', 'Al día'], ['Dias1_30', '1-30 d'], ['Dias31_60', '31-60 d'], ['Dias61_90', '61-90 d'], ['Mas90', '+90 d']].filter(([k]) => Number(d[k]) > 0);
              return (
                <div key={`${key}-${index}`} className={`${CARD} p-3.5 flex flex-col gap-2.5`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-zinc-800">{d.NombreCliente}</div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        <span className="font-mono font-bold uppercase bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded mr-1.5">{d.Moneda}</span>
                        {[d.TipoCliente || 'sin tipo', d.Vendedor].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-black text-zinc-900 tabular-nums whitespace-nowrap">{sym} {fmt(d.TotalDeuda)}</div>
                      <div className="text-[10px] text-zinc-400">deuda total</div>
                    </div>
                  </div>
                  <div>{alertaCliente(d)}</div>
                  <BarraAntiguedad alDia={d.AlDia} d30={d.Dias1_30} d60={d.Dias31_60} d90={d.Dias61_90} mas90={d.Mas90} sym={sym} />
                  {tramos.length > 0 && (
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                      {tramos.map(([k, l]) => (
                        <div key={k} className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-1.5 text-zinc-500"><Punto tramo={k} /> {l}</span>
                          <span className={`font-semibold tabular-nums ${TRAMO[k].texto}`}>{fmt(d[k])}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-end justify-between gap-3 pt-2.5 border-t border-zinc-100">
                    <div className="min-w-0">{creditoCliente(d)}</div>
                    <button onClick={() => toggleExpand(d)}
                      className={`shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${isExpanded ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-200 hover:bg-zinc-100'}`}>
                      {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {isExpanded ? 'Ocultar' : 'Documentos'}
                    </button>
                  </div>
                  {isExpanded && detalleDocumentos(d, docs)}
                </div>
              );
            })}
            {filtrados.length > 0 && (
              <div className={`${CARD} p-3.5 flex flex-col gap-1.5 text-sm`}>
                <p className={ROTULO}>Gran total</p>
                <div className="flex justify-between font-black tabular-nums"><span className="text-zinc-500">$U</span><span className="text-zinc-900">{fmt(totalesUYU.TotalDeuda)}</span></div>
                <div className="flex justify-between font-black tabular-nums"><span className="text-zinc-500">US$</span><span className="text-zinc-900">{fmt(totalesUSD.TotalDeuda)}</span></div>
              </div>
            )}
          </div>
        )
      ) : (
      <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full whitespace-nowrap">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className={TH}>Cliente / Cuenta</th>
                  <th className={TH}>Alerta</th>
                  <ColHeader col="AlDia"      label="Al día" />
                  <ColHeader col="Dias1_30"   label="1-30 días" />
                  <ColHeader col="Dias31_60"  label="31-60 días" />
                  <ColHeader col="Dias61_90"  label="61-90 días" />
                  <ColHeader col="Mas90"      label="+90 días" />
                  <ColHeader col="TotalDeuda" label="Deuda total" className="bg-zinc-100/70" />
                  <th className={TH} title={`Deuda del cliente en $ y US$ (${MODO_TXT[modo]}) convertida al TC, contra su límite aprobado`}>Crédito</th>
                  <th className={`${TH} text-center w-24`}>Acciones</th>
                  <th className={`${TH} w-32`} />
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {filtrados.map((d, index) => {
                  const key = `${d.CliIdCliente}-${d.CueTipo}`;
                  const isExpanded = !!expanded[key];
                  const docs = (detallesDeuda[d.CliIdCliente] || []).filter(doc => doc.CueTipo === d.CueTipo);
                  const sym = d.Moneda?.includes('USD') ? 'US$' : '$U';

                  return (
                    <React.Fragment key={`${key}-${index}`}>
                      <tr className={`transition-colors cursor-pointer ${isExpanded ? 'bg-zinc-50' : 'hover:bg-zinc-50'}`} onClick={() => toggleExpand(d)}>
                        <td className="px-4 py-3">
                          <p className="text-sm font-bold text-zinc-800 flex items-center gap-2">
                            {isExpanded ? <ChevronUp size={16} className="text-brand-cyan" /> : <ChevronDown size={16} className="text-zinc-400" />}
                            {d.NombreCliente}
                          </p>
                          <p className="text-[10px] font-mono font-bold text-zinc-500 mt-1 uppercase bg-zinc-100 inline-block px-1.5 rounded ml-6">{d.Moneda}</p>
                          <p className="text-[10px] text-zinc-400 mt-1 ml-6">
                            {[`Tipo: ${d.TipoCliente || 'sin tipo'}`, d.Vendedor && `Vendedor: ${d.Vendedor}`, d.CondicionPago && `Condición: ${d.CondicionPago}`].filter(Boolean).join(' · ')}
                          </p>
                        </td>
                        <td className="px-4 py-3">{alertaCliente(d)}</td>
                        {celdaTramo(d, 'AlDia', sym)}
                        {celdaTramo(d, 'Dias1_30', sym)}
                        {celdaTramo(d, 'Dias31_60', sym)}
                        {celdaTramo(d, 'Dias61_90', sym)}
                        {celdaTramo(d, 'Mas90', sym, 'font-black')}
                        <td className="px-4 py-3 text-sm font-black text-zinc-900 bg-zinc-50 tabular-nums">{sym} {fmt(d.TotalDeuda)}</td>
                        <td className="px-4 py-3">{creditoCliente(d)}</td>
                        <td className="px-4 py-3 text-center">
                          <button onClick={(e) => { e.stopPropagation(); toggleExpand(d); }}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${isExpanded ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-200 hover:text-brand-cyan hover:border-brand-cyan/30 hover:bg-brand-cyan/5'}`}>
                            {isExpanded ? 'Ocultar' : 'Detalles'}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <BarraAntiguedad alDia={d.AlDia} d30={d.Dias1_30} d60={d.Dias31_60} d90={d.Dias61_90} mas90={d.Mas90} sym={sym} />
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={11} className="p-0 bg-zinc-50 border-b border-zinc-200">
                            <div className="px-10 py-5">
                              {detalleDocumentos(d, docs)}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {filtrados.length > 0 && (
                  <>
                    <tr className="bg-zinc-50 font-black">
                      <td className="px-4 py-3 text-[11px] text-zinc-500 uppercase tracking-widest border-t-2 border-zinc-200">Gran total (UYU)</td>
                      <td className="px-4 py-3 border-t-2 border-zinc-200" />
                      <td className={`px-4 py-3 text-sm tabular-nums border-t-2 border-zinc-200 ${TRAMO.AlDia.texto}`}>$U {fmt(totalesUYU.AlDia)}</td>
                      <td className={`px-4 py-3 text-sm tabular-nums border-t-2 border-zinc-200 ${TRAMO.Dias1_30.texto}`}>$U {fmt(totalesUYU.Dias1_30)}</td>
                      <td className={`px-4 py-3 text-sm tabular-nums border-t-2 border-zinc-200 ${TRAMO.Dias31_60.texto}`}>$U {fmt(totalesUYU.Dias31_60)}</td>
                      <td className={`px-4 py-3 text-sm tabular-nums border-t-2 border-zinc-200 ${TRAMO.Dias61_90.texto}`}>$U {fmt(totalesUYU.Dias61_90)}</td>
                      <td className={`px-4 py-3 text-sm tabular-nums border-t-2 border-zinc-200 ${TRAMO.Mas90.texto}`}>$U {fmt(totalesUYU.Mas90)}</td>
                      <td className="px-4 py-3 text-sm text-zinc-900 tabular-nums border-t-2 border-zinc-200 bg-zinc-100/70">$U {fmt(totalesUYU.TotalDeuda)}</td>
                      <td className="px-4 py-3 border-t-2 border-zinc-200" />
                      <td className="px-4 py-3 border-t-2 border-zinc-200" />
                      <td className="px-4 py-3 border-t-2 border-zinc-200" />
                    </tr>
                    <tr className="bg-zinc-50 font-black">
                      <td className="px-4 py-3 text-[11px] text-zinc-500 uppercase tracking-widest border-t border-zinc-100">Gran total (USD)</td>
                      <td className="px-4 py-3 border-t border-zinc-100" />
                      <td className={`px-4 py-3 text-sm tabular-nums border-t border-zinc-100 ${TRAMO.AlDia.texto}`}>US$ {fmt(totalesUSD.AlDia)}</td>
                      <td className={`px-4 py-3 text-sm tabular-nums border-t border-zinc-100 ${TRAMO.Dias1_30.texto}`}>US$ {fmt(totalesUSD.Dias1_30)}</td>
                      <td className={`px-4 py-3 text-sm tabular-nums border-t border-zinc-100 ${TRAMO.Dias31_60.texto}`}>US$ {fmt(totalesUSD.Dias31_60)}</td>
                      <td className={`px-4 py-3 text-sm tabular-nums border-t border-zinc-100 ${TRAMO.Dias61_90.texto}`}>US$ {fmt(totalesUSD.Dias61_90)}</td>
                      <td className={`px-4 py-3 text-sm tabular-nums border-t border-zinc-100 ${TRAMO.Mas90.texto}`}>US$ {fmt(totalesUSD.Mas90)}</td>
                      <td className="px-4 py-3 text-sm text-zinc-900 tabular-nums border-t border-zinc-100 bg-zinc-100/70">US$ {fmt(totalesUSD.TotalDeuda)}</td>
                      <td className="px-4 py-3 border-t border-zinc-100" />
                      <td className="px-4 py-3 border-t border-zinc-100" />
                      <td className="px-4 py-3 border-t border-zinc-100" />
                    </tr>
                  </>
                )}

                {filtrados.length === 0 && !loading && (
                  <tr>
                    <td colSpan={11}>{vacio}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
      </div>
      )}
      </div>
    </div>
  );
}
