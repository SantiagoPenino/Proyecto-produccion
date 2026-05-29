import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/apiClient';
import { FileText, X, Printer, TrendingUp, TrendingDown, RefreshCw, Layers, DollarSign, CheckCircle } from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d) => new Date(d).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' });

const CajaArqueoModal = ({ 
  onClose, 
  isAdmin = false,
  denominaciones,
  setDenominaciones,
  denominacionesUSD,
  setDenominacionesUSD,
  movimientos: movimientosProp = null,
  sesion: sesionProp = null
}) => {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState([]);
  const [sesion, setSesion] = useState(null);
  const [monedaArqueo, setMonedaArqueo] = useState('UYU'); // 'UYU' o 'USD'

  const fetchData = async () => {
    if (movimientosProp) {
      setData(movimientosProp);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const url = isAdmin ? '/contabilidad/caja/movimientos-turno?admin=true' : '/contabilidad/caja/movimientos-turno';
      const res = await api.get(url);
      if (res.data.success) {
        setData(res.data.movimientos || []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchSesion = async () => {
    if (sesionProp) {
      setSesion(sesionProp);
      return;
    }
    if (isAdmin) return; // Las cajas administrativas no tienen sesión activa
    try {
      const res = await api.get('/contabilidad/caja/sesion/actual');
      if (res.data?.sesion) {
        setSesion(res.data.sesion);
      }
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchData();
    fetchSesion();
  }, [isAdmin, movimientosProp, sesionProp]);

  // Agrupar y procesar totales
  const agrupado = useMemo(() => {
    const res = {};
    let saldoTotalUYU = 0;
    let saldoTotalUSD = 0;
    let cashIngressUYU = 0;
    let cashEgressUYU = 0;
    let cashIngressUSD = 0;
    let cashEgressUSD = 0;

    data.forEach(m => {
      const isEgreso = m.TipoOperacion === 'EGRESO';
      const fp = m.MedioDePago || 'INDEFINIDO';
      const isUSD = m.Moneda === 'USD';
      const isCash = /efectivo|contado/i.test(fp);

      if (!res[fp]) res[fp] = { UYU_in: 0, UYU_out: 0, USD_in: 0, USD_out: 0 };

      if (isEgreso) {
        if (isUSD) { 
          res[fp].USD_out += m.Salida; 
          saldoTotalUSD -= m.Salida; 
          if (isCash) cashEgressUSD += m.Salida;
        } else { 
          res[fp].UYU_out += m.Salida; 
          saldoTotalUYU -= m.Salida; 
          if (isCash) cashEgressUYU += m.Salida;
        }
      } else {
        if (isUSD) { 
          res[fp].USD_in += m.Entrada; 
          saldoTotalUSD += m.Entrada; 
          if (isCash) cashIngressUSD += m.Entrada;
        } else { 
          res[fp].UYU_in += m.Entrada; 
          saldoTotalUYU += m.Entrada; 
          if (isCash) cashIngressUYU += m.Entrada;
        }
      }
    });

    return { 
      porForma: res, 
      saldoUYU: saldoTotalUYU, 
      saldoUSD: saldoTotalUSD,
      cashIngress: cashIngressUYU,
      cashEgress: cashEgressUYU,
      cashIngressUSD,
      cashEgressUSD
    };
  }, [data]);

  // Total físico en pesos (denominaciones)
  const totalDenominaciones = useMemo(() => {
    return Object.entries(denominaciones || {}).reduce((acc, [den, cant]) => {
      return acc + (parseFloat(den) * (parseInt(cant, 10) || 0));
    }, 0);
  }, [denominaciones]);

  // Total físico en dólares (denominaciones USD)
  const totalDenominacionesUSD = useMemo(() => {
    return Object.entries(denominacionesUSD || {}).reduce((acc, [den, cant]) => {
      return acc + (parseFloat(den) * (parseInt(cant, 10) || 0));
    }, 0);
  }, [denominacionesUSD]);

  // Montos esperados en cajón de efectivo (pesos y dólares)
  const montoInicial = sesion ? (sesion.StuMontoInicial || 0) : 0;
  const expectedCashDrawer = montoInicial + agrupado.cashIngress - agrupado.cashEgress;
  const diferenciaArqueo = totalDenominaciones - expectedCashDrawer;

  const expectedCashDrawerUSD = agrupado.cashIngressUSD - agrupado.cashEgressUSD;
  const diferenciaArqueoUSD = totalDenominacionesUSD - expectedCashDrawerUSD;

  const handlePrint = () => {
    const win = window.open('', '_blank');
    const d = new Date().toLocaleString('es-UY');

    const groupedMovs = {};
    data.forEach(m => {
      const fp = (m.MedioDePago || 'INDEFINIDO') + ' | ' + m.Moneda;
      if (!groupedMovs[fp]) groupedMovs[fp] = [];
      groupedMovs[fp].push(m);
    });

    const detailedRowsHTML = Object.entries(groupedMovs).map(([fp, movs]) => {
      const rowsHtml = movs.map(m => {
        const inStr = m.Entrada > 0 ? `${m.Moneda} ${fmt(m.Entrada)}` : '-';
        const outStr = m.Salida > 0 ? `${m.Moneda} ${fmt(m.Salida)}` : '-';
        return `
        <tr>
          <td style="padding:6px 8px;font-size:11px">${fmtDate(m.Fecha)}</td>
          <td style="padding:6px 8px;font-weight:bold">${m.TipoOperacion}</td>
          <td style="padding:6px 8px">${m.TipoComprobante || ''} ${m.Comprobante || ''}</td>
          <td style="padding:6px 8px">${m.Concepto || ''}</td>
          <td style="padding:6px 8px">${m.Usuario || 'Sistema'}</td>
          <td style="padding:6px 8px;font-weight:bold;color:#065f46">${inStr}</td>
          <td style="padding:6px 8px;font-weight:bold;color:#991b1b">${outStr}</td>
        </tr>
      `}).join('');

      return `
        <tr>
          <td colspan="7" style="background:#e2e8f0; font-weight:bold; padding:8px 12px; font-size:13px; color:#1e293b;">
            MEDIO DE PAGO: <span style="color:#4338ca">${fp}</span>
          </td>
        </tr>
        ${rowsHtml}
      `;
    }).join('');

    const sumRows = Object.entries(agrupado.porForma).map(([k, v]) => `
      <tr>
        <td style="padding:6px 8px;font-weight:bold">${k}</td>
        <td style="padding:6px 8px;color:#065f46">UYU ${fmt(v.UYU_in)}</td>
        <td style="padding:6px 8px;color:#991b1b">UYU ${fmt(v.UYU_out)}</td>
        <td style="padding:6px 8px;font-weight:bold">UYU ${fmt(v.UYU_in - v.UYU_out)}</td>
        <td style="padding:6px 8px;color:#065f46">USD ${fmt(v.USD_in)}</td>
        <td style="padding:6px 8px;color:#991b1b">USD ${fmt(v.USD_out)}</td>
        <td style="padding:6px 8px;font-weight:bold">USD ${fmt(v.USD_in - v.USD_out)}</td>
      </tr>
    `).join('');

    // HTML del Desglose Físico UYU
    const desgloseHtmlRows = Object.entries(denominaciones || {})
      .filter(([_, cant]) => cant && parseInt(cant) > 0)
      .map(([den, cant]) => `
        <tr>
          <td style="padding:6px 8px;font-weight:bold;">$ ${den}</td>
          <td style="padding:6px 8px;text-align:center;">${cant}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:bold;">$ ${fmt(parseFloat(den) * parseInt(cant))}</td>
        </tr>
      `).join('');

    // HTML del Desglose Físico USD
    const desgloseUSDHtmlRows = Object.entries(denominacionesUSD || {})
      .filter(([_, cant]) => cant && parseInt(cant) > 0)
      .map(([den, cant]) => `
        <tr>
          <td style="padding:6px 8px;font-weight:bold;">U$S ${den}</td>
          <td style="padding:6px 8px;text-align:center;">${cant}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:bold;">U$S ${fmt(parseFloat(den) * parseInt(cant))}</td>
        </tr>
      `).join('');

    win.document.write(`<!DOCTYPE html><html><head>
      <title>Arqueo de Caja - Turno Actual</title>
      <style>
        body { font-family: sans-serif; padding: 20px; font-size:12px; }
        h1 { font-size: 18px; margin-bottom: 5px; }
        table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
        th, td { border: 1px solid #ccc; text-align: left; }
        th { background: #f0f0f0; padding:6px 8px; font-size:11px; }
        .s { font-size:16px; font-weight:bold; margin: 10px 0;}
        .card { padding: 12px; background: #eee; border: 1px solid #ccc; font-size: 13px; margin-bottom: 15px; }
      </style>
    </head><body>
      <h1>Arqueo Documentado de Caja ${isAdmin ? '(Caja Administrativa)' : '(Turno Actual)'}</h1>
      <p style="color:#666">Impreso: ${d}</p>
      
      <div class="s">RESUMEN POR FORMA DE PAGO</div>
      <table>
        <tr><th>Medio de Pago</th><th>Entrada UYU</th><th>Salida UYU</th><th>Saldo UYU</th><th>Entrada USD</th><th>Salida USD</th><th>Saldo USD</th></tr>
        ${sumRows}
      </table>
      
      <div class="card">
        <strong>SALDO FINAL NETO DEL TURNO:</strong> &nbsp;&nbsp;&nbsp; UYU ${fmt(agrupado.saldoUYU)} &nbsp;&nbsp;|&nbsp;&nbsp; USD ${fmt(agrupado.saldoUSD)}
      </div>

      <div style="display: flex; gap: 40px; margin-bottom: 20px;">
        <div>
          <div class="s">ARQUEO FÍSICO EFECTIVO UYU</div>
          <table style="width: 300px;">
            <thead>
              <tr style="background:#f0f0f0;"><th>Valor</th><th style="text-align:center;">Cantidad</th><th style="text-align:right;">Subtotal</th></tr>
            </thead>
            <tbody>
              ${desgloseHtmlRows || '<tr><td colspan="3" style="padding:6px 8px;text-align:center;color:#888;">Sin desglose UYU</td></tr>'}
              <tr style="background:#f8fafc;font-weight:bold;">
                <td colspan="2" style="padding:6px 8px;text-align:right;">Total Físico UYU:</td>
                <td style="padding:6px 8px;text-align:right;color:#0369a1;">$ ${fmt(totalDenominaciones)}</td>
              </tr>
              <tr style="font-weight:bold;">
                <td colspan="2" style="padding:6px 8px;text-align:right;">Esperado UYU:</td>
                <td style="padding:6px 8px;text-align:right;">$ ${fmt(expectedCashDrawer)}</td>
              </tr>
              <tr style="background:#e0f2fe;font-weight:bold;color:${diferenciaArqueo >= 0 ? '#0369a1' : '#b91c1c'};">
                <td colspan="2" style="padding:6px 8px;text-align:right;">Diferencia UYU:</td>
                <td style="padding:6px 8px;text-align:right;">$ ${diferenciaArqueo >= 0 ? '+' : ''}${fmt(diferenciaArqueo)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <div class="s">ARQUEO FÍSICO EFECTIVO USD</div>
          <table style="width: 300px;">
            <thead>
              <tr style="background:#f0f0f0;"><th>Valor</th><th style="text-align:center;">Cantidad</th><th style="text-align:right;">Subtotal</th></tr>
            </thead>
            <tbody>
              ${desgloseUSDHtmlRows || '<tr><td colspan="3" style="padding:6px 8px;text-align:center;color:#888;">Sin desglose USD</td></tr>'}
              <tr style="background:#f8fafc;font-weight:bold;">
                <td colspan="2" style="padding:6px 8px;text-align:right;">Total Físico USD:</td>
                <td style="padding:6px 8px;text-align:right;color:#0369a1;">U$S ${fmt(totalDenominacionesUSD)}</td>
              </tr>
              <tr style="font-weight:bold;">
                <td colspan="2" style="padding:6px 8px;text-align:right;">Esperado USD:</td>
                <td style="padding:6px 8px;text-align:right;">U$S ${fmt(expectedCashDrawerUSD)}</td>
              </tr>
              <tr style="background:#e0f2fe;font-weight:bold;color:${diferenciaArqueoUSD >= 0 ? '#0369a1' : '#b91c1c'};">
                <td colspan="2" style="padding:6px 8px;text-align:right;">Diferencia USD:</td>
                <td style="padding:6px 8px;text-align:right;">U$S ${diferenciaArqueoUSD >= 0 ? '+' : ''}${fmt(diferenciaArqueoUSD)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="s">DETALLE DE MOVIMIENTOS POR FORMA DE PAGO</div>
      <table>
        <tr><th>Fecha y Hora</th><th>Tipo</th><th>Comprobante</th><th>Rubro/Concepto</th><th>Usuario</th><th>Entrada</th><th>Salida</th></tr>
        ${detailedRowsHTML || '<tr><td colspan="7" style="padding:10px;text-align:center;">No hay movimientos registrados en este turno</td></tr>'}
      </table>
    </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 400);
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center font-sans">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      
      <div className="relative bg-white border border-slate-200 rounded-3xl w-[95%] max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95">
        
        {/* Encabezado */}
        <div className="flex items-center justify-between px-8 py-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-brand-cyan/10 flex items-center justify-center text-brand-cyan border border-brand-cyan/20 shadow-inner">
              <Layers size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-800 tracking-tight">Arqueo de Caja {isAdmin ? '(Administrativo)' : '(Turno Actual)'}</h2>
              <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest mt-1">Movimientos, agrupaciones y saldos de valores</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <button onClick={fetchData} className="p-2.5 bg-white text-slate-500 hover:text-slate-800 rounded-xl transition-all border border-slate-200 shadow-sm hover:shadow hover:-translate-y-0.5 active:scale-95">
              <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            </button>
            <button onClick={handlePrint} className="flex flex-row gap-2 px-5 py-2.5 bg-brand-cyan hover:bg-black text-white font-black rounded-xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 active:scale-95">
              <Printer size={18} /> IMPRIMIR ARCHIVO
            </button>
            <div className="w-px h-8 bg-slate-200 mx-1"></div>
            <button onClick={onClose} className="p-2.5 rounded-xl bg-brand-magenta/10 text-brand-magenta hover:bg-brand-magenta hover:text-white border border-brand-magenta/20 shadow-sm transition-all hover:-translate-y-0.5 active:scale-95">
              <X size={22} />
            </button>
          </div>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 overflow-auto p-8 space-y-8 bg-[#f1f5f9]">
          {loading ? (
             <div className="py-24 text-center text-slate-400 flex flex-col items-center"><RefreshCw className="animate-spin mb-4 text-amber-500" size={40} /> <span className="font-black text-sm tracking-widest uppercase">Cargando movimientos...</span></div>
          ) : (
            <div className="flex flex-col gap-8">
              
              {/* Layout Side-by-Side: Totales y Grilla en 2 Columnas */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                
                {/* LADO IZQUIERDO: Saldos y Agrupación (7 columnas) */}
                <div className="lg:col-span-7 flex flex-col gap-6">
                  
                  {/* Tarjetas de Saldos Netos del Turno */}
                  <div className="grid grid-cols-2 gap-6">
                    <div className="bg-white border-2 border-emerald-100 rounded-3xl p-6 flex justify-between items-center shadow-sm">
                      <div>
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Saldo Neto Turno UYU</h3>
                        <p className="text-3xl font-black text-emerald-600 tracking-tighter">UYU {fmt(agrupado.saldoUYU)}</p>
                      </div>
                      <Layers className="text-emerald-100" size={54} />
                    </div>
                    <div className="bg-white border-2 border-emerald-100 rounded-3xl p-6 flex justify-between items-center shadow-sm">
                      <div>
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Saldo Neto Turno USD</h3>
                        <p className="text-3xl font-black text-emerald-600 tracking-tighter">USD {fmt(agrupado.saldoUSD)}</p>
                      </div>
                      <Layers className="text-emerald-100" size={54} />
                    </div>
                  </div>

                  {/* Tabla de Agrupaciones por Medio de Pago */}
                  <div className="bg-white rounded-3xl border border-slate-200 shadow-sm p-6">
                     <h4 className="text-slate-800 font-black mb-4 flex items-center gap-2 tracking-tight text-base"><FileText size={18} className="text-brand-cyan"/> Resumen por Medio de Pago</h4>
                     <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                           <thead>
                             <tr className="text-slate-400 uppercase text-[9px] tracking-widest border-b-2 border-slate-100">
                               <th className="pb-3 text-left font-black">Medio</th>
                               <th className="pb-3 text-right font-black">UYU (Entra)</th>
                               <th className="pb-3 text-right font-black text-brand-magenta">UYU (Sale)</th>
                               <th className="pb-3 text-right font-black text-slate-800 bg-slate-50 px-2 rounded-t-xl">Neto UYU</th>
                               <th className="pb-3 text-right font-black">USD (Entra)</th>
                               <th className="pb-3 text-right font-black text-brand-magenta">USD (Sale)</th>
                               <th className="pb-3 text-right font-black text-slate-800 bg-slate-50 px-2 rounded-t-xl">Neto USD</th>
                             </tr>
                           </thead>
                           <tbody className="divide-y divide-slate-100">
                             {Object.keys(agrupado.porForma).length === 0 ? (
                               <tr>
                                 <td colSpan="7" className="py-8 text-center text-slate-400 font-bold">No hay transacciones registradas.</td>
                               </tr>
                             ) : (
                               Object.entries(agrupado.porForma).map(([kp, v], i) => (
                                  <tr key={i} className="hover:bg-slate-50 transition-colors">
                                    <td className="py-3 font-black text-brand-cyan">{kp}</td>
                                    <td className="py-3 text-right text-slate-600 font-mono font-bold">{fmt(v.UYU_in)}</td>
                                    <td className="py-3 text-right text-brand-magenta font-mono font-bold">{fmt(v.UYU_out)}</td>
                                    <td className="py-3 text-right text-slate-800 font-black font-mono bg-slate-50 px-2">{fmt(v.UYU_in - v.UYU_out)}</td>
                                    <td className="py-3 text-right text-slate-600 font-mono font-bold">{fmt(v.USD_in)}</td>
                                    <td className="py-3 text-right text-brand-magenta font-mono font-bold">{fmt(v.USD_out)}</td>
                                    <td className="py-3 text-right text-slate-800 font-black font-mono bg-slate-50 px-2">{fmt(v.USD_in - v.USD_out)}</td>
                                  </tr>
                               ))
                             )}
                           </tbody>
                        </table>
                     </div>
                  </div>

                </div>

                {/* LADO DERECHO: Desglose de Caja Físico (5 columnas, solo visible en turnos normales) */}
                <div className="lg:col-span-5 bg-white rounded-3xl border border-slate-200 p-6 shadow-sm flex flex-col gap-5 self-start">
                  
                  <div className="flex flex-col gap-3 border-b border-slate-100 pb-3">
                    <div className="flex justify-between items-center">
                      <h3 className="font-black text-slate-800 flex items-center gap-2.5 text-base">
                        <DollarSign size={20} className="text-brand-cyan" />
                        Arqueo Físico en Cajón
                      </h3>
                      <span className="text-sm font-black text-brand-cyan tracking-tight bg-brand-cyan/5 px-3 py-1 rounded-lg border border-brand-cyan/25">
                        {monedaArqueo === 'UYU' ? `$ ${fmt(totalDenominaciones)}` : `U$S ${fmt(totalDenominacionesUSD)}`}
                      </span>
                    </div>

                    {/* Selector de Moneda de Arqueo */}
                    <div className="flex bg-slate-100 rounded-xl p-1 border border-slate-200 select-none self-start gap-1">
                      <button
                        type="button"
                        onClick={() => setMonedaArqueo('UYU')}
                        className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                          monedaArqueo === 'UYU' ? 'bg-[#006097] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        Pesos (UYU)
                      </button>
                      <button
                        type="button"
                        onClick={() => setMonedaArqueo('USD')}
                        className={`px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg transition-all ${
                          monedaArqueo === 'USD' ? 'bg-[#006097] text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        Dólares (USD)
                      </button>
                    </div>
                  </div>

                  <>
                    {monedaArqueo === 'UYU' ? (
                      <>
                        {/* Billetes UYU */}
                        <div className="space-y-3">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-1">Billetes (Pesos UYU)</p>
                          <div className="grid grid-cols-2 gap-2.5">
                            {[2000, 1000, 500, 200, 100, 50, 20].map(den => (
                              <div key={den} className="flex items-center gap-2 bg-slate-50 p-1.5 px-3 rounded-xl border border-slate-200 focus-within:border-brand-cyan focus-within:ring-2 focus-within:ring-brand-cyan/10 focus-within:bg-white transition-all shadow-inner">
                                <span className="text-xs font-black text-emerald-700 w-10">${den}</span>
                                <span className="text-slate-300 font-bold text-xs">x</span>
                                <input 
                                  type="number" 
                                  min="0" 
                                  value={denominaciones[den] || ''} 
                                  onChange={e => setDenominaciones(p => ({ ...p, [den]: e.target.value }))} 
                                  placeholder="0" 
                                  className="w-full bg-transparent text-xs font-black text-slate-800 outline-none text-right" 
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Monedas UYU */}
                        <div className="space-y-3">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-1">Monedas (Pesos UYU)</p>
                          <div className="grid grid-cols-2 gap-2.5">
                            {[50, 10, 5, 2, 1].map(den => (
                              <div key={den} className="flex items-center gap-2 bg-slate-50 p-1.5 px-3 rounded-xl border border-slate-200 focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/10 focus-within:bg-white transition-all shadow-inner">
                                <span className="text-xs font-black text-amber-700 w-10">${den}</span>
                                <span className="text-slate-300 font-bold text-xs">x</span>
                                <input 
                                  type="number" 
                                  min="0" 
                                  value={denominaciones[den] || ''} 
                                  onChange={e => setDenominaciones(p => ({ ...p, [den]: e.target.value }))} 
                                  placeholder="0" 
                                  className="w-full bg-transparent text-xs font-black text-slate-800 outline-none text-right" 
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Tarjeta de Comparación / Diferencia UYU */}
                        <div className={`p-4 rounded-2xl border flex flex-col gap-2 mt-2 shadow-sm animate-in zoom-in-95 duration-300 ${
                          Math.abs(diferenciaArqueo) < 2 
                            ? 'bg-emerald-50/50 border-emerald-200 text-emerald-800' 
                            : diferenciaArqueo > 0 
                              ? 'bg-sky-50 border-sky-200 text-sky-800' 
                              : 'bg-rose-50 border-rose-200 text-rose-800'
                        }`}>
                          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                            <span>Monto Inicial Apertura:</span>
                            <span className="font-mono">$ {fmt(montoInicial)}</span>
                          </div>
                          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest border-b border-slate-200/50 pb-2">
                            <span>Efectivo Esperado (UYU):</span>
                            <span className="font-mono">$ {fmt(expectedCashDrawer)}</span>
                          </div>
                          <div className="flex justify-between items-center pt-1">
                            <div className="flex items-center gap-2">
                              {Math.abs(diferenciaArqueo) < 2 ? (
                                <CheckCircle size={20} className="text-emerald-500 shrink-0" />
                              ) : diferenciaArqueo > 0 ? (
                                <TrendingUp size={20} className="text-sky-500 shrink-0" />
                              ) : (
                                <TrendingDown size={20} className="text-rose-500 shrink-0" />
                              )}
                              <span className="text-xs font-black uppercase tracking-wide">
                                {Math.abs(diferenciaArqueo) < 2 ? 'CAJA BALANCEADA' : diferenciaArqueo > 0 ? 'SOBRANTE UYU' : 'FALTANTE UYU'}
                              </span>
                            </div>
                            <span className="text-xl font-black font-mono">
                              {diferenciaArqueo > 0 ? '+' : ''}{fmt(diferenciaArqueo)}
                            </span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        {/* Billetes USD */}
                        <div className="space-y-3">
                          <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 pb-1">Billetes (Dólares USD)</p>
                          <div className="grid grid-cols-2 gap-2.5">
                            {[100, 50, 20, 10, 5, 2, 1].map(den => (
                              <div key={den} className="flex items-center gap-2 bg-slate-50 p-1.5 px-3 rounded-xl border border-slate-200 focus-within:border-brand-cyan focus-within:ring-2 focus-within:ring-brand-cyan/10 focus-within:bg-white transition-all shadow-inner">
                                <span className="text-xs font-black text-emerald-700 w-10">U$S{den}</span>
                                <span className="text-slate-300 font-bold text-xs">x</span>
                                <input 
                                  type="number" 
                                  min="0" 
                                  value={denominacionesUSD[den] || ''} 
                                  onChange={e => setDenominacionesUSD(p => ({ ...p, [den]: e.target.value }))} 
                                  placeholder="0" 
                                  className="w-full bg-transparent text-xs font-black text-slate-800 outline-none text-right" 
                                />
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Tarjeta de Comparación / Diferencia USD */}
                        <div className={`p-4 rounded-2xl border flex flex-col gap-2 mt-2 shadow-sm animate-in zoom-in-95 duration-300 ${
                          Math.abs(diferenciaArqueoUSD) < 0.05
                            ? 'bg-emerald-50/50 border-emerald-200 text-emerald-800' 
                            : diferenciaArqueoUSD > 0 
                              ? 'bg-sky-50 border-sky-200 text-sky-800' 
                              : 'bg-rose-50 border-rose-200 text-rose-800'
                        }`}>
                          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest">
                            <span>Monto Inicial Apertura:</span>
                            <span className="font-mono">U$S 0,00</span>
                          </div>
                          <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest border-b border-slate-200/50 pb-2">
                            <span>Efectivo Esperado (USD):</span>
                            <span className="font-mono">U$S {fmt(expectedCashDrawerUSD)}</span>
                          </div>
                          <div className="flex justify-between items-center pt-1">
                            <div className="flex items-center gap-2">
                              {Math.abs(diferenciaArqueoUSD) < 0.05 ? (
                                <CheckCircle size={20} className="text-emerald-500 shrink-0" />
                              ) : diferenciaArqueoUSD > 0 ? (
                                <TrendingUp size={20} className="text-sky-500 shrink-0" />
                              ) : (
                                <TrendingDown size={20} className="text-rose-500 shrink-0" />
                              )}
                              <span className="text-xs font-black uppercase tracking-wide">
                                {Math.abs(diferenciaArqueoUSD) < 0.05 ? 'CAJA BALANCEADA' : diferenciaArqueoUSD > 0 ? 'SOBRANTE USD' : 'FALTANTE USD'}
                              </span>
                            </div>
                            <span className="text-xl font-black font-mono">
                              {diferenciaArqueoUSD > 0 ? '+' : ''}{fmt(diferenciaArqueoUSD)}
                            </span>
                          </div>
                        </div>
                      </>
                    )}
                  </>

                </div>

              </div>

              {/* Detalle Cronológico Analítico (Full Width) */}
              <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="px-6 py-5 bg-slate-50 border-b border-slate-200">
                  <h4 className="text-slate-800 font-black flex items-center gap-2 tracking-tight text-base">Detalle Analítico de Movimientos del Turno</h4>
                </div>
                 <div className="overflow-x-auto max-h-[350px] custom-scrollbar">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-white z-10 shadow-sm border-b border-slate-100">
                        <tr className="text-slate-400 uppercase text-[9px] tracking-widest">
                          <th className="p-3 px-6 text-left w-32 font-black">Fecha Hora</th>
                          <th className="p-3 text-center font-black">Tipo</th>
                          <th className="p-3 text-left font-black">Nº Comprobante / Doc</th>
                          <th className="p-3 text-left font-black">Rubro / Concepto</th>
                          <th className="p-3 text-left font-black">Usuario</th>
                          <th className="p-3 text-right font-black">Entrada</th>
                          <th className="p-3 px-6 text-right font-black text-brand-magenta">Salida</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {data.length === 0 ? (
                          <tr>
                            <td colSpan="7" className="py-12 text-center flex flex-col items-center justify-center gap-3">
                              <Layers className="text-slate-300" size={32} />
                              <span className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">No hay ingresos ni egresos en este turno</span>
                            </td>
                          </tr>
                        ) : (
                          Object.entries(agrupado.porForma).flatMap(([fp, v], gIndex) => {
                            return ['UYU', 'USD'].map((mon, mIndex) => {
                              const movsForma = data.filter(m => (m.MedioDePago || 'INDEFINIDO') === fp && m.Moneda === mon);
                              if (movsForma.length === 0) return null;
                              const uniqueKey = `${gIndex}-${mIndex}`;
                              return (
                                <React.Fragment key={uniqueKey}>
                                  <tr>
                                    <td colSpan="7" className="p-2 px-6 bg-slate-50 text-slate-700 font-black text-[10px] uppercase tracking-widest border-y border-slate-100">
                                      Medio de Pago: <span className="text-brand-cyan">{fp}</span> <span className="text-slate-300 mx-2">|</span> Moneda: <span className={mon === 'USD' ? 'text-emerald-600' : 'text-slate-500'}>{mon}</span>
                                    </td>
                                  </tr>
                                {movsForma.map((m, i) => (
                                  <tr key={i} className="hover:bg-slate-50 text-slate-600 transition-colors">
                                     <td className="p-3 px-6 whitespace-nowrap text-slate-400 font-bold">{fmtDate(m.Fecha)}</td>
                                     <td className="p-3 text-center">
                                       {m.TipoOperacion === 'INGRESO' 
                                          ? <span className="bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded text-[8px] font-black border border-emerald-100 tracking-widest">INGRESO</span>
                                          : <span className="bg-brand-magenta/10 text-brand-magenta px-2 py-0.5 rounded text-[8px] font-black border border-brand-magenta/25 tracking-widest">EGRESO</span>
                                       }
                                     </td>
                                     <td className="p-3 font-mono font-bold text-slate-400">{m.TipoComprobante} {m.Comprobante && m.Comprobante !== '-' ? <span className="text-brand-cyan">{m.Comprobante}</span> : ''}</td>
                                     <td className="p-3 font-bold text-slate-700 max-w-sm truncate" title={m.Concepto}>{m.Concepto}</td>
                                     <td className="p-3 text-slate-500 font-medium whitespace-nowrap">{m.Usuario || 'Sistema'}</td>
                                     <td className="p-3 text-right font-black text-emerald-600 font-mono text-[13px]">{m.Entrada > 0 ? `${m.Moneda} ${fmt(m.Entrada)}` : '-'}</td>
                                     <td className="p-3 px-6 text-right font-black text-brand-magenta font-mono text-[13px]">{m.Salida > 0  ? `${m.Moneda} ${fmt(m.Salida)}`  : '-'}</td>
                                  </tr>
                                ))}
                                </React.Fragment>
                              );
                            });
                          })
                        )}
                      </tbody>
                    </table>
                 </div>
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CajaArqueoModal;
