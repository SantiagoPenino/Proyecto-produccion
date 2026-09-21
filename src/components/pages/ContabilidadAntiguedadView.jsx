/**
 * ContabilidadAntiguedadView.jsx
 * Reporte de antigüedad de deuda — tabla resumen de todos los clientes con saldo.
 * Tramos: Al día / 1-30d / 31-60d / 61-90d / +90d
 */

import React, { useState, useEffect, useCallback, Fragment } from 'react';
import { RefreshCw, Download, AlertTriangle, TrendingDown, Calendar, Users, Briefcase, ChevronDown, ChevronUp, FileText, Printer } from 'lucide-react';
import { toast } from 'sonner';

import api from '../../services/api';
import { generarPdfFacturaDGI } from '../../utils/pdfGenerator';
import { parsearNumeroOficialCfe } from '../../utils/numeroCfe';

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
    ? { nivel: 5, txt: `Vencida +30 d (${max} d)`, cls: 'bg-slate-800 text-white border-slate-800' }
    : { nivel: 4, txt: `Vencida (${max} d)`, cls: 'bg-rose-100 text-rose-700 border-rose-200' };
  if (Number(d.VenceHoy ?? 0) > 0) return { nivel: 3, txt: 'Vence hoy', cls: 'bg-rose-50 text-rose-600 border-rose-200' };
  const p = d.DiasProxVencimiento;
  if (p != null && p <= 3) return { nivel: 2, txt: `Vence en ${p} d`, cls: 'bg-orange-100 text-orange-700 border-orange-200' };
  if (p != null && p <= 7) return { nivel: 1, txt: `Vence en ${p} d`, cls: 'bg-amber-100 text-amber-700 border-amber-200' };
  return { nivel: 0, txt: p != null ? `Al día · vence en ${p} d` : 'Al día', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
};

// ── Semáforo de crédito: utilizado vs. límite aprobado (0–70 normal · 71–85 atención ·
//    86–99 cerca del límite · 100 alcanzado · +100 excedido). Sin límite cargado = no se evalúa.
const estadoCredito = (utilizado, limite) => {
  if (!(limite > 0)) return { nivel: -1, txt: 'sin límite', pct: null, cls: 'text-slate-400', bar: 'bg-slate-300' };
  const pct = utilizado / limite * 100;
  if (pct > 100)  return { nivel: 4, txt: `Excedido en ${fmt(utilizado - limite)}`, pct, cls: 'text-rose-700', bar: 'bg-rose-600' };
  if (pct >= 100) return { nivel: 3, txt: 'Límite alcanzado', pct, cls: 'text-rose-600', bar: 'bg-rose-500' };
  if (pct >= 86)  return { nivel: 2, txt: 'Cerca del límite', pct, cls: 'text-orange-600', bar: 'bg-orange-500' };
  if (pct >= 71)  return { nivel: 1, txt: 'Atención', pct, cls: 'text-amber-600', bar: 'bg-amber-400' };
  return { nivel: 0, txt: 'Normal', pct, cls: 'text-emerald-600', bar: 'bg-emerald-500' };
};

const COLOR_KPI = { emerald: 'text-emerald-500', amber: 'text-amber-500', orange: 'text-orange-500', rose: 'text-rose-500', indigo: 'text-indigo-500' };

// ── BARRA DE ANTIGÜEDAD ───────────────────────────────────────────────────────
const BarraAntiguedad = ({ alDia, d30, d60, d90, mas90, sym = '$U' }) => {
  const total = alDia + d30 + d60 + d90 + mas90;
  if (total === 0) return null;
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;
  return (
    <div className="flex h-1.5 rounded-full overflow-hidden gap-0.5 w-full bg-slate-50">
      {alDia > 0 && <div title={`Al día: ${sym} ${fmt(alDia)}`} style={{ width: pct(alDia) }} className="bg-emerald-500 rounded-full" />}
      {d30 > 0 && <div title={`1-30d: ${sym} ${fmt(d30)}`} style={{ width: pct(d30) }} className="bg-amber-400 rounded-full" />}
      {d60 > 0 && <div title={`31-60d: ${sym} ${fmt(d60)}`} style={{ width: pct(d60) }} className="bg-orange-500 rounded-full" />}
      {d90 > 0 && <div title={`61-90d: ${sym} ${fmt(d90)}`} style={{ width: pct(d90) }} className="bg-rose-500 rounded-full" />}
      {mas90 > 0 && <div title={`+90d: ${sym} ${fmt(mas90)}`} style={{ width: pct(mas90) }} className="bg-rose-700 rounded-full" />}
    </div>
  );
};

// embebido = true cuando se muestra dentro de Reportes de Contabilidad: esa página ya pone
// el título y el scroll, así que acá no se repite el encabezado ni el fondo/padding propio.
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
        await generarPdfFacturaDGI(data.doc, data.detalles || []);
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
      <div className="flex items-center gap-2 font-mono font-bold text-slate-700">
        <FileText size={14} className="text-slate-300" />
        <div>
          <div>{doc.CodigoOrden || `DOC #${doc.DDeIdDocumento}`}</div>
          <div className="font-sans text-[10px] font-bold uppercase tracking-wider text-slate-400">Sin documento (orden sin facturar)</div>
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
        className="p-1.5 rounded-lg border border-indigo-100 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 disabled:opacity-50 transition-colors"
      >
        {bajando ? <RefreshCw size={14} className="animate-spin" /> : <Printer size={14} />}
      </button>
      <div>
        <div className="font-mono font-bold text-slate-700">
          <span className="font-sans text-[10px] uppercase tracking-wider text-slate-500 mr-1.5">{doc.DocTipoReal || 'Documento'}</span>
          {interno || `#${doc.DocIdDocumento}`}
        </div>
        {oficial ? (
          <span className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
            DGI · Serie {oficial.serie} N° {oficial.numero}
          </span>
        ) : (
          <span className="inline-block mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">
            {doc.CfeEstado === 'ACEPTADO_DGI' ? 'DGI · aceptado (sin número guardado)' : 'No enviado a DGI'}
          </span>
        )}
      </div>
    </div>
  );
};

export default function ContabilidadAntiguedadView({ embebido = false }) {
  const [datos, setDatos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [modo, setModo] = useState('TODO'); // 'TODO' | 'OFICIAL' | 'WIP'
  const [ordenCol, setOrdenCol] = useState('TotalDeuda');
  const [ordenDir, setOrdenDir] = useState('desc');
  const [expanded, setExpanded] = useState({}); // { 'CliIdCliente-CueTipo': boolean }
  const [detallesDeuda, setDetallesDeuda] = useState({}); // { 'CliIdCliente': [documents] }
  const [loadingDetalles, setLoadingDetalles] = useState({});
  // Control de crédito: compara contra el límite LO MISMO que muestra la página según el
  // selector de arriba (Consolidado = todo lo pendiente · Solo Facturas · Solo Órdenes sin
  // facturar). Un único selector: tener otro propio acá se pisaba con ese (ej. "Solo Órdenes"
  // + "Solo facturado" daba utilizado 0 y escondía a los excedidos).
  const [fVendedor, setFVendedor] = useState('');
  const [soloCredito, setSoloCredito] = useState(false);   // solo clientes cerca / al límite / excedidos
  // Tipo de cambio para comparar la deuda de las dos monedas contra el único límite del
  // cliente: viene la cotización del día con el reporte y se puede pisar a mano.
  const [tc, setTc] = useState('');
  const [tcFecha, setTcFecha] = useState(null);

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
  const MODO_TXT = { TODO: 'todo lo pendiente (facturas + órdenes sin facturar)', OFICIAL: 'solo las facturas pendientes', WIP: 'solo las órdenes sin facturar' };
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

  const filtrados = datos
    .filter(d => !filtro || d.NombreCliente?.toLowerCase().includes(filtro.toLowerCase()))
    .filter(d => !fVendedor || d.Vendedor === fVendedor)
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
    const cols = ['Cliente', 'Vendedor', 'Condición', 'Alerta', 'Al Día', 'Vence hoy', 'Vence 1-7d', 'Vence 8-15d', 'Vence 16-30d', 'Vence +30d',
      '1-30d', '31-60d', '61-90d', '+90d', 'Total', 'Facturado', 'Sin facturar', 'Límite crédito', 'Moneda límite', 'Utilizado (moneda del límite)', '% límite', 'Estado crédito'];
    const q = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
    const rows = filtrados.map(d => {
      const c = creditoPorCliente[d.CliIdCliente] || {}, e = c.estado || estadoCredito(0, 0);
      return [q(d.NombreCliente), q(d.Vendedor), q(d.CondicionPago), q(alertaVenc(d).txt), d.AlDia, d.VenceHoy, d.Vence1_7, d.Vence8_15, d.Vence16_30, d.VenceMas30,
        d.Dias1_30, d.Dias31_60, d.Dias61_90, d.Mas90, d.TotalDeuda, d.DeudaFacturas ?? 0, d.DeudaOrdenes ?? 0,
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
    <th className={`px-4 py-4 text-left text-[11px] font-bold uppercase tracking-wider cursor-pointer select-none border-b border-slate-100 hover:text-indigo-400 transition-colors ${className}`}
      onClick={() => toggleOrden(col)}>
      <div className="flex items-center gap-1">
          {label}
          {ordenCol === col && <span className="text-indigo-500">{ordenDir === 'asc' ? '↑' : '↓'}</span>}
      </div>
    </th>
  );

  return (
    <div className={embebido ? 'text-slate-700 font-sans' : 'h-full bg-[#f1f5f9] p-4 sm:p-8 overflow-y-auto text-slate-700 font-sans custom-scrollbar'}>
      <div className="max-w-[1400px] mx-auto flex flex-col gap-6">

      {/* Encabezado (embebido: la página contenedora ya muestra el título) */}
      <div className={`flex flex-col sm:flex-row justify-between sm:items-center gap-4 ${embebido ? '' : 'mb-2'}`}>
        {embebido ? (
          <p className="text-slate-500 text-xs max-w-2xl">Deuda pendiente por cliente y moneda, en tramos de vencimiento. El selector de la derecha define qué deuda entra en toda la página (tarjetas, tabla y control de crédito).</p>
        ) : (
        <div>
          <h1 className="text-3xl sm:text-4xl font-black text-slate-800 flex items-center gap-3">
             <Calendar className="text-indigo-400" size={36} /> Antigüedad de Deuda
          </h1>
          <p className="text-slate-500 text-sm mt-2 max-w-2xl">
              Distribución interactiva de deuda pendiente segregada por tramos de vencimiento y clientes.
          </p>
        </div>
        )}
        <div className="flex items-center gap-3">
          <div className="flex bg-slate-200 p-1 rounded-xl shadow-inner mr-2">
            <button 
                onClick={() => setModo('TODO')} 
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${modo === 'TODO' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                Consolidado
            </button>
            <button 
                onClick={() => setModo('OFICIAL')} 
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${modo === 'OFICIAL' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                Solo Facturas
            </button>
            <button 
                onClick={() => setModo('WIP')} 
                className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${modo === 'WIP' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
            >
                Solo Órdenes (WIP)
            </button>
          </div>
          <button onClick={exportarCSV} className="flex items-center gap-2 px-4 py-2.5 text-sm bg-slate-50 hover:bg-slate-700 hover:text-white border border-slate-100 rounded-xl font-bold transition-all shadow-lg text-slate-600 w-fit group">
            <Download size={16} className="text-emerald-600 group-hover:text-emerald-400" /> Exportar a CSV
          </button>
          <button onClick={cargar} disabled={loading} className="flex items-center gap-2 px-5 py-2.5 text-sm bg-indigo-600 hover:bg-indigo-500 rounded-xl font-bold transition-all shadow-lg shadow-indigo-600/20 text-white disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Recargar Datos
          </button>
        </div>
      </div>

      {/* KPIs — dos bloques que NO se pisan: lo VENCIDO (4 tramos) y lo POR VENCER (5 tramos).
          Cada título lleva su total; vencido + por vencer = deuda total de la vista elegida. */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">
          Vencido · total $U {fmt(totalesUYU.TotalDeuda - totalesUYU.AlDia)} · US$ {fmt(totalesUSD.TotalDeuda - totalesUSD.AlDia)}
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Vencido 1–30 días',  key: 'Dias1_30',  color: 'amber' },
            { label: 'Vencido 31–60 días', key: 'Dias31_60', color: 'orange' },
            { label: 'Vencido 61–90 días', key: 'Dias61_90', color: 'rose' },
            { label: 'Crítico +90 días',   key: 'Mas90',     color: 'rose' },
          ].map(k => (
            <div key={k.key} className="bg-white rounded-2xl border border-slate-200 shadow-xl px-5 py-4 flex flex-col justify-between">
              <p className="text-xs text-slate-400 font-black uppercase tracking-wider">{k.label}</p>
              <div className="mt-2 flex flex-col gap-1">
                <p className={`text-lg font-black ${COLOR_KPI[k.color]} leading-none`}><span className="text-[10px] text-slate-400 mr-1">$U</span>{fmt(totalesUYU[k.key])}</p>
                <p className={`text-lg font-black ${COLOR_KPI[k.color]} leading-none`}><span className="text-[10px] text-slate-400 mr-1">US$</span>{fmt(totalesUSD[k.key])}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* POR VENCER: lo que todavía no venció, en tramos — qué hay que cobrar esta semana / este mes */}
      <div>
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2 ml-1">
          Por vencer (al día) · total $U {fmt(totalesUYU.AlDia)} · US$ {fmt(totalesUSD.AlDia)}
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            { label: 'Vence hoy',          key: 'VenceHoy',   color: 'rose' },
            { label: 'Vence en 1–7 días',  key: 'Vence1_7',   color: 'orange' },
            { label: 'Vence en 8–15 días', key: 'Vence8_15',  color: 'amber' },
            { label: 'Vence en 16–30 días',key: 'Vence16_30', color: 'indigo' },
            { label: 'Vence en +30 días',  key: 'VenceMas30', color: 'emerald' },
          ].map(k => (
            <div key={k.key} className="bg-white rounded-2xl border border-slate-200 shadow-xl px-5 py-4 flex flex-col justify-between">
              <p className="text-xs text-slate-400 font-black uppercase tracking-wider">{k.label}</p>
              <div className="mt-2 flex flex-col gap-1">
                <p className={`text-lg font-black ${COLOR_KPI[k.color]} leading-none`}><span className="text-[10px] text-slate-400 mr-1">$U</span>{fmt(totalesUYU[k.key])}</p>
                <p className={`text-lg font-black ${COLOR_KPI[k.color]} leading-none`}><span className="text-[10px] text-slate-400 mr-1">US$</span>{fmt(totalesUSD[k.key])}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* CONTROL DE CRÉDITO: utilizado vs. límite aprobado por cliente */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xl px-5 py-4 flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-[220px]">
          <p className="text-xs text-slate-400 font-black uppercase tracking-wider">Control de crédito</p>
          <p className="text-[11px] text-slate-500 mt-0.5">Todo lo que debe cada cliente, en $ y en US$ convertido al tipo de cambio, contra su único límite aprobado. El límite (y su moneda) y la condición de pago se cargan en la Vista 360 → pestaña "Límites". Solo alerta: no bloquea ventas.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">TC</span>
          <input type="number" min="0" step="0.01" value={tc} onChange={e => setTc(e.target.value)} title={tcFecha ? `Cotización del ${new Date(tcFecha).toLocaleDateString('es-UY')} — se puede pisar a mano` : 'Pesos por dólar'}
            className="w-24 text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:ring-2 focus:ring-indigo-400/30 outline-none tabular-nums" />
          <span className="text-[10px] text-slate-400">$ por US$</span>
        </div>
        <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5" title="Se cambia con el selector Consolidado / Solo Facturas / Solo Órdenes de arriba">
          Comparando contra el límite: <b>{MODO_TXT[modo]}</b>
        </div>
        {[
          { label: 'Excedidos',          n: resumenCredito.excedidos, cls: 'text-rose-600' },
          { label: 'Cerca / al límite',  n: resumenCredito.cerca,     cls: 'text-orange-600' },
          { label: 'Con límite cargado', n: resumenCredito.conLimite, cls: 'text-slate-700' },
          { label: 'Sin límite',         n: resumenCredito.sinLimite, cls: 'text-slate-400' },
        ].map(k => (
          <div key={k.label} className="flex flex-col">
            <span className={`text-xl font-black leading-none ${k.cls}`}>{k.n}</span>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{k.label}</span>
          </div>
        ))}
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer ml-auto">
          <input type="checkbox" checked={soloCredito} onChange={e => setSoloCredito(e.target.checked)} className="rounded" />
          Solo clientes cerca del límite o excedidos
        </label>
      </div>

      {/* Filtro + tabla */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden mt-4">
        <div className="px-6 py-4 border-b border-slate-200 flex flex-col sm:flex-row items-center gap-4 bg-white">
          <div className="flex bg-slate-50/80 border border-slate-100 px-4 py-2 text-slate-600 rounded-xl items-center gap-3 w-full sm:w-80 shadow-inner focus-within:border-indigo-500 transition-colors">
              <Users size={18} className="text-slate-400" />
              <input
                type="text"
                placeholder="Filtrar por nombre de cliente..."
                value={filtro}
                onChange={e => setFiltro(e.target.value)}
                className="w-full bg-transparent border-none outline-none placeholder-slate-500 text-sm"
              />
          </div>
          <span className="text-xs font-bold font-mono text-slate-400 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">{filtrados.length} RESULTADOS</span>
          {vendedores.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap sm:ml-auto">
              <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 mr-1">Vendedor</span>
              {['', ...vendedores].map(v => (
                <button key={v || 'todos'} onClick={() => setFVendedor(v)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-all ${fVendedor === v ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                  {v || 'Todos'}
                </button>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center py-24">
            <div className="animate-spin h-10 w-10 border-4 border-indigo-500 border-t-transparent rounded-full shadow-lg" />
          </div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full whitespace-nowrap">
              <thead className="bg-slate-50 text-slate-500 sticky top-0 z-10 shadow-sm">
                <tr>
                  <th className="px-6 py-4 text-left text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">Cliente / Cuenta</th>
                  <th className="px-4 py-4 text-left text-[11px] font-bold uppercase tracking-wider border-b border-slate-100">Alerta</th>
                  <ColHeader col="AlDia"      label="Al Día"    className="text-emerald-600" />
                  <ColHeader col="Dias1_30"   label="1-30 Días"     className="text-amber-600" />
                  <ColHeader col="Dias31_60"  label="31-60 Días"    className="text-orange-600" />
                  <ColHeader col="Dias61_90"  label="61-90 Días"    className="text-rose-600" />
                  <ColHeader col="Mas90"      label="+90 Días"      className="text-rose-600" />
                  <ColHeader col="TotalDeuda" label="Deuda Total"   className="text-indigo-600" />
                  <th className="px-4 py-4 text-left text-[11px] font-bold uppercase tracking-wider border-b border-slate-100" title={`Deuda del cliente en $ y US$ (${MODO_TXT[modo]}) convertida al TC, contra su límite aprobado`}>Crédito</th>
                  <th className="px-6 py-4 border-b border-slate-100 w-24">Acciones</th>
                  <th className="px-6 py-4 border-b border-slate-100 w-32" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100/80">
                {filtrados.map((d, index) => {
                  const key = `${d.CliIdCliente}-${d.CueTipo}`;
                  const isExpanded = !!expanded[key];
                  const docs = (detallesDeuda[d.CliIdCliente] || []).filter(doc => doc.CueTipo === d.CueTipo);
                  const sym = d.Moneda?.includes('USD') ? 'US$' : '$U';
                  
                  return (
                    <React.Fragment key={`${key}-${index}`}>
                      <tr className={`hover:bg-slate-50/50 transition-colors cursor-pointer ${isExpanded ? 'bg-slate-50/80' : ''}`} onClick={() => toggleExpand(d)}>
                        <td className="px-6 py-4">
                          <p className="text-sm font-bold text-slate-700 flex items-center gap-2">
                            {isExpanded ? <ChevronUp size={16} className="text-indigo-500" /> : <ChevronDown size={16} className="text-slate-400" />}
                            {d.NombreCliente}
                          </p>
                          <p className="text-[10px] font-mono font-bold text-slate-400 mt-1 uppercase bg-slate-100 inline-block px-1.5 rounded ml-6">{d.Moneda}</p>
                          {(d.Vendedor || d.CondicionPago) && (
                            <p className="text-[10px] text-slate-400 mt-1 ml-6">{d.Vendedor ? `Vendedor: ${d.Vendedor}` : ''}{d.Vendedor && d.CondicionPago ? ' · ' : ''}{d.CondicionPago ? `Condición: ${d.CondicionPago}` : ''}</p>
                          )}
                        </td>
                        <td className="px-4 py-4">
                          {(() => { const a = alertaVenc(d); return <span className={`text-[10px] font-bold uppercase px-2 py-1 rounded-md border whitespace-nowrap ${a.cls}`} title={`${d.DocsVencidos || 0} vencido(s) de ${d.DocsPendientes || 0} documento(s) pendiente(s)`}>{a.txt}</span>; })()}
                        </td>
                        <td className="px-4 py-4 text-sm font-semibold text-emerald-600/90">{d.AlDia > 0 ? `${sym} ${fmt(d.AlDia)}` : <span className="text-slate-700">—</span>}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-amber-600/90">{d.Dias1_30 > 0 ? `${sym} ${fmt(d.Dias1_30)}` : <span className="text-slate-700">—</span>}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-orange-600/90">{d.Dias31_60 > 0 ? `${sym} ${fmt(d.Dias31_60)}` : <span className="text-slate-700">—</span>}</td>
                        <td className="px-4 py-4 text-sm font-semibold text-rose-600/90">{d.Dias61_90 > 0 ? `${sym} ${fmt(d.Dias61_90)}` : <span className="text-slate-700">—</span>}</td>
                        <td className="px-4 py-4 text-sm font-black text-rose-500">{d.Mas90 > 0 ? `${sym} ${fmt(d.Mas90)}` : <span className="text-slate-700 font-normal">—</span>}</td>
                        <td className="px-4 py-4 text-sm font-black text-indigo-600 bg-indigo-50">{sym} {fmt(d.TotalDeuda)}</td>
                        <td className="px-4 py-4">
                          {(() => {
                            const c = creditoPorCliente[d.CliIdCliente], e = c?.estado || estadoCredito(0, 0);
                            if (!c || e.nivel < 0) return <span className="text-[11px] text-slate-400" title="Cargar el límite en la Vista 360 → pestaña Límites">sin límite cargado</span>;
                            const simL = c.moneda === 'USD' ? 'US$' : '$';
                            const dosMonedas = c.uyu > 0 && c.usd > 0;
                            return (
                              <div className="min-w-[190px]" title={`Deuda del cliente en las dos monedas: $ ${fmt(c.uyu)} + US$ ${fmt(c.usd)}${tcNum > 0 ? ` · TC ${fmt(tcNum)}` : ''}`}>
                                <p className={`text-[11px] font-bold ${e.cls}`}>{Math.round(e.pct)}% · {e.txt}{c.faltaTc ? ' · falta TC' : ''}</p>
                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mt-1"><div className={`h-full ${e.bar}`} style={{ width: `${Math.min(e.pct, 100)}%` }} /></div>
                                <p className="text-[10px] text-slate-400 mt-0.5">{simL} {fmt(c.utilizado)} de {simL} {fmt(c.limite)}{dosMonedas ? ` · $ ${fmt(c.uyu)} + US$ ${fmt(c.usd)}` : ''}</p>
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <button onClick={(e) => { e.stopPropagation(); toggleExpand(d); }} className="text-xs font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg border border-indigo-100 transition-colors">
                            {isExpanded ? 'Ocultar' : 'Detalles'}
                          </button>
                        </td>
                        <td className="px-6 py-4">
                          <BarraAntiguedad alDia={d.AlDia} d30={d.Dias1_30} d60={d.Dias31_60} d90={d.Dias61_90} mas90={d.Mas90} sym={sym} />
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr>
                          <td colSpan={11} className="p-0 bg-slate-50/50 border-b-2 border-slate-200">
                            <div className="px-12 py-6 bg-slate-100/50 shadow-inner">
                                {loadingDetalles[d.CliIdCliente] ? (
                                  <div className="flex items-center gap-3 text-sm text-slate-500 font-bold">
                                    <RefreshCw size={16} className="animate-spin text-indigo-500" /> Cargando documentos...
                                  </div>
                                ) : docs.length > 0 ? (
                                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                    <table className="w-full text-left whitespace-nowrap text-sm">
                                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                                        <tr>
                                          <th className="px-4 py-3">Documento</th>
                                          <th className="px-4 py-3">Detalle / Orden</th>
                                          <th className="px-4 py-3">Emisión</th>
                                          <th className="px-4 py-3">Vencimiento</th>
                                          <th className="px-4 py-3">Estado</th>
                                          <th className="px-4 py-3 text-right">Importe Orig.</th>
                                          <th className="px-4 py-3 text-right">Saldo Pendiente</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100">
                                        {docs.map(doc => (
                                          <React.Fragment key={doc.DDeIdDocumento}>
                                            <tr className="hover:bg-slate-50">
                                              <td className="px-4 py-3">
                                                <CeldaDocumento doc={doc} />
                                              </td>
                                              <td className="px-4 py-3">
                                                <div className="text-slate-600 truncate max-w-[250px] font-bold" title={doc.NombreTrabajo}>
                                                  {doc.NombreTrabajo || 'Sin descripción'}
                                                </div>
                                                {doc.CicSaldoFacturar !== undefined && doc.CicSaldoFacturar !== null && (
                                                  <div className="flex gap-2 mt-1.5 flex-wrap">
                                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                      Deudas: <span className="text-slate-700">{fmt(doc.CicTotalOrdenes || 0)}</span>
                                                    </span>
                                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                      Pagos: <span className="text-emerald-600">{fmt(doc.CicTotalPagos || 0)}</span>
                                                    </span>
                                                    <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100">
                                                      Facturado: <span className="font-black text-indigo-700">{fmt(doc.CicSaldoFacturar)}</span>
                                                    </span>
                                                  </div>
                                                )}
                                              </td>
                                              <td className="px-4 py-3 text-slate-500">
                                                {new Date(doc.DDeFechaEmision).toLocaleDateString('es-UY')}
                                              </td>
                                              <td className="px-4 py-3 text-slate-500 font-medium">
                                                {new Date(doc.DDeFechaVencimiento).toLocaleDateString('es-UY')}
                                              </td>
                                              <td className="px-4 py-3">
                                                {doc.DiasVencido > 0 ? (
                                                  <span className="text-[10px] font-bold uppercase px-2 py-1 bg-rose-100 text-rose-700 rounded-md">Vencido ({doc.DiasVencido} d)</span>
                                                ) : (
                                                  <span className="text-[10px] font-bold uppercase px-2 py-1 bg-emerald-100 text-emerald-700 rounded-md">No vencida</span>
                                                )}
                                              </td>
                                              <td className="px-4 py-3 text-right font-medium text-slate-500">
                                                <span className="text-slate-400 text-[10px] mr-1">{doc.MonSimbolo}</span>
                                                {fmt(doc.DDeImporteOriginal || doc.DDeImporteTotal || doc.DDeImportePendiente)}
                                              </td>
                                              <td className="px-4 py-3 text-right font-black text-slate-800">
                                                <span className="text-slate-400 text-xs font-normal mr-1">{doc.MonSimbolo}</span>
                                                {fmt(doc.DDeImportePendiente)}
                                              </td>
                                            </tr>
                                            {/* Con documento el detalle ya está en el PDF: la lista de órdenes solo va si no hay documento */}
                                            {!doc.DocIdDocumento && doc.SubOrdenes && doc.SubOrdenes.length > 0 && (
                                              <tr className="bg-slate-50/50">
                                                <td colSpan="7" className="px-8 py-3 border-t border-slate-100">
                                                  <div className="flex flex-col gap-1.5 ml-4 border-l-2 border-indigo-200 pl-4 py-1">
                                                    <span className="text-[10px] text-slate-400 font-black uppercase tracking-widest mb-1">Órdenes que componen esta factura:</span>
                                                    {doc.SubOrdenes.map(sub => (
                                                      <div key={sub.OrdIdOrden} className="flex justify-between items-center text-xs">
                                                        <div className="flex items-center gap-2">
                                                          <span className="font-mono font-bold text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded">{sub.CodigoOrden}</span>
                                                          <span className="text-slate-500">{sub.Concepto || 'Sin detalle'}</span>
                                                        </div>
                                                        <span className="font-bold text-slate-600">
                                                          <span className="text-slate-400 text-[10px] mr-1">{doc.MonSimbolo}</span>
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
                                ) : (
                                  <div className="flex items-center gap-2 text-sm text-amber-600 font-bold bg-amber-50 px-4 py-3 rounded-xl border border-amber-100 w-fit">
                                    <AlertTriangle size={18} /> No hay documentos pendientes para esta cuenta.
                                  </div>
                                )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {filtrados.length > 0 && (
                  <>
                    <tr className="bg-slate-50/80 font-black relative z-10">
                      <td className="px-6 py-3 text-xs text-slate-500 uppercase tracking-widest border-t-2 border-slate-100">Gran Total (UYU)</td>
                      <td className="px-4 py-3 border-t-2 border-slate-100" />
                      <td className="px-4 py-3 text-sm text-emerald-600 border-t-2 border-slate-100">$U {fmt(totalesUYU.AlDia)}</td>
                      <td className="px-4 py-3 text-sm text-amber-600 border-t-2 border-slate-100">$U {fmt(totalesUYU.Dias1_30)}</td>
                      <td className="px-4 py-3 text-sm text-orange-600 border-t-2 border-slate-100">$U {fmt(totalesUYU.Dias31_60)}</td>
                      <td className="px-4 py-3 text-sm text-rose-600 border-t-2 border-slate-100">$U {fmt(totalesUYU.Dias61_90)}</td>
                      <td className="px-4 py-3 text-sm text-rose-500 border-t-2 border-slate-100">$U {fmt(totalesUYU.Mas90)}</td>
                      <td className="px-4 py-3 text-sm text-indigo-600 border-t-2 border-slate-100 bg-indigo-50/50">$U {fmt(totalesUYU.TotalDeuda)}</td>
                      <td className="px-4 py-3 border-t-2 border-slate-100" />
                      <td className="px-4 py-3 border-t-2 border-slate-100" />
                      <td className="px-6 py-3 border-t-2 border-slate-100" />
                    </tr>
                    <tr className="bg-slate-50/80 font-black relative z-10">
                      <td className="px-6 py-3 text-xs text-slate-500 uppercase tracking-widest border-t border-slate-100">Gran Total (USD)</td>
                      <td className="px-4 py-3 border-t border-slate-100" />
                      <td className="px-4 py-3 text-sm text-emerald-600 border-t border-slate-100">US$ {fmt(totalesUSD.AlDia)}</td>
                      <td className="px-4 py-3 text-sm text-amber-600 border-t border-slate-100">US$ {fmt(totalesUSD.Dias1_30)}</td>
                      <td className="px-4 py-3 text-sm text-orange-600 border-t border-slate-100">US$ {fmt(totalesUSD.Dias31_60)}</td>
                      <td className="px-4 py-3 text-sm text-rose-600 border-t border-slate-100">US$ {fmt(totalesUSD.Dias61_90)}</td>
                      <td className="px-4 py-3 text-sm text-rose-500 border-t border-slate-100">US$ {fmt(totalesUSD.Mas90)}</td>
                      <td className="px-4 py-3 text-sm text-indigo-600 border-t border-slate-100 bg-indigo-50/50">US$ {fmt(totalesUSD.TotalDeuda)}</td>
                      <td className="px-4 py-3 border-t border-slate-100" />
                      <td className="px-4 py-3 border-t border-slate-100" />
                      <td className="px-6 py-3 border-t border-slate-100" />
                    </tr>
                  </>
                )}

                {filtrados.length === 0 && !loading && (
                  <tr>
                    <td colSpan={11} className="text-center py-20 text-slate-400">
                      <TrendingDown size={48} className="mx-auto mb-4 text-slate-700" />
                      <p className="text-lg">No hay cuentas por cobrar detectadas con los filtros actuales</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
