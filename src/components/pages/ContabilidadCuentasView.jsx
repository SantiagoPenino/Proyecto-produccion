/**
 * ContabilidadCuentasView.jsx
 * Cuentas de clientes — lista activos, búsqueda, ciclos de crédito y registro de pagos.
 */

import React, { useState, useCallback, useEffect, useMemo, Fragment, useRef } from 'react';
import {
  Search, RefreshCw, TrendingDown, TrendingUp, AlertTriangle,
  CheckCircle2, Clock, CreditCard, BarChart3, FileText,
  Calendar, PlayCircle, StopCircle, X,
  ArrowUpCircle, ArrowDownCircle, Info, Users, Zap,
  DollarSign, PlusCircle, Package, RotateCcw, Layers, Download, Printer, ChevronDown, FileMinus, Trash2,
  Lock, Unlock, User, Edit2, Plus
} from 'lucide-react';
import { toast } from 'sonner';
import { useLocation, useNavigate } from 'react-router-dom';

import api from '../../services/api';
import { generarPdfEstadoCuenta, generarPdfPrefactura, generarPdfFacturaDGI } from '../../utils/pdfGenerator';
import { exportarExcelEstadoCuenta } from '../../utils/excelGenerator';
import CierreCicloPreviewModal from './CierreCicloPreviewModal';

const ORDEN_TYPES = ['ORDEN', 'ENTREGA', 'ORDEN_ANTICIPO'];
import ClienteBilletera from '../common/ClienteBilletera';

const fetchAPI = async (url, opts = {}) => {
  try {
    const cleanUrl = url.startsWith('/api') ? url.replace('/api', '') : url;
    const isPostFile = opts.body instanceof FormData;
    const config = {
      method: opts.method || 'GET',
      url: cleanUrl,
      data: opts.body,
      headers: opts.headers || {},
    };
    if (!isPostFile) config.headers['Content-Type'] = 'application/json';
    const res = await api.request(config);
    // Para simplificar la retrocompatibilidad con fetch, simulamos { data, message, etc } de axios
    // y lo devolvemos directo.
    return res.data;
  } catch (error) {
    if (error.response?.data) throw new Error(error.response.data.error || error.response.data.message || 'Error en la solicitud');
    throw error;
  }
};

const fmt      = (n, sym) => `${sym || '$'} ${new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0))}`;
const fmtNum   = (n) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n ?? 0));
const fmtFecha = (f) => f ? new Date(f).toLocaleDateString('es-UY') : '—';
const fmtFechaHora = (f) => f ? new Date(f).toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const diasRestantes = (fc) => fc ? Math.ceil((new Date(fc) - new Date()) / 86400000) : null;

// Extrae solo el código de orden de conceptos tipo "Entrega 0.93 uds orden XDF-76630 (Plan 1)"
const extraerOrden = (concepto) => {
  if (!concepto) return '';
  const m = concepto.match(/orden$s+([$w-]+)/i);
  return m ? m[1] : concepto;
};

const handleDescargarRecibo = async (e, m) => {
  e.preventDefault();
  
  const isPayment = ['PAGO', 'ANTICIPO', 'COBRO', 'SALDO_INICIAL'].includes(m.MovTipo);

  // ── Siempre intentar la Factura DGI primero si hay DocIdDocumento ──────────
  // Aplica tanto a movimientos de deuda (ORDEN, CIERRE_CICLO) como a pagos
  // que generaron un e-Ticket/e-Factura (PAGO contado desde caja).
  let docId = m.DocIdDocumento;
  if (!docId && m.DocSerie && m.DocNumero) {
    try {
      const lookup = await api.get(`/contabilidad/documentos/buscar?serie=${m.DocSerie}&numero=${m.DocNumero}`);
      docId = lookup.data?.DocIdDocumento || lookup.data?.data?.DocIdDocumento;
    } catch (_) {}
  }

  if (docId) {
    try {
      const toastId = toast.loading('Generando Factura...');
      const { data } = await api.get(`/contabilidad/cfe/documentos/${docId}/detalle`);
      if (data && data.doc) {
        generarPdfFacturaDGI(data.doc, data.detalles || []);
        toast.dismiss(toastId);
        toast.success('Factura descargada');
        return;
      }
      toast.dismiss(toastId);
      // Si no tiene doc CFE completo, caer al recibo interno para pagos
    } catch (err) {
      console.warn('[PDF] Error obteniendo factura DGI, intentando recibo...', err.message);
    }
  }

  // ── Fallback: recibo interno (solo para pagos sin documento fiscal) ─────────
  if (isPayment && m.MovIdMovimiento) {
    try {
      const toastId = toast.loading('Generando recibo...');
      const res = await api.get(`/contabilidad/movimientos/${m.MovIdMovimiento}/recibo/pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Recibo-${m.MovIdMovimiento}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast.dismiss(toastId);
    } catch (err) {
      toast.error('Error al descargar el recibo.');
    }
    return;
  }

  // ── Si no es pago y no tiene documento fiscal ─────────────────────────────
  if (!isPayment) {
    toast.error('Este movimiento no generó factura (saldo 0 o cubierto por plan).');
  }
};


// ── Modal Imputar Anticipo a Deuda específica ────────────────────────────────
const ModalImputarAnticipo = ({ mov, cuenta, onClose, onSuccess }) => {
  const importeDeuda  = Math.abs(Number(mov.DDeImportePendiente || mov.visualImporte || mov.MovImporte || 0));
  const saldoDisponible = Number(cuenta?.CueSaldoActual || 0);
  const monStr = cuenta?.MonIdMoneda === 2 ? 'U$S' : '$';
  const [monto, setMonto] = useState(Math.min(importeDeuda, Math.max(0, saldoDisponible)).toFixed(2));
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (Number(monto) <= 0) return toast.error('Monto inválido');
    if (Number(monto) > saldoDisponible) return toast.error(`Saldo insuficiente (${monStr} ${fmtNum(saldoDisponible)})`);
    if (!mov.DDeIdDocumento && !mov.ddeId) return toast.error('No se pudo identificar la deuda. Actualizá la pantalla.');
    setSaving(true);
    try {
      const r = await fetchAPI('/api/contabilidad/caja/imputar-anticipo-deuda', {
        method: 'POST',
        body: JSON.stringify({
          cuentaId:      cuenta.CueIdCuenta,
          ddeIdDocumento: mov.DDeIdDocumento || mov.ddeId,
          monto:         Number(monto),
        }),
      });
      toast.success(r.message || '✅ Imputación realizada');
      onSuccess?.();
      onClose();
    } catch(err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 bg-teal-50 border-b border-teal-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowUpCircle size={17} className="text-teal-600"/>
            <h2 className="font-bold text-teal-800">Imputar Anticipo a Deuda</h2>
          </div>
          <button onClick={onClose}><X size={15} className="text-slate-400"/></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 text-center">
              <p className="text-[10px] font-black uppercase text-rose-500 mb-1">Deuda Pendiente</p>
              <p className="text-lg font-black text-rose-700">{monStr} {fmtNum(importeDeuda)}</p>
            </div>
            <div className={`${saldoDisponible >= importeDeuda ? 'bg-teal-50 border-teal-200' : 'bg-amber-50 border-amber-200'} border rounded-xl p-3 text-center`}>
              <p className="text-[10px] font-black uppercase text-teal-600 mb-1">Saldo Disponible</p>
              <p className={`text-lg font-black ${saldoDisponible >= importeDeuda ? 'text-teal-700' : 'text-amber-700'}`}>{monStr} {fmtNum(saldoDisponible)}</p>
            </div>
          </div>
          {saldoDisponible <= 0 && (
            <p className="text-xs bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-700 font-semibold">
              ⚠️ El cliente no tiene saldo a favor. Primero debés registrar un pago anticipado.
            </p>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Monto a imputar ({monStr})</label>
            <input type="number" min="0.01" step="0.01" required
              value={monto} onChange={e=>setMonto(e.target.value)}
              max={Math.min(importeDeuda, saldoDisponible)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-400/30"
            />
            <p className="text-[10px] text-slate-400 mt-1">Máximo: {monStr} {fmtNum(Math.min(importeDeuda, saldoDisponible))}</p>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600">Cancelar</button>
            <button type="submit" disabled={saving || saldoDisponible <= 0}
              className="flex-1 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
              {saving?<RefreshCw size={13} className="animate-spin"/>:<ArrowUpCircle size={13}/>} Imputar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Modales de operaciones de cuenta ─────────────────────────────────────────
const ModalNotaCredito = ({ mov, cuenta, cliente, onClose, onSuccess }) => {
  // Importe real: DocTotal del documento, o MovImporte absoluto como fallback
  const importeBase = Math.abs(Number(mov.DocTotal || mov.visualImporte || mov.MovImporte || 0));
  const [monto, setMonto]   = useState(importeBase.toFixed(2));
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (Number(monto) <= 0) return toast.error('Monto inválido');
    setSaving(true);
    try {
      // Resolver DocIdDocumento si no viene directo
      let docIdOrigen = mov.DocIdDocumento;
      if (!docIdOrigen && mov.DocSerie && mov.DocNumero) {
        try {
          const lookup = await api.get(`/contabilidad/documentos/buscar?serie=${mov.DocSerie}&numero=${mov.DocNumero}`);
          docIdOrigen = lookup.data?.DocIdDocumento;
        } catch (_) {}
      }
      if (!docIdOrigen) { toast.error('No se pudo identificar el documento origen'); setSaving(false); return; }
      const r = await fetchAPI('/api/contabilidad/caja/nota-credito', { method:'POST', body: JSON.stringify({
        docIdOrigen, monto: Number(monto), motivo,
        clienteId: cliente?.CliIdCliente || cuenta?.CliIdCliente, cuentaId: cuenta?.CueIdCuenta, monedaId: cuenta?.MonIdMoneda || 1,
      })});
      toast.success(r.message || 'NC generada'); onSuccess?.(); onClose();
    } catch(err) { toast.error(err.message); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
          <div className="flex items-center gap-2"><FileMinus size={17} className="text-amber-600"/><h2 className="font-bold text-amber-800">Nota de Crédito</h2></div>
          <button onClick={onClose}><X size={15} className="text-slate-400"/></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <p className="text-xs bg-amber-50 border border-amber-200 rounded-xl p-3 text-amber-800">
            Documento: <strong>{mov.DocTipo} {mov.DocSerie}-{mov.DocNumero}</strong>
            {importeBase > 0 && <> — <strong>{fmtNum(importeBase)}</strong></>}
          </p>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Monto NC</label>
            <input type="number" min="0.01" step="0.01" required value={monto} onChange={e=>setMonto(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30"/>
          </div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Motivo</label>
            <input type="text" value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="Ej: Devolución, error de facturación..."
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm"/>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
              {saving?<RefreshCw size={13} className="animate-spin"/>:<FileMinus size={13}/>} Generar NC
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ModalAnularFactura = ({ mov, cuenta, cliente, onClose, onSuccess }) => {
  const importeBase = Math.abs(Number(mov.DocTotal || mov.visualImporte || mov.MovImporte || 0));
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Resolver DocIdDocumento si no viene directo
      let docId = mov.DocIdDocumento;
      if (!docId && mov.DocSerie && mov.DocNumero) {
        try {
          const lookup = await api.get(`/contabilidad/documentos/buscar?serie=${mov.DocSerie}&numero=${mov.DocNumero}`);
          docId = lookup.data?.DocIdDocumento;
        } catch (_) {}
      }
      if (!docId) { toast.error('No se pudo identificar el documento'); setSaving(false); return; }
      
      const r = await fetchAPI('/api/contabilidad/caja/anular-factura', { method:'POST', body: JSON.stringify({
        docId, clienteId: cliente?.CliIdCliente||cuenta?.CliIdCliente,
        cuentaId: cuenta?.CueIdCuenta, motivo,
      })});
      
      toast.success(r.message||'Factura anulada y ciclo reabierto'); 
      onSuccess?.(); 
      onClose();
    } catch(err){toast.error(err.message);}finally{setSaving(false);}
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 bg-rose-50 border-b border-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-2"><Trash2 size={17} className="text-rose-600"/><h2 className="font-bold text-rose-800">Anular Factura / Reabrir Ciclo</h2></div>
          <button onClick={onClose}><X size={15} className="text-slate-400"/></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <p className="text-xs bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-800">
            ⚠️ Se anulará: <strong>{mov.DocTipo} {mov.DocSerie}-{mov.DocNumero}</strong>
            {importeBase > 0 && <> — <strong>{fmtNum(importeBase)}</strong></>}
            <br/>El ciclo de crédito asociado será <strong>reabierto</strong> y las órdenes correspondientes volverán a estado <strong>pendiente de facturar</strong>.
          </p>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Motivo (opcional)</label>
            <input type="text" value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="Ej: Error al facturar, se debe incluir otra orden..." className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm"/>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
              {saving?<RefreshCw size={13} className="animate-spin"/>:<Trash2 size={13}/>} Confirmar Anulación
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ModalReversarDoc = ({ mov, cuenta, cliente, onClose, onSuccess }) => {
  const importeBase = Math.abs(Number(mov.DocTotal || mov.visualImporte || mov.MovImporte || 0));
  const [metodos, setMetodos] = useState([]);
  const [metodoId, setMetodoId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);
  const esContado = mov.DocPagado === 1 || mov.DocPagado === true;
  useEffect(()=>{ api.get('/contabilidad/metodos-pago').then(r=>{const l=r.data?.data||r.data||[];setMetodos(l);if(l.length)setMetodoId(String(l[0].MPaIdMetodoPago));}).catch(()=>{}); },[]);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      // Resolver DocIdDocumento si no viene directo
      let docId = mov.DocIdDocumento;
      if (!docId && mov.DocSerie && mov.DocNumero) {
        try {
          const lookup = await api.get(`/contabilidad/documentos/buscar?serie=${mov.DocSerie}&numero=${mov.DocNumero}`);
          docId = lookup.data?.DocIdDocumento;
        } catch (_) {}
      }
      if (!docId) { toast.error('No se pudo identificar el documento'); setSaving(false); return; }
      const r = await fetchAPI('/api/contabilidad/caja/reversar-doc', { method:'POST', body: JSON.stringify({
        docId, clienteId: cliente?.CliIdCliente||cuenta?.CliIdCliente,
        cuentaId: cuenta?.CueIdCuenta, metodoPagoId: esContado?metodoId:null, motivo,
      })});
      toast.success(r.message||'Revertido'); onSuccess?.(); onClose();
    } catch(err){toast.error(err.message);}finally{setSaving(false);}
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 bg-rose-50 border-b border-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-2"><RotateCcw size={17} className="text-rose-600"/><h2 className="font-bold text-rose-800">Reversar Documento</h2></div>
          <button onClick={onClose}><X size={15} className="text-slate-400"/></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <p className="text-xs bg-rose-50 border border-rose-200 rounded-xl p-3 text-rose-800">
            ⚠️ Se anulará: <strong>{mov.DocTipo} {mov.DocSerie}-{mov.DocNumero}</strong>
            {importeBase > 0 && <> — <strong>{fmtNum(importeBase)}</strong></>}
            {esContado ? <><br/>Tipo: <strong>Contado</strong> — se registrará crédito en cuenta.</> : <><br/>Tipo: <strong>Crédito</strong> — se cancelará deuda asociada.</>}
          </p>
          {esContado && metodos.length>0 && (
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Forma de devolución</label>
              <select value={metodoId} onChange={e=>setMetodoId(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                {metodos.map(m=><option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>{m.MPaDescripcionMetodo}</option>)}
              </select>
            </div>
          )}
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Motivo (opcional)</label>
            <input type="text" value={motivo} onChange={e=>setMotivo(e.target.value)} placeholder="Ej: Error, devolución..." className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm"/>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
              {saving?<RefreshCw size={13} className="animate-spin"/>:<RotateCcw size={13}/>} Confirmar Reverso
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const ModalAnticipo = ({ cuenta, cliente, onClose, onSuccess }) => {
  const [importe, setImporte] = useState('');
  const [metodos, setMetodos] = useState([]);
  const [metodoId, setMetodoId] = useState('');
  const [monedaId, setMonedaId] = useState(cuenta?.MonIdMoneda||1);
  const [concepto, setConcepto] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(()=>{api.get('/contabilidad/metodos-pago').then(r=>{const l=r.data?.data||r.data||[];setMetodos(l);if(l.length)setMetodoId(String(l[0].MPaIdMetodoPago));}).catch(()=>{});},[]);
  const submit = async (e) => {
    e.preventDefault();
    if (!importe||Number(importe)<=0) return toast.error('Importe inválido');
    setSaving(true);
    try {
      const r = await fetchAPI('/api/contabilidad/caja/pago-anticipo',{method:'POST',body:JSON.stringify({
        clienteId:cliente?.CliIdCliente, cuentaId:cuenta?.CueIdCuenta, importe:Number(importe), metodoPagoId:metodoId, monedaId, concepto,
      })});
      toast.success(r.message||'Anticipo registrado'); onSuccess?.(); onClose();
    }catch(err){toast.error(err.message);}finally{setSaving(false);}
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="px-6 py-4 bg-blue-50 border-b border-blue-200 flex items-center justify-between">
          <div className="flex items-center gap-2"><PlusCircle size={17} className="text-blue-600"/><h2 className="font-bold text-blue-800">Pago Anticipado</h2></div>
          <button onClick={onClose}><X size={15} className="text-slate-400"/></button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Moneda</label>
              <select value={monedaId} onChange={e=>setMonedaId(Number(e.target.value))} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                <option value={1}>UYU</option><option value={2}>USD</option>
              </select>
            </div>
            <div><label className="block text-xs font-semibold text-slate-600 mb-1">Forma de pago</label>
              <select value={metodoId} onChange={e=>setMetodoId(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                {metodos.map(m=><option key={m.MPaIdMetodoPago} value={m.MPaIdMetodoPago}>{m.MPaDescripcionMetodo}</option>)}
              </select>
            </div>
          </div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Importe</label>
            <input type="number" min="0.01" step="0.01" required value={importe} onChange={e=>setImporte(e.target.value)}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30"/>
          </div>
          <div><label className="block text-xs font-semibold text-slate-600 mb-1">Concepto (opcional)</label>
            <input type="text" value={concepto} onChange={e=>setConcepto(e.target.value)} placeholder="Ej: Anticipo cuota marzo..." className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm"/>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600">Cancelar</button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2">
              {saving?<RefreshCw size={13} className="animate-spin"/>:<PlusCircle size={13}/>} Registrar Anticipo
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Modal Consumir Recurso Adelantado ─────────────────────────────────────────────
const ModalConsumirRecurso = ({ mov, cuenta, cliente, onClose, onSuccess }) => {
  const importeOrden     = Math.abs(Number(mov.MovImporte || 0));
  const cantidadMts      = Number(mov.OrdCantidad || 0);
  const codigoOrden      = mov.OrdCodigoOrden || mov.MovConcepto || `Mov#${mov.MovIdMovimiento}`;
  const esClienteSemanal = (cuenta?.CueDiasCiclo || 0) > 0;

  const [loading,          setLoading]          = useState(false);
  const [preview,          setPreview]          = useState(null);
  const [previewErr,       setPreviewErr]       = useState(null);
  const [metrosConfirmados,setMetrosConfirmados]= useState(false);

  useEffect(() => {
    let activo = true;
    (async () => {
      try {
        const r = await fetchAPI(
          `/api/contabilidad/movimientos/${mov.MovIdMovimiento}/consumir-recurso-adelantado?preview=1`,
          { method: 'POST', body: JSON.stringify({}) }
        );
        if (activo) { setPreview(r); setPreviewErr(null); }
      } catch (e) {
        if (activo) setPreviewErr(e.message);
      }
    })();
    return () => { activo = false; };
  }, [mov.MovIdMovimiento]);

  const confirmar = async () => {
    if (!metrosConfirmados) { toast.error('Debe confirmar la cantidad de metros antes de aplicar.'); return; }
    setLoading(true);
    try {
      const r = await fetchAPI(
        `/api/contabilidad/movimientos/${mov.MovIdMovimiento}/consumir-recurso-adelantado`,
        { method: 'POST', body: JSON.stringify({}) }
      );
      toast.success(r.mensaje || 'Recurso aplicado correctamente.');
      onSuccess?.();
      onClose();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-violet-100 overflow-hidden">
        <div className="px-6 py-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers size={18} />
              <h2 className="font-bold text-base">Consumir desde Recurso Adelantado</h2>
            </div>
            <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-lg transition-colors"><X size={16}/></button>
          </div>
          <p className="text-xs text-violet-200 mt-1">
            {esClienteSemanal ? 'Cliente semanal — crédito dentro del ciclo abierto' : 'Cancela la deuda usando saldo del plan'}
          </p>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <p className="text-[10px] text-slate-400 uppercase font-bold tracking-widest mb-1">Orden a cubrir</p>
            <p className="text-sm font-bold text-slate-800">{codigoOrden}</p>
            {mov.OrdNombreTrabajo && <p className="text-xs text-slate-500 mt-0.5">{mov.OrdNombreTrabajo}</p>}
            <div className="flex items-center gap-6 mt-2.5">
              <div><p className="text-[10px] text-slate-400 uppercase">Importe deuda</p><p className="text-base font-black text-rose-600">{fmt(importeOrden, cuenta?.MonSimbolo)}</p></div>
              {cantidadMts > 0 && <div><p className="text-[10px] text-slate-400 uppercase">Metros de la orden</p><p className="text-base font-black text-violet-700">{fmtNum(cantidadMts)} mts</p></div>}
            </div>
          </div>
          {!preview && !previewErr && <div className="flex items-center gap-2 text-slate-400 text-xs py-1"><RefreshCw size={13} className="animate-spin" /> Verificando saldo del plan...</div>}
          {previewErr && (
            <div className="p-4 rounded-xl bg-rose-50 border border-rose-200">
              <div className="flex items-start gap-2">
                <AlertTriangle size={15} className="text-rose-600 mt-0.5 flex-shrink-0"/>
                <div><p className="text-xs font-black text-rose-700 mb-0.5">No se puede aplicar el recurso</p><p className="text-xs text-rose-600">{previewErr}</p></div>
              </div>
            </div>
          )}
          {preview && (
            <>
              <div className="p-3 rounded-xl bg-violet-50 border border-violet-200">
                <p className="text-[10px] text-violet-500 uppercase font-bold tracking-widest mb-2">Impacto de la operación</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><p className="text-[10px] text-slate-400 uppercase">Metros a descontar</p><p className="text-base font-black text-violet-700">{fmtNum(preview.metrosConsumidos)} mts</p></div>
                  <div><p className="text-[10px] text-slate-400 uppercase">Deuda que se cancela</p><p className="text-base font-black text-emerald-600">{fmt(preview.importeCancelado, cuenta?.MonSimbolo)}</p></div>
                  <div><p className="text-[10px] text-slate-400 uppercase">Saldo plan restante</p><p className="text-sm font-black text-slate-700">{fmtNum(preview.planRestante)} mts</p></div>
                  <div><p className="text-[10px] text-slate-400 uppercase">Deuda restante</p><p className="text-sm font-black text-emerald-600">— Cancelada</p></div>
                </div>
                <p className="text-[10px] text-violet-600 mt-2 border-t border-violet-200 pt-2">
                  {preview.escenario === 'CICLO_ABIERTO' ? '📋 Ciclo semanal abierto — crédito dentro del ciclo' : '📄 Documento de deuda individual — se marca CANCELADO'}
                </p>
              </div>
              <div className="p-4 rounded-xl bg-amber-50 border-2 border-amber-300">
                <p className="text-[10px] text-amber-600 uppercase font-black tracking-widest mb-2">Confirmar metros a descontar</p>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-slate-600">Se descontarán del plan:</span>
                  <span className="text-xl font-black text-violet-700 bg-violet-100 px-3 py-1 rounded-lg border border-violet-200">{fmtNum(preview.metrosConsumidos)} mts</span>
                </div>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={metrosConfirmados} onChange={e => setMetrosConfirmados(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-violet-600 cursor-pointer flex-shrink-0" />
                  <span className="text-xs text-amber-800 font-semibold leading-snug">
                    Confirmo que se descontarán <strong>{fmtNum(preview.metrosConsumidos)} metros</strong> del plan activo
                    y la deuda de <strong>{fmt(preview.importeCancelado, cuenta?.MonSimbolo)}</strong> quedará cancelada.
                  </span>
                </label>
              </div>
            </>
          )}
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 px-4 py-2.5 text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors">Cancelar</button>
          <button onClick={confirmar} disabled={loading || !!previewErr || !preview || !metrosConfirmados}
            className="flex-1 px-4 py-2.5 text-sm font-black text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed rounded-xl transition-colors flex items-center justify-center gap-2">
            {loading ? <RefreshCw size={14} className="animate-spin"/> : <Layers size={14}/>}
            {loading ? 'Aplicando...' : `Aplicar — ${fmtNum(preview?.metrosConsumidos ?? cantidadMts)} mts`}
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Menú contextual de acciones por fila ─────────────────────────────────────
const MenuAccionesDoc = ({ m, cuenta, cliente, onRefresh, onPrint, onCobrar, hideActionsDropdown, hidePrinter }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState(null);
  const ref = useRef(null);
  useEffect(()=>{
    const h = (e)=>{ if(ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h);
  },[]);
  const esDoc     = !!(m.DocIdDocumento || (m.DocSerie && m.DocNumero));
  const esContado = m.DocPagado===1||m.DocPagado===true;
  const anulado   = !!m.MovAnulado || m.DocEstado==='ANULADO';
  const acciones  = [];

  // ── Consumir desde Recurso Adelantado ────────────────────────────────────
  // Cond: ORDEN no anulada y sin facturar. EsPendientePago puede ser 0
  // en clientes semanales (ciclo abierto, sin DeudaDocumento aun).
  if (!anulado && !m.DocIdDocumento && ['ORDEN','ORDEN_ANTICIPO'].includes(m.MovTipo)) {
    acciones.push({id:'consumir-recurso', label:'Consumir desde Recurso', icon:<Layers size={13}/>, cls:'text-violet-700 hover:bg-violet-50 font-bold'});
  };

  // ── Cobrar deuda pendiente ──────────────────────────────────────────────
  if (!anulado && m.EsPendientePago === 1) {
    acciones.push({id:'cobrar',   label:'Cobrar deuda',     icon:<DollarSign size={13}/>,    cls:'text-emerald-700 hover:bg-emerald-50'});
    acciones.push({id:'imp-ant',  label:'Imputar anticipo', icon:<ArrowUpCircle size={13}/>, cls:'text-teal-700 hover:bg-teal-50'});
  }

  // ── Registrar Pago / Anticipo (solo si tiene deuda pendiente o es anticipo) ─────────────────────
  // if (!anulado) {
  //   if (m.EsPendientePago === 1) {
  //     acciones.push({id:'pago',label:'Registrar Pago',icon:<DollarSign size={13}/>,cls:'text-green-700 hover:bg-green-50'});
  //   }
  //   // acciones.push({id:'anticipo',label:'Pago anticipado',icon:<PlusCircle size={13}/>,cls:'text-blue-700 hover:bg-blue-50'});
  // }

  // ── Acciones de documento ──────────────────────────────────────────────
  if (esDoc && !anulado) {
    if (m.MovTipo === 'CIERRE_CICLO') {
      if (m.CfeEstado === 'ACEPTADO_DGI') {
        acciones.push({id:'nc',label:'Nota de crédito',icon:<FileMinus size={13}/>,cls:'text-amber-700 hover:bg-amber-50'});
      }
    } else {
      if (!esContado) acciones.push({id:'nc',label:'Nota de crédito',icon:<FileMinus size={13}/>,cls:'text-amber-700 hover:bg-amber-50'});
      // Solo se permite reversar localmente si el documento NO fue aceptado por DGI
      // if (m.CfeEstado !== 'ACEPTADO_DGI') {
      //   acciones.push({id:'reversar',label:'Reversar / Anular',icon:<RotateCcw size={13}/>,cls:'text-rose-700 hover:bg-rose-50'});
      // }
    }
  }

  const handleAction = (id) => {
    setOpen(false);
    if (id === 'cobrar' || id === 'pago') {
      navigate('/contabilidad/caja-admin', {
        state: {
          tab: 'INGRESOS',
          subTab: 'PAGO_DEUDAS',
          cliente: {
            CliIdCliente: cliente?.CliIdCliente,
            Nombre: cliente?.Nombre,
            CodCliente: cliente?.CodCliente
          },
          documento: {
            DocIdDocumento: m.DocIdDocumento,
            OrdIdOrden: m.OrdIdOrden
          }
        }
      });
    } else if (id === 'anticipo') {
      navigate('/contabilidad/caja-admin', {
        state: {
          tab: 'INGRESOS',
          subTab: 'SALDO_FAVOR',
          cliente: {
            CliIdCliente: cliente?.CliIdCliente,
            Nombre: cliente?.Nombre,
            CodCliente: cliente?.CodCliente
          }
        }
      });
    } else {
      setModal(id);
    }
  };

  return (
    <div className="flex items-center justify-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity" ref={ref}>
      {!hidePrinter && (
        <button onClick={(e)=>onPrint(e,m)} title="Imprimir / Descargar"
          className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all border border-transparent hover:border-indigo-100">
          <Printer size={15}/>
        </button>
      )}
      {!anulado && m.EsPendientePago===1 && (
        <button onClick={()=>{
          navigate('/contabilidad/caja-admin', {
            state: {
              tab: 'INGRESOS',
              subTab: 'PAGO_DEUDAS',
              cliente: {
                CliIdCliente: cliente?.CliIdCliente,
                Nombre: cliente?.Nombre,
                CodCliente: cliente?.CodCliente
              },
              documento: {
                DocIdDocumento: m.DocIdDocumento,
                OrdIdOrden: m.OrdIdOrden
              }
            }
          });
        }} title="Cobrar deuda"
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-black uppercase text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 transition-all">
          <DollarSign size={11}/> Cobrar
        </button>
      )}
      {!hideActionsDropdown && acciones.length>0 && (
        <div className="relative">
          <button onClick={()=>setOpen(o=>!o)} title="Más acciones"
            className={`p-1.5 rounded-lg border transition-all ${open?'bg-slate-100 border-slate-300 text-slate-700':'text-slate-400 hover:text-slate-700 hover:bg-slate-50 border-transparent hover:border-slate-200'}`}>
            <ChevronDown size={14} className={`transition-transform ${open?'rotate-180':''}`}/>
          </button>
          {open && (
            <div className="absolute right-0 bottom-8 z-50 bg-white rounded-xl shadow-xl border border-slate-200 py-1 min-w-[190px]">
              {acciones.map(a=>(
                <button key={a.id} onClick={()=>handleAction(a.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-[11px] font-semibold ${a.cls} transition-colors`}>
                  {a.icon}{a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {modal==='nc'               && <ModalNotaCredito     mov={m} conta={cuenta} cuenta={cuenta} cliente={cliente} onClose={()=>setModal(null)} onSuccess={onRefresh}/>}
      {modal==='reversar'          && <ModalReversarDoc     mov={m} conta={cuenta} cuenta={cuenta} cliente={cliente} onClose={()=>setModal(null)} onSuccess={onRefresh}/>}
      {modal==='anticipo'          && <ModalAnticipo        conta={cuenta} cuenta={cuenta} cliente={cliente} onClose={()=>setModal(null)} onSuccess={onRefresh}/>}
      {modal==='imp-ant'           && <ModalImputarAnticipo mov={m} cuenta={cuenta} onClose={()=>setModal(null)} onSuccess={onRefresh}/>}
      {modal==='consumir-recurso'  && <ModalConsumirRecurso mov={m} cuenta={cuenta} cliente={cliente} onClose={()=>setModal(null)} onSuccess={onRefresh}/>}
    </div>
  );
};

// ── Badge ─────────────────────────────────────────────────────────────────────
const Badge = ({ children, color = 'slate' }) => {
  const c = {
    slate:  'bg-slate-100 text-slate-600 border-slate-200',
    amber:  'bg-amber-100 text-amber-700 border-amber-200',
    red:    'bg-red-100 text-red-700 border-red-200',
    green:  'bg-green-100 text-green-700 border-emerald-500/20',
    blue:   'bg-blue-100 text-blue-700 border-indigo-500/20',
    indigo: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  }[color] || 'bg-slate-100 text-slate-600 border-slate-200';
  return <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${c}`}>{children}</span>;
};

// ── Fila de cliente activo ────────────────────────────────────────────────────
const FilaCliente = ({ c, seleccionado, onClick }) => {
  return (
    <button onClick={onClick}
      className={`w-full text-left px-3 py-2.5 hover:bg-indigo-50 transition-colors border-b border-slate-200
        ${seleccionado ? 'bg-indigo-50 border-l-4 border-l-indigo-400' : 'border-l-4 border-l-transparent'}`}>
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 shadow-sm
          ${seleccionado ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-600'}`}>
          {c.Nombre?.[0]?.toUpperCase()}
        </div>
        <div className="flex flex-col flex-1 min-w-0">
          <span className="text-sm font-semibold text-slate-800 truncate">{c.Nombre}</span>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] font-mono text-slate-500 shrink-0">#{c.IDCliente || c.CodCliente || c.CliIdCliente}</span>
            <div className="flex items-center gap-1">
              {c.EsSemanal      == 1 && <Badge color="indigo"><Calendar size={9} /> Sem.</Badge>}
              {c.TieneCicloAbierto == 1 && <Badge color="green"><span className="animate-pulse">●</span> Ciclo</Badge>}
              {c.DocsVencidos    > 0 && <Badge color="red"><AlertTriangle size={9} /> {c.DocsVencidos} Venc.</Badge>}
            </div>
          </div>
        </div>
      </div>
    </button>
  );
};

// ── Modal pago / ajuste ───────────────────────────────────────────────────────
// Las formas de pago se cargan desde MetodosPagos (tabla ya existente)

const ModalPago = ({ cuenta, onClose, onSuccess }) => {
  // Moneda de la cuenta (la de la deuda)
  const monedaCuenta   = cuenta.MonIdMoneda === 2 ? 'USD' : 'UYU';
  const simboloCuenta  = cuenta.MonSimbolo || (monedaCuenta === 'USD' ? 'US$' : '$');

  const [form, setForm] = useState({
    MovTipo:      'ANTICIPO',
    MovImporte:   '',
    MovConcepto:  '',
    Referencia:   '',
    MetodoPagoId:   '',
    MonedaPagoId:   String(cuenta.MonIdMoneda || ''),  // ID de la moneda con que paga
    TipoCambio:     '',
  });
  const [saving, setSaving]             = useState(false);
  const [cotizacion, setCotizacion]     = useState(null);
  const [metodosPago, setMetodosPago]   = useState([]);
  const [monedas, setMonedas]           = useState([]);
  const [loadingMeta, setLoadingMeta]   = useState(false);

  const tipo      = form.MovTipo;
  const esAjuste  = tipo === 'AJUSTE_POS' || tipo === 'AJUSTE_NEG';

  // Moneda seleccionada para el pago
  const monedaPagoObj  = monedas.find(m => String(m.MonIdMoneda) === String(form.MonedaPagoId));
  const monedaCuentaId = String(cuenta.MonIdMoneda || '');
  const esCruzado      = !esAjuste && form.MonedaPagoId && form.MonedaPagoId !== monedaCuentaId;
  const simboloPago    = monedaPagoObj?.MonSimbolo || simboloCuenta;

  const tiposInfo = {
    ANTICIPO:      { label: 'Pago Anticipado',  color: 'green',  desc: 'El cliente paga antes de que se genere la deuda. Se imputa contra deudas pendientes y el excedente queda como crédito a favor.' },
    SALDO_INICIAL: { label: 'Saldo Inicial',    color: 'blue',   desc: 'Carga del saldo inicial al abrir la cuenta. Equivale a un ajuste de apertura.' },
    PAGO:          { label: 'Pago de Deuda',    color: 'amber',  desc: 'Pago normal del cliente. Se imputa automáticamente de la deuda más antigua a la más nueva.' },
    AJUSTE_POS:    { label: 'Ajuste Positivo',  color: 'indigo', desc: 'Corrección manual que aumenta el saldo (devolución, descuento, error de carga).' },
    AJUSTE_NEG:    { label: 'Ajuste Negativo',  color: 'red',    desc: 'Corrección manual que reduce el saldo (cargo extra, recargo, diferencia de precio).' },
  };

  const info       = tiposInfo[tipo];
  const colorHeader = { green: 'from-green-500 to-emerald-500', blue: 'from-blue-500 to-cyan-500', amber: 'from-amber-500 to-orange-500', indigo: 'from-indigo-500 to-violet-500', red: 'from-red-500 to-rose-500' }[info.color];
  const colorBtn   = { green: 'bg-green-600 hover:bg-green-700', blue: 'bg-blue-600 hover:bg-blue-700', amber: 'bg-amber-600 hover:bg-amber-700', indigo: 'bg-indigo-600 hover:bg-indigo-700', red: 'bg-red-600 hover:bg-red-700' }[info.color];

  // Cargar métodos de pago y monedas desde la BD al montar
  useEffect(() => {
    setLoadingMeta(true);
    Promise.all([
      fetchAPI('/api/apipagos/metodos')
        .then(d => Array.isArray(d) ? d : (d.data || []))
        .catch(() => []),
      fetchAPI('/api/contabilidad/monedas')
        .then(d => d.data || [])
        .catch(() => []),
    ]).then(([metodos, mons]) => {
      setMetodosPago(metodos);
      setMonedas(mons);
      if (metodos.length > 0) setForm(f => ({ ...f, MetodoPagoId: String(metodos[0].MPaIdMetodoPago) }));
      // Si la cuenta tiene MonIdMoneda ya está en el form; si no hay match dejamos el default
    }).finally(() => setLoadingMeta(false));
  }, []);

  // Cuando hay conversión cruzada → cargar cotización automáticamente
  useEffect(() => {
    if (esCruzado && !cotizacion) {
      fetchAPI('/api/contabilidad/cotizacion-hoy')
        .then(r => { setCotizacion(r.data); setForm(f => ({ ...f, TipoCambio: String(r.data.promedio) })); })
        .catch(() => {});
    }
    if (!esCruzado) {
      setForm(f => ({ ...f, TipoCambio: '' }));
      setCotizacion(null);
    }
  }, [esCruzado]);

  // Preview importe convertido
  const tc          = parseFloat(form.TipoCambio) || 0;
  const importeNum  = parseFloat(form.MovImporte) || 0;
  let importeConvertido = null;
  if (esCruzado && tc > 0 && importeNum > 0) {
    // Simplificado: si la moneda de pago es distinta a la cuenta, multiplicamos o dividimos
    // La lógica exacta depende de cuál es la moneda base; el backend maneja la lógica real
    importeConvertido = importeNum * tc;  // aproximación visual
  }

  const guardar = async (e) => {
    e.preventDefault();
    if (!form.MovImporte || Number(form.MovImporte) <= 0) { toast.error('El importe debe ser mayor a 0'); return; }
    if (esCruzado && !form.TipoCambio) { toast.error('Ingresá el tipo de cambio'); return; }
    setSaving(true);
    try {
      let endpoint, body;
      const metodoDes = metodosPago.find(m => String(m.MPaIdMetodoPago) === String(form.MetodoPagoId))?.MPaDescripcionMetodo || '';
      const monedaDesc = monedaPagoObj?.MonNombre || monedaPagoObj?.MonSimbolo || '';
      const concepto   = form.MovConcepto || `${info.label}${metodoDes ? ' — ' + metodoDes : ''}`;
      const referencia = form.Referencia || null;

      if (esAjuste) {
        endpoint = '/api/contabilidad/movimientos/ajuste';
        body = { CueIdCuenta: cuenta.CueIdCuenta, MovTipo: tipo, MovConcepto: concepto, MovImporte: Number(form.MovImporte) };
      } else if (esCruzado) {
        endpoint = '/api/contabilidad/movimientos/pago-cruzado';
        body = {
          CueIdCuenta:     cuenta.CueIdCuenta,
          ImporteOriginal: Number(form.MovImporte),
          MonedaPago:      monedaPagoObj?.MonNombre?.includes('Dólar') || monedaPagoObj?.MonSimbolo?.includes('$') && monedaPagoObj?.MonIdMoneda !== 1 ? 'USD' : 'UYU',
          TipoCambio:      Number(form.TipoCambio),
          MovConcepto:     concepto,
          Referencia:      referencia,
        };
      } else {
        endpoint = '/api/contabilidad/movimientos/pago-anticipado';
        body = {
          CueIdCuenta:  cuenta.CueIdCuenta,
          MovTipo:      tipo,
          MovConcepto:  concepto,
          MovImporte:   Number(form.MovImporte),
          Referencia:   referencia,
        };
      }

      body.MovObservaciones = `Método: [${form.MetodoPagoId}] ${metodoDes}. Moneda pago: ${monedaDesc}. Moneda cuenta: ${simboloCuenta}.`;

      const res = await fetchAPI(endpoint, { method: 'POST', body: JSON.stringify(body) });
      toast.success(res.message || '✅ Registrado correctamente');
      onSuccess?.();
      onClose();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 "
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-[#f1f5f9] rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className={`px-6 py-4 flex items-center justify-between bg-gradient-to-r ${colorHeader} text-slate-800 sticky top-0`}>
          <div>
            <p className="text-xs uppercase tracking-widest opacity-80">Cuenta #{cuenta.CueIdCuenta} · {cuenta.UnidadLabel || cuenta.CueTipo} · {simboloCuenta}</p>
            <h2 className="text-lg font-bold mt-0.5">Registrar Movimiento</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X size={16} /></button>
        </div>

        <form onSubmit={guardar} className="px-6 py-5 space-y-4">

          {/* Tipo */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Tipo de movimiento</label>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(tiposInfo).map(([key, val]) => (
                <button type="button" key={key}
                  onClick={() => setForm(f => ({ ...f, MovTipo: key, MovConcepto: '' }))}
                  className={`px-3 py-2 rounded-lg text-xs font-semibold border transition-all text-left
                    ${form.MovTipo === key ? 'bg-blue-600 text-white border-blue-600 shadow-sm' : 'bg-slate-50/50 text-slate-600 border-slate-200 hover:border-blue-300 hover:bg-indigo-50'}`}>
                  {val.label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400 bg-slate-50/50 rounded-lg px-3 py-2">{info.desc}</p>
          </div>

          {/* Moneda y Forma de pago en la misma fila */}
          {!esAjuste && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Moneda del pago</label>
                {loadingMeta ? (
                  <div className="flex items-center gap-2 py-2 text-xs text-slate-500"><RefreshCw size={11} className="animate-spin" /> Cargando...</div>
                ) : (
                  <select value={form.MonedaPagoId}
                    onChange={e => setForm(f => ({ ...f, MonedaPagoId: e.target.value, TipoCambio: '' }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-[#f1f5f9]">
                    {monedas.map(m => (
                      <option key={m.MonIdMoneda} value={m.MonIdMoneda}>
                        {m.MonSimbolo} — {m.MonNombre}
                      </option>
                    ))}
                    {monedas.length === 0 && <option value="">Sin monedas disponibles</option>}
                  </select>
                )}
                {/* Aviso conversión cruzada */}
                {esCruzado && (
                  <p className="text-[10px] text-amber-700 font-semibold mt-1 bg-amber-50 border border-amber-100 px-2 py-1 rounded">
                    ⚡ Pago en {monedaPagoObj?.MonSimbolo} → imputa en {simboloCuenta}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Forma de pago</label>
                {loadingMeta ? (
                  <div className="flex items-center gap-2 py-2 text-xs text-slate-500"><RefreshCw size={11} className="animate-spin" /> Cargando...</div>
                ) : (
                  <select value={form.MetodoPagoId}
                    onChange={e => setForm(f => ({ ...f, MetodoPagoId: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-[#f1f5f9]">
                    {metodosPago.map(mp => (
                      <option key={mp.MPaIdMetodoPago} value={mp.MPaIdMetodoPago}>
                        {mp.MPaDescripcionMetodo}
                      </option>
                    ))}
                    {metodosPago.length === 0 && <option value="">Sin métodos disponibles</option>}
                  </select>
                )}
              </div>
            </div>
          )}


          {/* Tipo de cambio (solo si es cruzado) */}
          {esCruzado && (
            <div className="bg-amber-50/50 rounded-xl p-3 border border-amber-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-amber-800">Tipo de cambio</p>
                {cotizacion && (
                  <div className="flex gap-3 text-[10px] text-amber-600">
                    <span>Compra: {cotizacion.compra}</span>
                    <span>Venta: {cotizacion.venta}</span>
                    <span className="font-bold">Prom: {cotizacion.promedio}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">1 {form.Moneda} =</span>
                <input type="number" min="0.01" step="0.0001" required
                  value={form.TipoCambio}
                  onChange={e => setForm(f => ({ ...f, TipoCambio: e.target.value }))}
                  placeholder="Ej: 43.50"
                  className="flex-1 px-3 py-2 border border-amber-200 bg-[#f1f5f9] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400/30 font-mono" />
                <span className="text-xs text-slate-400">{monedaCuenta}</span>
              </div>
              {/* Preview conversión */}
              {importeConvertido !== null && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-slate-400">{importeNum} {form.Moneda}</span>
                  <span className="text-amber-500">→</span>
                  <span className="font-bold text-slate-700">{fmtNum(importeConvertido)} {monedaCuenta}</span>
                  <span className="text-[10px] text-slate-500">(se imputa en la cuenta)</span>
                </div>
              )}
            </div>
          )}

          {/* Importe */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Importe ({simboloPago})
            </label>
            <div className="relative">
              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input type="number" min="0.01" step="0.01" required
                value={form.MovImporte}
                onChange={e => setForm(f => ({ ...f, MovImporte: e.target.value }))}
                placeholder="0,00"
                className="w-full pl-8 pr-4 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 font-mono" />
            </div>
          </div>

          {/* Concepto */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Concepto (opcional)</label>
            <input type="text"
              value={form.MovConcepto}
              onChange={e => setForm(f => ({ ...f, MovConcepto: e.target.value }))}
              placeholder={info.label}
              className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
          </div>

          {/* Referencia */}
          {!esAjuste && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">N° Recibo / Referencia (opcional)</label>
              <input type="text"
                value={form.Referencia}
                onChange={e => setForm(f => ({ ...f, Referencia: e.target.value }))}
                placeholder="Ej: REC-001, N° cheque, transferencia..."
                className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400" />
            </div>
          )}

          {/* Acciones */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50/50 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className={`flex-1 py-2.5 rounded-lg text-sm text-slate-800 font-semibold transition-colors disabled:opacity-50 flex items-center justify-center gap-2 ${colorBtn}`}>
              {saving ? <RefreshCw size={14} className="animate-spin" /> : <PlusCircle size={14} />}
              Confirmar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// ── Órdenes pendientes en vista Estado de Cuenta ─────────────────────────────
const OrdenesEstadoCuenta = ({ movs, simbolo }) => {
  const pendientes = movs.filter(m =>
    ['ORDEN','ORDEN_ANTICIPO'].includes(m.MovTipo) &&
    !m.DocIdDocumento && !m.MovAnulado &&
    !(m.MovObservaciones?.startsWith('CUBIERTO'))
  );
  if (!pendientes.length) return null;
  const total = pendientes.reduce((s, m) => s + Math.abs(Number(m.MovImporte || 0)), 0);
  return (
    <div className="border-t-2 border-orange-200">
      <div className="flex items-center justify-between px-5 py-2.5 bg-orange-500">
        <span className="text-xs font-black uppercase tracking-widest text-white">
          Órdenes Pendientes de Facturar · {pendientes.length}
        </span>
        <span className="text-xs font-bold text-white/80">No afectan el saldo monetario</span>
      </div>
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-orange-50 text-orange-700 text-[10px] uppercase tracking-wider">
            <th className="px-4 py-2 text-left">Fecha</th>
            <th className="px-4 py-2 text-left">Orden</th>
            <th className="px-4 py-2 text-left">Trabajo</th>
            <th className="px-4 py-2 text-right">Importe</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-orange-100">
          {pendientes.map(m => {
            const codigo  = m.CodigoOrdenStr || m.OrdCodigoOrden || '—';
            const trabajo = m.OrdNombreTrabajo || m.MovConcepto || '—';
            const imp     = Math.abs(Number(m.MovImporte || 0));
            const fecha   = m.MovFecha ? new Date(m.MovFecha).toLocaleDateString('es-UY') : '—';
            return (
              <tr key={m.MovIdMovimiento} className="hover:bg-orange-50/60 transition-colors">
                <td className="px-4 py-2 text-slate-400">{fecha}</td>
                <td className="px-4 py-2 font-semibold text-slate-700">{codigo}</td>
                <td className="px-4 py-2 text-slate-500">{trabajo}</td>
                <td className="px-4 py-2 text-right font-bold text-orange-700">
                  {simbolo} {imp.toLocaleString('es-UY', {minimumFractionDigits:2})}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-orange-100">
            <td colSpan={3} className="px-4 py-2.5 text-right font-black text-orange-700 uppercase tracking-wider text-[10px]">
              Total Pendiente a Facturar
            </td>
            <td className="px-4 py-2.5 text-right font-black text-orange-700">
              {simbolo} {total.toLocaleString('es-UY', {minimumFractionDigits:2})}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

// ── Panel movimientos ─────────────────────────────────────────────────────────
const MovimientosPanel = ({ CueIdCuenta, simbolo = '$', onClose, cuenta, onRegistrarPago, CliIdCliente, cliente, desde, hasta, trigger, ordenesPendientes }) => {
  const [movs, setMovs]           = useState([]);
  const [ciclosInfo, setCiclosInfo] = useState({});
  const [loading, setLoading]     = useState(false);
  // Saldo acumulado de TODOS los movimientos anteriores al período filtrado.
  // Si no hay filtro de fecha, vale 0 (historial completo desde el origen).
  const [saldoArrastre, setSaldoArrastre] = useState(0);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams({ top: 500 });
      if (desde) p.append('desde', desde);
      if (hasta) p.append('hasta', hasta);
      const resp = await fetchAPI(`/api/contabilidad/cuentas/${CueIdCuenta}/movimientos?${p}`);
      setMovs(resp.data || []);
      // El backend calcula el arrastre de forma exacta en SQL — lo usamos directamente.
      setSaldoArrastre(Number(resp.saldoArrastre ?? 0));

      // Intentamos cargar la info de los ciclos del cliente de la cuenta
      const clienteId = CliIdCliente || (cuenta && cuenta.CliIdCliente);
      if (clienteId) {
        const ciclosData = await fetchAPI(`/api/contabilidad/ciclos/${clienteId}`);
        const cMap = {};
        (ciclosData.data || []).forEach(c => cMap[c.CicIdCiclo] = c);
        setCiclosInfo(cMap);
      }
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [CueIdCuenta, desde, hasta, cuenta, CliIdCliente, trigger]);

  useEffect(() => { cargar(); }, [cargar]);

  const [expandedCiclos, setExpandedCiclos] = useState({});
  const [viewMode, setViewMode] = useState('HISTORIAL'); // 'HISTORIAL' | 'ESTADO_CUENTA'
  const [soloDeudasVivas, setSoloDeudasVivas] = useState(false);
  const toggleCiclo = (id) => setExpandedCiclos(p => ({...p, [id]: !p[id]}));

  const movsAgrupados = useMemo(() => {
    const grupos = {};
    const sinCiclo = [];
    movs.forEach(m => {
      if (m.CicIdCiclo) {
        if (!grupos[m.CicIdCiclo]) grupos[m.CicIdCiclo] = [];
        grupos[m.CicIdCiclo].push(m);
      } else {
        sinCiclo.push(m);
      }
    });
    
    const sortedGroups = Object.keys(grupos).sort((a, b) => b - a).map(k => ({
      ciclo: k,
      movs: grupos[k],
      // Tomamos la fecha del último movimiento como referencia del ciclo
      fechaRef: grupos[k][0]?.MovFecha 
    }));

    return { grupos: sortedGroups, sinCiclo };
  }, [movs]);

  // El hook movsParaEstadoCuenta ya no es necesario porque la API devuelve 
  // visualSaldoAntes, visualImporte, visualSaldoDespues y visualIsVisible.
  const sortedMovs = useMemo(() => [...movs].reverse(), [movs]);
  const movsParaEstadoCuenta = sortedMovs;

  // Órdenes cubiertas por un plan — detectadas por MovObservaciones='CUBIERTO_POR_PLAN_X'
  const coveredMovIds = useMemo(() => new Set(
    sortedMovs
      .filter(m => m.MovObservaciones && m.MovObservaciones.startsWith('CUBIERTO'))
      .map(m => m.MovIdMovimiento)
  ), [sortedMovs]);

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 overflow-hidden shadow-lg bg-white">

      {/* FILTROS Y CONTROLES */}
      <div className="flex items-center justify-between px-5 py-3 bg-indigo-600 text-white">
        <div className="flex items-center gap-3">
            <BarChart3 size={16} />
            <span className="text-sm font-black tracking-widest uppercase">Historial de Movimientos</span>
        </div>
        <div className="flex items-center gap-2">
          <button 
            title={`Imprimir Estado de Cuenta (${cuenta?.MonSimbolo || simbolo})`}
            onClick={async () => {
              try {
                const t = toast.loading('Generando PDF...');
                const p = new URLSearchParams({ top: 500 });
                if (desde) p.append('desde', desde);
                if (hasta) p.append('hasta', hasta);
                const resp = await fetchAPI(`/api/contabilidad/cuentas/${CueIdCuenta}/movimientos?${p}`);
                const planesRes = await fetchAPI(`/api/contabilidad/planes/${CliIdCliente}`).catch(() => ({ data: [] }));
                const sec = { [CueIdCuenta]: { cue: cuenta, movs: resp.data || [], saldoArrastre: Number(resp.saldoArrastre ?? 0) } };
                generarPdfEstadoCuenta(cliente, [cuenta], sec, planesRes.data || [], desde, hasta);
                toast.success('PDF descargado', { id: t });
              } catch (err) {
                toast.error('Error al generar PDF: ' + err.message);
              }
            }}
            className="p-1.5 bg-indigo-500/50 hover:bg-white/20 rounded-lg transition-colors"
          >
            <Printer size={14} />
          </button>
          <div className="flex items-center gap-1 bg-indigo-800/40 p-1 rounded-lg border border-indigo-500/30">
            <button 
                onClick={() => setViewMode('HISTORIAL')} 
                className={`px-4 py-1.5 text-[10px] uppercase tracking-widest font-black rounded-md transition-all ${viewMode === 'HISTORIAL' ? 'bg-white text-indigo-700 shadow-sm' : 'text-indigo-100 hover:bg-indigo-700/50'}`}
            >
                Histórico General
            </button>
            <button 
                onClick={() => setViewMode('ESTADO_CUENTA')} 
                className={`px-4 py-1.5 text-[10px] uppercase tracking-widest font-black rounded-md transition-all ${viewMode === 'ESTADO_CUENTA' ? 'bg-white text-indigo-700 shadow-sm' : 'text-indigo-100 hover:bg-indigo-700/50'}`}
            >
                Estado de Cuenta
            </button>
            {viewMode === 'ESTADO_CUENTA' && (
                <button
                    onClick={() => setSoloDeudasVivas(!soloDeudasVivas)}
                    className={`ml-2 px-3 py-1.5 text-[10px] uppercase tracking-widest font-black rounded-md transition-all border ${soloDeudasVivas ? 'bg-amber-400 text-amber-900 border-amber-400 shadow-sm' : 'bg-transparent text-indigo-100 border-indigo-400 hover:bg-indigo-700/50'}`}
                    title="Mostrar solo los documentos que aún tienen deuda pendiente por pagar"
                >
                    Solo Deudas Vivas
                </button>
            )}
          </div>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-12 bg-white"><div className="animate-spin h-8 w-8 border-4 border-indigo-400 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="overflow-x-auto bg-white">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10 shadow-sm">
              <tr className="text-left text-slate-400 uppercase tracking-widest font-black text-[10px]">
                <th className="px-4 py-3">Fecha</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Documento</th>
                <th className="px-4 py-3">Concepto</th>
                <th className="px-4 py-3 text-right text-indigo-400">Valor Orden</th>
                <th className="px-4 py-3 text-right">Saldo In.</th>
                <th className="px-4 py-3 text-right">Debe</th>
                <th className="px-4 py-3 text-right">Haber</th>
                <th className="px-4 py-3 text-right">Saldo Fn.</th>
                <th className="px-4 py-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {viewMode === 'ESTADO_CUENTA' ? (
                // --- RENDER ESTADO DE CUENTA (FLAT LIST) ---
                movsParaEstadoCuenta.map(m => {
                    if (!m.visualIsVisible) return null;
                    if (soloDeudasVivas && !m.EsPendientePago) return null;

                    const importe = m.visualImporte;
                    const esHaber = importe > 0;
                    const esDebe  = importe < 0;
                    const info = ciclosInfo[m.CicIdCiclo];
                    const isCovered   = coveredMovIds.has(m.MovIdMovimiento);
                    const isFacturado = (m.CicIdCiclo && info && info.CicEstado !== 'ABIERTO') || isCovered;
                    // Mapa de códigos DGI → nombres legibles
                    const DOC_TIPO_LABEL = {
                      '07': 'E-TICKET', '08': 'E-TICKET CRED.', '10': 'N.CRÉDITO ET',
                      '01': 'E-FACTURA', '02': 'E-FACTURA CRED.', '04': 'N.CRÉDITO EF',
                      '107': 'E-TICKET', '108': 'E-TICKET CRED.', '101': 'E-FACTURA', '102': 'E-FACTURA CRED.',
                      'PedidoCaja': 'PEDIDO CAJA', 'PC': 'PEDIDO CAJA',
                      'E-Ticket Contado': 'E-TICKET', 'E-Factura Contado': 'E-FACTURA',
                    };
                    const docTipoLabel = m.DocTipo ? (DOC_TIPO_LABEL[m.DocTipo.trim()] || m.DocTipo.trim()) : null;
                    let fallbackText = 'N/D';
                    if (['PAGO', 'COBRO'].includes(m.MovTipo)) fallbackText = 'Recibo de Pago';
                    else if (m.MovTipo === 'VTA_CAJA') fallbackText = 'Pedido Caja';
                    
                    let docFull = docTipoLabel ? `${docTipoLabel} ${m.DocSerie}-${m.DocNumero}` : (m.CodigoOrdenStr ? m.CodigoOrdenStr : (m.OReIdOrdenRetiro ? `RET: ${m.OReIdOrdenRetiro}` : fallbackText));
                    if (ORDEN_TYPES.includes(m.MovTipo)) {
                        if (m.DocIdDocumento) {
                            docFull = `Facturado (${docTipoLabel || m.DocTipo || 'CFE'} ${m.DocSerie || ''}-${m.DocNumero || ''})`;
                        } else if (isCovered) {
                            docFull = `Cubierto por Plan`;
                        } else if (m.CicIdCiclo) {
                            docFull = isFacturado ? `Facturado (${info?.CicNumeroFactura || 'En proc.'})` : 'Pendiente de facturar (Ciclo)';
                        } else {
                            docFull = 'Pendiente de facturar';
                        }
                    }
                    
                    let conceptoLimpio = m.MovConcepto || '—';
                    if (m.MovTipo === 'CIERRE_CICLO') conceptoLimpio = 'Factura de Servicios Acumulados';
                    else if (m.MovTipo === 'PAGO' && conceptoLimpio.toLowerCase().startsWith('pago: ')) conceptoLimpio = conceptoLimpio.substring(6).trim();
                    else if ((m.MovTipo === 'VTA_CAJA' || m.MovTipo === 'ORDEN') && conceptoLimpio.toLowerCase().startsWith('venta: ')) conceptoLimpio = conceptoLimpio.substring(7).trim();

                    const anulado = !!m.MovAnulado || m.DocEstado === 'ANULADO';

                    let displayTipo = m.MovTipo;
                    if (m.MovTipo === 'CIERRE_CICLO') {
                        displayTipo = m.DocTipo ? m.DocTipo.split(' ')[0] : 'FACTURA'; // Toma E-FACTURA o E-TICKET
                    } else if (m.MovTipo === 'AJUSTE' && m.MovConcepto?.toLowerCase().includes('anulación')) {
                        displayTipo = 'ANULACIÓN';
                    } else if (m.MovTipo === '01') {
                        displayTipo = 'E-FACTURA';
                    } else if (m.MovTipo === '07') {
                        displayTipo = 'E-TICKET';
                    }

                    const esPago = ['PAGO','ANTICIPO','COBRO','SALDO_INICIAL'].includes(m.MovTipo);
                    const esVenta = ['VTA_CAJA','CIERRE_CICLO'].includes(m.MovTipo);
                    const facturaPaga    = esVenta && m.EsPendientePago !== 1;
                    const facturaDeuda   = esVenta && m.EsPendientePago === 1;

                    return (
                        <tr key={`ec-${m.MovIdMovimiento}`} className={`hover:bg-slate-50/80 transition-colors group
                            ${anulado ? 'bg-rose-50/40 text-slate-400' : ''}
                            ${facturaPaga && !anulado ? 'bg-emerald-50/30' : ''}
                            ${facturaDeuda && !anulado ? 'bg-amber-50/30' : ''}
                        `}>
                            <td className={`px-4 py-3 font-medium whitespace-nowrap ${anulado ? 'text-slate-400 line-through decoration-rose-300' : 'text-slate-500'}`}>{fmtFecha(m.MovFecha)}</td>
                            <td className="px-4 py-3">
                                <span className={`font-black px-2 py-1 rounded-md text-[9px] uppercase tracking-wider border ${m.MovAnulado ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                                    {displayTipo} {m.MovAnulado ? '(ANULADO)' : ''}
                                </span>
                            </td>
                            <td className="px-4 py-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    {ORDEN_TYPES.includes(m.MovTipo) ? (
                                        ((m.CicIdCiclo && isFacturado) || m.DocIdDocumento) ? <Lock size={12} className="text-rose-500" title="Facturado" /> : <Unlock size={12} className="text-emerald-500" title="Pendiente" />
                                    ) : (
                                        m.DocTipo ? (m.EsPendientePago ? <Unlock size={12} className="text-emerald-500" title="Pendiente de pago" /> : <Lock size={12} className="text-rose-500" title="Pagado / Cerrado" />) : null
                                    )}
                                    <span className="font-bold text-slate-700 block">{docFull}</span>
                                    {facturaPaga && !anulado && (
                                        <span className="inline-flex items-center gap-1 bg-emerald-100 text-emerald-700 text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest border border-emerald-300">
                                            <svg width="8" height="8" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                            Pagada
                                        </span>
                                    )}
                                    {facturaDeuda && !anulado && (
                                        <span className="bg-rose-100 text-rose-600 text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-widest border border-rose-200">Pendiente</span>
                                    )}
                                </div>
                                {m.CfeEstado && (
                                    <span className={`text-[9px] font-black tracking-widest uppercase mt-0.5 block ${m.CfeEstado === 'ACEPTADO_DGI' ? 'text-emerald-500' : 'text-amber-500'}`}>DGI: {m.CfeEstado.replace('_DGI','')}</span>
                                )}
                                {m.DocCliNombre && m.DocCliNombre.trim().toLowerCase() !== (cliente?.Nombre || '').trim().toLowerCase() && (
                                    <span className="text-[10px] font-bold text-amber-600 mt-1 block" title={m.DocCliNombre}>
                                        Facturado a: <span className="font-extrabold">{m.DocCliNombre}</span>
                                    </span>
                                )}
                            </td>
                            <td className="px-4 py-3 text-slate-600 min-w-[250px] max-w-[350px]" title={m.MovConcepto}><span className="block text-xs font-medium leading-relaxed whitespace-normal break-words">{conceptoLimpio}</span></td>
                            <td className="px-4 py-3 text-right bg-indigo-50/30 group-hover:bg-indigo-50/60 transition-colors">
                                {ORDEN_TYPES.includes(m.MovTipo) ? (
                                    <span className="flex items-center justify-end gap-1 font-bold text-indigo-600">
                                        <span className="mr-0.5 opacity-60 text-[9px]">{simbolo}</span>{fmtNum(Math.abs(Number(m.MovImporte)))}
                                    </span>
                                ) : <span className="text-slate-200">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-400 font-medium">
                                {ORDEN_TYPES.includes(m.MovTipo) ? <span className="text-slate-200">—</span> : <><span className="mr-0.5 opacity-60 text-[9px]">{simbolo}</span>{fmtNum(m.visualSaldoAntes)}</>}
                            </td>
                            <td className="px-4 py-3 text-right bg-rose-50/30 group-hover:bg-rose-50/60 transition-colors">
                                {esDebe && !ORDEN_TYPES.includes(m.MovTipo) ? (
                                    <span className="flex items-center justify-end gap-1 font-bold text-rose-600">
                                        <span className="mr-0.5 opacity-60 text-[9px]">{simbolo}</span>{fmtNum(Math.abs(importe))}
                                    </span>
                                ) : <span className="text-slate-200">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right bg-emerald-50/30 group-hover:bg-emerald-50/60 transition-colors">
                                {esHaber && !ORDEN_TYPES.includes(m.MovTipo) ? (
                                    <span className="flex items-center justify-end gap-1 font-bold text-emerald-600">
                                        <span className="mr-0.5 opacity-60 text-[9px]">{simbolo}</span>{fmtNum(importe)}
                                    </span>
                                ) : <span className="text-slate-200">—</span>}
                            </td>
                            <td className="px-4 py-3 text-right text-slate-800 font-black">
                                {ORDEN_TYPES.includes(m.MovTipo) ? <span className="text-slate-200">—</span> : <><span className="mr-0.5 opacity-60 text-[9px] text-slate-400">{simbolo}</span>{fmtNum(m.visualSaldoDespues)}</>}
                            </td>
                            <td className="px-4 py-3 text-center">
                                <MenuAccionesDoc
                                  m={m}
                                  cuenta={cuenta}
                                  cliente={cliente}
                                  onRefresh={cargar}
                                  onPrint={handleDescargarRecibo}
                                  onCobrar={onRegistrarPago}
                                  hideActionsDropdown={true}
                                  hidePrinter={ORDEN_TYPES.includes(m.MovTipo) && (!!m.DocIdDocumento || isFacturado)}
                                />
                            </td>
                        </tr>
                    );
                })
              ) : (
                // --- RENDER HISTORIAL GENERAL (LISTA PLANA CRONOLÓGICA) ---
                <>
                {sortedMovs.map(m => {
                  const cicloInfo = ciclosInfo[m.CicIdCiclo];
                  const importe = m.visualImporte; // PRE-CALCULADO EN EL BACKEND
                  const esHaber = importe > 0;
                  const esDebe  = importe < 0;
                  const isCovered   = coveredMovIds.has(m.MovIdMovimiento);
                  const isFacturado = (m.CicIdCiclo && cicloInfo && cicloInfo.CicEstado !== 'ABIERTO') || isCovered;

                  let fallbackText = 'N/D';
                  if (['PAGO', 'COBRO'].includes(m.MovTipo)) fallbackText = 'Recibo de Pago';
                  else if (m.MovTipo === 'VTA_CAJA') fallbackText = 'Pedido Caja';

                  let docFull = m.DocTipo
                    ? `${m.DocTipo} ${m.DocSerie}-${m.DocNumero}`
                    : (m.CodigoOrdenStr
                      ? m.CodigoOrdenStr
                      : (m.OReIdOrdenRetiro ? `RET: ${m.OReIdOrdenRetiro}` : (m.MovTipo === 'ORDEN' ? 'Orden no facturada' : fallbackText)));
                  if (ORDEN_TYPES.includes(m.MovTipo)) {
                    if (m.DocIdDocumento) {
                      docFull = `Facturado (${m.DocTipo || 'CFE'} ${m.DocSerie || ''}-${m.DocNumero || ''})`;
                    } else if (isCovered) {
                      docFull = `Cubierto por Plan`;
                    } else {
                      docFull = isFacturado
                        ? `Facturado (${cicloInfo?.CicNumeroFactura || 'En proc.'})`
                        : 'Pendiente de facturar';
                    }
                  }

                  let conceptoLimpio = m.MovConcepto || '—';
                  if (m.MovTipo === 'CIERRE_CICLO') conceptoLimpio = 'Factura de Servicios Acumulados';
                  else if (m.MovTipo === 'PAGO' && conceptoLimpio.toLowerCase().startsWith('pago: ')) conceptoLimpio = conceptoLimpio.substring(6).trim();
                  else if ((m.MovTipo === 'VTA_CAJA' || m.MovTipo === 'ORDEN') && conceptoLimpio.toLowerCase().startsWith('venta: ')) conceptoLimpio = conceptoLimpio.substring(7).trim();

                  const anulado = !!m.MovAnulado || m.DocEstado === 'ANULADO';

                  let displayTipo = m.MovTipo;
                  if (m.MovTipo === 'CIERRE_CICLO') {
                    displayTipo = m.DocTipo ? m.DocTipo.split(' ')[0] : 'FACTURA';
                  } else if (m.MovTipo === 'AJUSTE' && m.MovConcepto?.toLowerCase().includes('anulación')) {
                    displayTipo = 'ANULACIÓN';
                  }

                  const lockIcon = ORDEN_TYPES.includes(m.MovTipo) ? (
                    (isFacturado || m.DocIdDocumento)
                      ? <Lock size={12} className="text-rose-500 flex-shrink-0" title="Facturado / Cerrado" />
                      : <Unlock size={12} className="text-emerald-500 flex-shrink-0" title="Pendiente de facturar" />
                  ) : (
                    m.DocTipo
                      ? (m.EsPendientePago
                          ? <Unlock size={12} className="text-emerald-500 flex-shrink-0" title="Pendiente de pago" />
                          : <Lock size={12} className="text-rose-500 flex-shrink-0" title="Pagado / Cerrado" />)
                      : null
                  );

                  return (
                    <tr key={m.MovIdMovimiento} className={`hover:bg-slate-50/80 transition-colors group ${anulado ? 'bg-rose-50/40' : ''}`}>
                      <td className={`px-4 py-3 font-medium whitespace-nowrap ${anulado ? 'text-slate-400 line-through decoration-rose-300' : 'text-slate-500'}`}>{fmtFecha(m.MovFecha)}</td>
                      <td className="px-4 py-3">
                        <span className={`font-black px-2 py-1 rounded-md text-[9px] uppercase tracking-wider border ${m.MovAnulado ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                          {displayTipo} {m.MovAnulado ? '(ANULADO)' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {lockIcon}
                          <span className="font-bold text-slate-700">{docFull}</span>
                          {m.EsPendientePago === 1 && (
                            <span className="bg-rose-100 text-rose-600 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest border border-rose-200">Pendiente Pago</span>
                          )}
                          {m.CicIdCiclo && (
                            <span className="bg-indigo-50 text-indigo-500 text-[8px] font-black px-1.5 py-0.5 rounded uppercase tracking-widest border border-indigo-200 flex-shrink-0">
                              Ciclo #{m.CicIdCiclo}
                            </span>
                          )}
                        </div>
                        {m.CfeEstado && (
                          <span className={`text-[9px] font-black tracking-widest uppercase mt-0.5 block ${m.CfeEstado === 'ACEPTADO_DGI' ? 'text-emerald-500' : 'text-amber-500'}`}>DGI: {m.CfeEstado.replace('_DGI','')}</span>
                        )}
                        {m.DocCliNombre && m.DocCliNombre.trim().toLowerCase() !== (cliente?.Nombre || '').trim().toLowerCase() && (
                          <span className="text-[10px] font-bold text-amber-600 mt-1 block" title={m.DocCliNombre}>
                            Facturado a: <span className="font-extrabold">{m.DocCliNombre}</span>
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 min-w-[250px] max-w-[350px]" title={m.MovConcepto}>
                        <span className="block text-xs font-medium leading-relaxed whitespace-normal break-words">{conceptoLimpio}</span>
                      </td>
                      {/* VALOR ORDEN (informativo, no afecta saldo) */}
                      <td className="px-4 py-3 text-right bg-indigo-50/30 group-hover:bg-indigo-50/60 transition-colors">
                        {ORDEN_TYPES.includes(m.MovTipo) ? (
                          <span className="flex items-center justify-end gap-1 font-bold text-indigo-600">
                            <span className="mr-0.5 opacity-60 text-[9px]">{simbolo}</span>{fmtNum(Math.abs(Number(m.MovImporte)))}
                          </span>
                        ) : <span className="text-slate-200">—</span>}
                      </td>
                      {/* SALDO INICIAL */}
                      <td className="px-4 py-3 text-right text-slate-400 font-medium">
                        {ORDEN_TYPES.includes(m.MovTipo)
                          ? <span className="text-slate-200">—</span>
                          : <><span className="mr-0.5 opacity-60 text-[9px]">{simbolo}</span>{fmtNum(m.visualSaldoAntes)}</>}
                      </td>
                      {/* DEBE */}
                      <td className="px-4 py-3 text-right bg-rose-50/30 group-hover:bg-rose-50/60 transition-colors">
                        {esDebe && !ORDEN_TYPES.includes(m.MovTipo) ? (
                          <span className="flex items-center justify-end gap-1 font-bold text-rose-600">
                            <span className="mr-0.5 opacity-60 text-[9px]">{simbolo}</span>{fmtNum(Math.abs(importe))}
                          </span>
                        ) : <span className="text-slate-200">—</span>}
                      </td>
                      {/* HABER */}
                      <td className="px-4 py-3 text-right bg-emerald-50/30 group-hover:bg-emerald-50/60 transition-colors">
                        {esHaber && !ORDEN_TYPES.includes(m.MovTipo) ? (
                          <span className="flex items-center justify-end gap-1 font-bold text-emerald-600">
                            <span className="mr-0.5 opacity-60 text-[9px]">{simbolo}</span>{fmtNum(importe)}
                          </span>
                        ) : <span className="text-slate-200">—</span>}
                      </td>
                      {/* SALDO FINAL */}
                      <td className="px-4 py-3 text-right text-slate-800 font-black">
                        {ORDEN_TYPES.includes(m.MovTipo)
                          ? <span className="text-slate-200">—</span>
                          : <><span className="mr-0.5 opacity-60 text-[9px] text-slate-400">{simbolo}</span>{fmtNum(m.visualSaldoDespues)}</>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <MenuAccionesDoc
                          m={m}
                          cuenta={cuenta}
                          cliente={cliente}
                          onRefresh={cargar}
                          onPrint={handleDescargarRecibo}
                          onCobrar={onRegistrarPago}
                          hideActionsDropdown={ORDEN_TYPES.includes(m.MovTipo) && (!!m.DocIdDocumento || isFacturado)}
                          hidePrinter={ORDEN_TYPES.includes(m.MovTipo) && (!!m.DocIdDocumento || isFacturado)}
                        />
                      </td>
                    </tr>
                  );
                })}
                </>
              )}


              {movs.length === 0 && <tr><td colSpan={9} className="text-center py-12 text-slate-400 font-bold uppercase tracking-widest text-xs">No se encontraron movimientos en este período</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {/* ── Órdenes pendientes (solo en vista Estado de Cuenta) ── */}
      {viewMode === 'ESTADO_CUENTA' && (
        <OrdenesEstadoCuenta movs={ordenesPendientes || []} simbolo={simbolo} />
      )}
    </div>
  );
};

const DeudasPanel = ({ CueIdCuenta, simbolo, onClose }) => {
  const [deudas, setDeudas]   = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const cargar = async () => {
      setLoading(true);
      try {
        const data = await fetchAPI(`/api/contabilidad/cuentas/${CueIdCuenta}/deudas`);
        setDeudas(data.data || []);
      } catch (e) { toast.error(e.message); }
      finally { setLoading(false); }
    };
    cargar();
  }, [CueIdCuenta]);

  return (
    <div className="mt-3 rounded-xl border border-slate-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-slate-800 text-white">
        <div className="flex items-center gap-2"><FileText size={14} /><span className="text-sm font-semibold">Documentos Pendientes</span></div>
        <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X size={14} /></button>
      </div>
      {loading ? (
        <div className="flex justify-center py-6 bg-[#f1f5f9]"><div className="animate-spin h-5 w-5 border-2 border-amber-400 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto bg-[#f1f5f9]">
          {deudas.map(d => (
            <div key={d.DDeIdDocumento}
              className={`flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors ${d.DiasVencido > 0 ? 'bg-rose-50/50' : ''}`}>
              <div className="flex items-center gap-3">
                <Clock size={13} className={d.DiasVencido > 0 ? 'text-red-500' : 'text-slate-500'} />
                <div>
                  <p className="text-xs font-semibold text-slate-700">Orden #{d.CodigoOrden || d.OrdIdOrden}</p>
                  <p className="text-[11px] text-slate-500">Vence: {fmtFecha(d.DDeFechaVencimiento)}</p>
                </div>
                <Badge color={d.DiasVencido > 0 ? 'red' : d.DDeEstado === 'COBRADO' ? 'green' : 'amber'}>
                  {d.DiasVencido > 0 ? `${d.DiasVencido}d vencido` : d.DDeEstado}
                </Badge>
              </div>
              <div className="text-right">
                <p className="text-[11px] text-slate-500">Total: {fmt(d.DDeImporteOriginal, simbolo)}</p>
                <p className="text-sm font-bold text-slate-800">Pend: {fmt(d.DDeImportePendiente, simbolo)}</p>
              </div>
            </div>
          ))}
          {deudas.length === 0 && (
            <div className="text-center py-6 text-slate-500 text-sm">
              <CheckCircle2 size={24} className="mx-auto mb-2 text-green-400" />Sin deudas
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Panel ciclos ──────────────────────────────────────────────────────────────
const CiclosPanel = ({ cuenta, CliIdCliente, cliente, onClose, onCicloChanged }) => {
  const [ciclos, setCiclos]   = useState([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  
  // Estado para el modal de cierre
  const [cerrandoCiclo, setCerrandoCiclo] = useState(null); // el objeto ciclo
  const [movsCierre, setMovsCierre] = useState([]);
  const [excluidos, setExcluidos] = useState(new Set());
  const [loadingMovs, setLoadingMovs] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchAPI(`/api/contabilidad/ciclos/${CliIdCliente}`);
      setCiclos((data.data || []).filter(c => c.CueIdCuenta === cuenta.CueIdCuenta));
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [CliIdCliente, cuenta.CueIdCuenta]);

  useEffect(() => { cargar(); }, [cargar]);

  const ciclosAbiertos = ciclos.filter(c => c.CicEstado === 'ABIERTO');
  const estadoColor  = e => ({ ABIERTO:'green', VENCIDO:'red', CERRADO:'slate', COBRADO:'indigo', ANULADO:'rose' }[e] || 'slate');

  const abrirCiclo = async () => {
    setWorking(true);
    try {
      await fetchAPI('/api/contabilidad/ciclos', { method: 'POST', body: JSON.stringify({ CueIdCuenta: cuenta.CueIdCuenta, CliIdCliente }) });
      toast.success('✅ Ciclo abierto');
      await cargar(); onCicloChanged?.();
    } catch (e) { toast.error(e.message); }
    finally { setWorking(false); }
  };

  const abrirModalCierre = async (ciclo) => {
    setCerrandoCiclo(ciclo);
    setExcluidos(new Set());
    setLoadingMovs(true);
    try {
      const data = await fetchAPI(`/api/contabilidad/ciclos/${ciclo.CicIdCiclo}/movimientos`);
      setMovsCierre(data.data || []);
    } catch (e) {
      toast.error('Error al cargar movimientos: ' + e.message);
      setCerrandoCiclo(null);
    } finally {
      setLoadingMovs(false);
    }
  };

  const toggleExcluido = (movId) => {
    setExcluidos(prev => {
      const next = new Set(prev);
      if (next.has(movId)) next.delete(movId);
      else next.add(movId);
      return next;
    });
  };

  const confirmarCierre = async (cicId, payload) => {
    setWorking(true);
    try {
      const res = await fetchAPI(`/api/contabilidad/ciclos/${cicId}/cerrar`, { 
        method: 'POST',
        body: JSON.stringify(payload)
      });
      toast.success(`✅ ${res.message}`);
      setCerrandoCiclo(null);
      await cargar(); onCicloChanged?.();
    } catch (e) { toast.error(e.message); }
    finally { setWorking(false); }
  };

  return (
    <div className="mt-3 rounded-xl border border-indigo-200 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-indigo-600 text-white">
        <div className="flex items-center gap-2">
          <Calendar size={14} /><span className="text-sm font-semibold">Ciclos de Crédito</span>
          {ciclosAbiertos.length > 0 && <Badge color="green"><span className="animate-pulse">●</span> {ciclosAbiertos.length} ACTIVO{ciclosAbiertos.length > 1 ? 'S' : ''}</Badge>}
        </div>
        <div className="flex gap-2">
          {ciclosAbiertos.length === 0 && (
            <button onClick={abrirCiclo} disabled={working}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-slate-50 hover:bg-slate-200 rounded-lg transition-colors font-medium disabled:opacity-50">
              {working ? <RefreshCw size={11} className="animate-spin" /> : <PlayCircle size={11} />}Abrir ciclo
            </button>
          )}
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X size={14} /></button>
        </div>
      </div>

      {ciclosAbiertos.map(cicloAbierto => (
        <div key={cicloAbierto.CicIdCiclo} className="px-4 py-3 bg-indigo-50 border-b border-indigo-200 last:border-b-0">
          <div className="flex items-start justify-between gap-4">
            <div className="grid grid-cols-4 gap-4 flex-1">
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Ciclo</p>
                <p className="text-xs font-bold text-slate-700">#{cicloAbierto.CicIdCiclo}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Período</p>
                <p className="text-xs font-bold text-slate-700">Desde {fmtFechaHora(cicloAbierto.CicFechaInicio)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Órdenes</p>
                <p className="text-sm font-bold text-red-600">{fmt(cicloAbierto.CicTotalOrdenes, cuenta.MonSimbolo)}</p>
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Pagos</p>
                <p className="text-sm font-bold text-green-600">{fmt(cicloAbierto.CicTotalPagos, cuenta.MonSimbolo)}</p>
              </div>
            </div>
            <div className="text-right shrink-0 flex flex-col items-end">
              {(() => {
                if (!cicloAbierto.CicFechaCierre) return null;
                const d = diasRestantes(cicloAbierto.CicFechaCierre);
                return <div className={`px-3 py-1.5 rounded-lg text-xs font-bold mb-2
                  ${d !== null && d <= 1 ? 'bg-red-100 text-red-700' : d !== null && d <= 3 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                  {d !== null ? (d > 0 ? `${d}d restantes` : 'Vence hoy') : '—'}
                </div>;
              })()}
              <button onClick={() => abrirModalCierre(cicloAbierto)} disabled={working}
                className="flex items-center gap-1 text-xs px-3 py-1.5 bg-rose-50 text-rose-700 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors font-medium disabled:opacity-50">
                {working ? <RefreshCw size={11} className="animate-spin" /> : <StopCircle size={11} />}Revisar y Cerrar
              </button>
            </div>
          </div>
        </div>
      ))}

      {loading && (
        <div className="flex justify-center py-2 bg-[#f1f5f9]"><div className="animate-spin h-4 w-4 border-2 border-indigo-400 border-t-transparent rounded-full" /></div>
      )}

      {/* Modal de Cierre */}
      {cerrandoCiclo && (
        <CierreCicloPreviewModal
          ciclo={cerrandoCiclo}
          movsOriginales={movsCierre}
          cuenta={cuenta}
          cliente={cliente}
          onClose={() => setCerrandoCiclo(null)}
          onConfirm={confirmarCierre}
        />
      )}
    </div>
  );
};

// ── Panel planes de recursos (Metros / KG) ─────────────────────────────
const PlanesPanel = ({ cuenta, CliIdCliente, cliente, desde, hasta, onClose, onChanged }) => {
  const [planes, setPlanes]       = useState([]);
  const [loading, setLoading]     = useState(false);
  const [working, setWorking]     = useState(false);
  const [movsPlan, setMovsPlan]   = useState({});  // { [planId]: [] }

  // Modales de acciones manuales
  const [modalEditarMetros, setModalEditarMetros] = useState(false);
  const [modalNuevaOrden,   setModalNuevaOrden]   = useState(false);
  const [modalConfirmar,    setModalConfirmar]    = useState(null); // { movId, concepto, saldoIn, consumo }
  const [confirmWorking,    setConfirmWorking]    = useState(false);

  // Form editar metros
  const [editMovId,       setEditMovId]       = useState(null);
  const [editCodigoOrden, setEditCodigoOrden] = useState('');
  const [editMetros,      setEditMetros]      = useState('');
  const [editWorking,     setEditWorking]     = useState(false);

  // Form nueva orden
  const [nuevaOrden,   setNuevaOrden]   = useState({ codigoOrden: '', nombreTrabajo: '', metros: '', planId: '' });
  const [nuevaWorking, setNuevaWorking] = useState(false);

  const unidadLabel = cuenta.UnidadLabel || cuenta.CueTipo || '';

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Fetch planes
      const dataPlanes = await fetchAPI(`/api/contabilidad/planes/${CliIdCliente}`);
      const todosPlanes = dataPlanes.data || [];
      const deCuenta = todosPlanes.filter(p =>
        !p.CueIdCuenta || String(p.CueIdCuenta) === String(cuenta.CueIdCuenta)
      );
      setPlanes(deCuenta);

      // 2. Fetch all movements for the account
      const dataMovs = await fetchAPI(`/api/contabilidad/cuentas/${cuenta.CueIdCuenta}/movimientos?top=200`);
      const todosMovs = dataMovs.data || [];

      // 3. Group movements per plan
      const grouped = {};
      deCuenta.forEach(p => {
        const id = p.PlaIdPlan;
        grouped[id] = todosMovs.filter(m => {
          const matchPlan = m.MovConcepto?.match(/Plan\s*#?\s*(\d+)/i) || m.MovObservaciones?.match(/Plan\s*#?\s*(\d+)/i);
          if (matchPlan) {
            return parseInt(matchPlan[1]) === id;
          }
          if (p.PlaActivo) {
            return true;
          }
          if (deCuenta.length === 1) {
            return true;
          }
          return false;
        });
      });
      setMovsPlan(grouped);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [CliIdCliente, cuenta.CueIdCuenta]);

  useEffect(() => { cargar(); }, [cargar]);

  const planActivo = planes.find(p => p.PlaActivo);

  return (
    <>
      <div className="mt-3 rounded-xl border border-violet-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 bg-violet-600 text-white">
          <div className="flex items-center gap-2">
            <Layers size={14} /><span className="text-sm font-semibold">Planes de Recursos</span>
            {planActivo && <Badge color="green"><span className="animate-pulse">●</span> ACTIVO</Badge>}
          </div>
          <div className="flex items-center gap-1.5">

            {/* Insertar orden manual */}
            <button
              title="Insertar orden manual en la cuenta MTS"
              onClick={() => { setNuevaOrden({ codigoOrden: '', nombreTrabajo: '', metros: '', planId: planActivo?.PlaIdPlan?.toString() || '' }); setModalNuevaOrden(true); }}
              className="flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors"
            >
              <Plus size={11} /> Nueva orden
            </button>
            {/* Imprimir */}
            <button
              title="Imprimir Estado de Cuenta (Recursos)"
              onClick={async () => {
                try {
                  const t = toast.loading('Generando PDF de Recursos...');
                  const p = new URLSearchParams({ top: 500 });
                  if (desde) p.append('desde', desde);
                  if (hasta) p.append('hasta', hasta);
                  const resp = await fetchAPI(`/api/contabilidad/cuentas/${cuenta.CueIdCuenta}/movimientos?${p}`);
                  const planesRes = await fetchAPI(`/api/contabilidad/planes/${CliIdCliente}`).catch(() => ({ data: [] }));
                  const sec = { [cuenta.CueIdCuenta]: { cue: cuenta, movs: resp.data || [], saldoArrastre: Number(resp.saldoArrastre ?? 0) } };
                  generarPdfEstadoCuenta(cliente || { Nombre: 'Cliente', CliIdCliente }, [cuenta], sec, planesRes.data || [], desde, hasta);
                  toast.success('PDF descargado', { id: t });
                } catch (err) {
                  toast.error('Error al generar PDF: ' + err.message);
                }
              }}
              className="p-1.5 bg-violet-500/50 hover:bg-white/20 rounded-lg transition-colors"
            >
              <Printer size={14} />
            </button>
          </div>
        </div>

        {loading ? (
        <div className="flex justify-center py-5 bg-[#f1f5f9]"><div className="animate-spin h-5 w-5 border-2 border-violet-400 border-t-transparent rounded-full" /></div>
      ) : (
        <div className="divide-y divide-slate-100 bg-[#f1f5f9]">
          {planes.map(p => {
            const pct     = Number(p.PorcentajeUsado);
            const agotado = pct >= 100;
            const alerta  = pct >= 80 && !agotado;
            const movsDelPlan = movsPlan[p.PlaIdPlan] || [];

            return (
              <div key={p.PlaIdPlan} className="px-4 py-3">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-700">{p.NombreArticulo || `Producto #${p.ProIdProducto}`}</span>
                      <span className="text-[10px] text-slate-500">Plan #{p.PlaIdPlan}</span>
                    </div>
                    {p.PlaObservacion && <p className="text-[11px] text-slate-400 mt-0.5">{p.PlaObservacion}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-800">{fmtNum(p.PlaCantidadRestante)} / {fmtNum(p.PlaCantidadTotal)} {p.PlaUnidad}</p>
                    {p.PlaImportePagado && <p className="text-[11px] text-slate-500">Pagó: {fmt(p.PlaImportePagado, cuenta.MonSimbolo)}</p>}
                    {p.DiasParaVencer !== null && <p className={`text-[11px] font-semibold ${p.DiasParaVencer <= 7 ? 'text-red-600' : 'text-slate-500'}`}>Vence en {p.DiasParaVencer}d</p>}
                  </div>
                </div>

                <div className="h-2 bg-slate-100 rounded-full overflow-hidden mb-2">
                  <div className={`h-full rounded-full transition-all ${
                    agotado ? 'bg-rose-600' : alerta ? 'bg-amber-400' : 'bg-emerald-500'
                  }`} style={{ width: `${Math.min(pct, 100)}%` }} />
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>Usado: {fmtNum(p.PlaCantidadUsada)} {p.PlaUnidad} ({pct}%)</span>
                  <span>Inicio: {fmtFecha(p.PlaFechaInicio)}</span>
                </div>

                <div className="mt-3 rounded-lg border border-slate-200 overflow-hidden">
                  <div className="px-3 py-2 bg-slate-50/50 border-b border-slate-200 flex items-center justify-between">
                    <span className="text-[11px] font-semibold text-slate-600">Entregas del Plan #{p.PlaIdPlan}</span>
                    <span className="text-[10px] text-slate-500">{movsDelPlan.length} movimientos</span>
                  </div>
                  {movsDelPlan.length === 0 ? (
                    <p className="text-xs text-slate-500 text-center py-4">Sin entregas registradas en este plan</p>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] text-slate-500 uppercase">
                          <th className="px-3 py-1.5 text-left">Fecha</th>
                          <th className="px-3 py-1.5 text-left">Orden / Trabajo</th>
                          <th className="px-3 py-1.5 text-right">Saldo In.</th>
                          <th className="px-3 py-1.5 text-right">Movimiento</th>
                          <th className="px-3 py-1.5 text-right">Saldo Fn.</th>
                          <th className="px-3 py-1.5 text-center w-8"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {[...movsDelPlan].reverse().reduce((acc, m) => {
                          const importe = Number(m.MovImporte);
                          const isNeg = importe < 0;
                          
                          const hasEntrada = movsDelPlan.some(x => Number(x.MovImporte) > 0);
                          const baseSaldo = acc.saldoRunning === undefined
                            ? (hasEntrada ? 0 : Number(p.PlaCantidadTotal || 0))
                            : acc.saldoRunning;

                          const currentSaldo = baseSaldo + importe;

                          acc.push({
                            ...m,
                            _movImporteAbs: Math.abs(importe),
                            _quedan: currentSaldo,
                            _saldoIn: baseSaldo,
                            _isNeg: isNeg
                          });
                          acc.saldoRunning = currentSaldo;
                          return acc;
                        }, []).reverse().map(m => {
                          // Extraer código de orden del concepto para mostrarlo en bold
                          const match = m.MovConcepto?.match(/(?:DF|SB|RM)-?\d+/i) || m.MovConcepto?.match(/#\d+/);
                          const cod = match ? match[0] : '';
                          let obs = m.MovConcepto || '—';
                          if (cod) obs = obs.replace(cod, '').replace(/^[ :\-.]+|[ :\-.]+$/g, '').trim();

                          return (
                          <tr key={m.MovIdMovimiento} className="hover:bg-slate-50/50">
                            <td className="px-3 py-2 text-slate-500">{fmtFecha(m.MovFecha)}</td>
                            <td className="px-3 py-2 max-w-xs" title={m.MovConcepto}>
                              <span className="block truncate text-xs text-slate-700">
                                {cod ? <><span className="font-bold">{cod.toUpperCase()}</span> {obs}</> : obs}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-500 font-medium">{fmtNum(m._saldoIn)} {p.PlaUnidad}</td>
                            <td className={`px-3 py-2 text-right font-semibold ${m._isNeg ? 'text-rose-600' : 'text-emerald-600'}`}>
                              {m._isNeg ? '-' : '+'}{fmtNum(m._movImporteAbs)} {p.PlaUnidad}
                            </td>
                            <td className={`px-3 py-2 text-right font-bold ${m._quedan < (p.PlaCantidadTotal || 0) * 0.1 ? 'text-amber-600' : 'text-violet-700'}`}>
                              {fmtNum(m._quedan)} {p.PlaUnidad}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditMovId(m.MovIdMovimiento);
                                    setEditCodigoOrden(m.MovConcepto);
                                    setEditMetros(m._movImporteAbs.toString());
                                    setModalEditarMetros(true);
                                  }}
                                  className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-amber-600 transition-colors"
                                  title="Editar metros de esta orden"
                                >
                                  <Edit2 size={12} />
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setModalConfirmar({
                                      movId:   m.MovIdMovimiento,
                                      concepto: m.MovConcepto,
                                      consumo:  m._movImporteAbs,
                                      unidad:   p.PlaUnidad
                                    });
                                  }}
                                  className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-rose-600 transition-colors"
                                  title="Eliminar este movimiento"
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </td>
                          </tr>
                          );
                        })}
                        </tbody>
                      </table>
                    )}
                  </div>
              </div>
            );
          })}
          {planes.length === 0 && (
            <div className="text-center py-6 text-slate-500 text-xs"><Package size={22} className="mx-auto mb-1 opacity-30" />Sin planes de recursos</div>
          )}
        </div>
      )}
      </div>

    {/* ── Modal: Editar metros ──────────────────────────────────────── */}
    {modalEditarMetros && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 bg-amber-400">
            <div className="flex items-center gap-2">
              <Edit2 size={16} className="text-amber-900" />
              <span className="font-bold text-amber-900 text-sm">Editar metros de orden</span>
            </div>
            <button onClick={() => setModalEditarMetros(false)} className="p-1 hover:bg-amber-300 rounded-lg transition-colors">
              <X size={14} className="text-amber-900" />
            </button>
          </div>
          <div className="px-5 py-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Concepto / Orden</label>
              <input
                type="text"
                disabled
                value={editCodigoOrden}
                className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Nuevos metros</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={editMetros}
                onChange={e => setEditMetros(e.target.value)}
                placeholder="Ej: 1.50"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
              />
            </div>
            <p className="text-[11px] text-slate-400">Actualiza la cantidad en el movimiento y ajusta el saldo del plan automáticamente.</p>
          </div>
          <div className="px-5 pb-5 flex gap-2 justify-end">
            <button
              onClick={() => setModalEditarMetros(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >Cancelar</button>
            <button
              disabled={editWorking || !editMetros}
              onClick={async () => {
                if (!editMetros) return;
                setEditWorking(true);
                try {
                  await fetchAPI(`/api/contabilidad/ordenes/editar-metros`, {
                    method: 'POST',
                    body: JSON.stringify({ MovIdMovimiento: editMovId, metros: parseFloat(editMetros) })
                  });
                  toast.success('Metros actualizados correctamente');
                  setModalEditarMetros(false);
                  cargar();
                  if (onChanged) onChanged();
                } catch (e) {
                  toast.error(e.message);
                } finally {
                  setEditWorking(false);
                }
              }}
              className="px-4 py-2 text-xs font-bold text-amber-900 bg-amber-400 hover:bg-amber-300 rounded-lg transition-colors disabled:opacity-50"
            >
              {editWorking ? 'Guardando...' : 'Guardar cambios'}
            </button>
          </div>
        </div>
      </div>
    )}

    {/* ── Modal: Insertar orden manual ──────────────────────────────── */}
    {modalNuevaOrden && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 bg-violet-600">
            <div className="flex items-center gap-2">
              <Plus size={16} className="text-white" />
              <span className="font-bold text-white text-sm">Insertar orden manual</span>
            </div>
            <button onClick={() => setModalNuevaOrden(false)} className="p-1 hover:bg-violet-500 rounded-lg transition-colors">
              <X size={14} className="text-white" />
            </button>
          </div>
          <div className="px-5 py-5 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Código de Orden</label>
              <input
                type="text"
                value={nuevaOrden.codigoOrden}
                onChange={e => setNuevaOrden(o => ({ ...o, codigoOrden: e.target.value.toUpperCase() }))}
                placeholder="Ej: DF-101834"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Nombre / Trabajo</label>
              <input
                type="text"
                value={nuevaOrden.nombreTrabajo}
                onChange={e => setNuevaOrden(o => ({ ...o, nombreTrabajo: e.target.value }))}
                placeholder="Ej: Tongatex"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Metros</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={nuevaOrden.metros}
                onChange={e => setNuevaOrden(o => ({ ...o, metros: e.target.value }))}
                placeholder="0.00"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Plan</label>
              <select
                value={nuevaOrden.planId}
                onChange={e => setNuevaOrden(o => ({ ...o, planId: e.target.value }))}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-400"
              >
                <option value="">— Sin plan específico —</option>
                {planes.map(p => (
                  <option key={p.PlaIdPlan} value={p.PlaIdPlan}>
                    Plan #{p.PlaIdPlan} — {p.NombreArticulo || p.PlaUnidad} ({fmtNum(p.PlaCantidadRestante)} {p.PlaUnidad} disponibles)
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-slate-400">Si seleccionás un plan, el movimiento aparecerá en la lista de entregas.</p>
          </div>
          <div className="px-5 pb-5 flex gap-2 justify-end">
            <button
              onClick={() => setModalNuevaOrden(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >Cancelar</button>
            <button
              disabled={nuevaWorking || !nuevaOrden.codigoOrden.trim() || !nuevaOrden.metros}
              onClick={async () => {
                if (!nuevaOrden.codigoOrden.trim() || !nuevaOrden.metros) return;
                setNuevaWorking(true);
                try {
                  await fetchAPI(`/api/contabilidad/ordenes/insertar-manual`, {
                    method: 'POST',
                    body: JSON.stringify({
                      CueIdCuenta: cuenta.CueIdCuenta,
                      CliIdCliente,
                      codigoOrden: nuevaOrden.codigoOrden.trim(),
                      nombreTrabajo: nuevaOrden.nombreTrabajo.trim(),
                      metros: parseFloat(nuevaOrden.metros),
                      planId: nuevaOrden.planId ? parseInt(nuevaOrden.planId) : null,
                      importe: 0
                    })
                  });
                  toast.success(`Orden ${nuevaOrden.codigoOrden} insertada`);
                  setModalNuevaOrden(false);
                  cargar();
                  if (onChanged) onChanged();
                } catch (e) {
                  toast.error(e.message);
                } finally {
                  setNuevaWorking(false);
                }
              }}
              className="px-4 py-2 text-xs font-bold text-white bg-violet-600 hover:bg-violet-700 rounded-lg transition-colors disabled:opacity-50"
            >
              {nuevaWorking ? 'Insertando...' : 'Insertar orden'}
            </button>
          </div>
        </div>
      </div>
    )}
    {/* ── Modal: Confirmar eliminación ─────────────────────────────── */}
    {modalConfirmar && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 bg-rose-50 border-b border-rose-100">
            <div className="w-9 h-9 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
              <Trash2 size={18} className="text-rose-600" />
            </div>
            <div>
              <p className="font-bold text-rose-700 text-sm">Eliminar movimiento</p>
              <p className="text-[11px] text-rose-500">Esta acción restaura los metros al plan</p>
            </div>
          </div>
          <div className="px-5 py-4 space-y-3">
            <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
              <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Concepto</p>
              <p className="text-sm font-semibold text-slate-700 truncate">{modalConfirmar.concepto}</p>
            </div>
            <div className="bg-rose-50 rounded-xl p-3 border border-rose-100 flex items-center gap-3">
              <div className="text-center flex-1">
                <p className="text-[10px] text-rose-400 font-semibold uppercase">Metros a restaurar</p>
                <p className="text-lg font-black text-rose-600">+{fmtNum(modalConfirmar.consumo)} <span className="text-xs font-normal">{modalConfirmar.unidad}</span></p>
              </div>
            </div>
            <p className="text-[11px] text-slate-400 text-center">El saldo del plan volverá a aumentar por esta cantidad.</p>
          </div>
          <div className="px-5 pb-5 flex gap-2">
            <button
              onClick={() => setModalConfirmar(null)}
              disabled={confirmWorking}
              className="flex-1 px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
            >Cancelar</button>
            <button
              disabled={confirmWorking}
              onClick={async () => {
                setConfirmWorking(true);
                try {
                  await fetchAPI(`/api/contabilidad/ordenes/eliminar-metros`, {
                    method: 'POST',
                    body: JSON.stringify({ MovIdMovimiento: modalConfirmar.movId })
                  });
                  toast.success('Movimiento eliminado. Saldo restaurado.');
                  setModalConfirmar(null);
                  cargar();
                  if (onChanged) onChanged();
                } catch (err) {
                  toast.error(err.message);
                } finally {
                  setConfirmWorking(false);
                }
              }}
              className="flex-1 px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-colors disabled:opacity-50"
            >
              {confirmWorking ? <span className="flex items-center justify-center gap-1"><RefreshCw size={11} className="animate-spin" /> Eliminando...</span> : 'Sí, eliminar'}
            </button>
          </div>
        </div>
      </div>
    )}
  </>
  );
};

// ── Modal Estado de Cuenta — diseño limpio por secciones ──────────────────────
const esCreditoTipo = (t) => ['PAGO','ANTICIPO','NOTA_CREDITO','AJUSTE_POS','DEVOLUCION','SALDO_INICIAL'].includes(t);

const ETIQUETA_TIPO = {
  ORDEN:        'Orden',
  ENTREGA:      'Entrega',
  PAGO:         'Pago',
  ANTICIPO:     'Anticipo',
  NOTA_CREDITO: 'Nota cred.',
  NOTA_DEBITO:  'Nota déb.',
  AJUSTE_POS:   'Ajuste +',
  AJUSTE_NEG:   'Ajuste -',
  REPOSICION:   'Reposición',
};

const ModalEstadoCuenta = ({ cliente, cuentas, onClose, globalDesde, globalHasta, onRegistrarPago }) => {
  const [secciones, setSecciones] = useState({});  // { CueIdCuenta: { movs, loading } }
  const [planes, setPlanes]       = useState([]);
  const [ciclosInfo, setCiclosInfo] = useState({});
  const [expandidos, setExpandidos] = useState({});
  const [desde, setDesde] = useState(globalDesde || '');
  const [hasta, setHasta] = useState(globalHasta || '');
  const [cargando, setCargando]   = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const p = new URLSearchParams({ top: 300 });
      if (desde) p.append('desde', desde);
      if (hasta) p.append('hasta', hasta);

      // Movimientos + planes + ciclos en paralelo
      const [planesRes, ciclosRes, ...movsRes] = await Promise.all([
        fetchAPI(`/api/contabilidad/planes/${cliente.CliIdCliente}`).catch(() => ({ data: [] })),
        fetchAPI(`/api/contabilidad/ciclos/${cliente.CliIdCliente}`).catch(() => ({ data: [] })),
        ...cuentas.map(c =>
          fetchAPI(`/api/contabilidad/cuentas/${c.CueIdCuenta}/movimientos?${p}`)
            .then(d => ({ cue: c, movs: d.data || [], saldoArrastre: d.saldoArrastre ?? 0 }))
            .catch(() => ({ cue: c, movs: [], saldoArrastre: 0 }))
        ),
      ]);

      setPlanes(planesRes.data || []);

      const cMap = {};
      (ciclosRes.data || []).forEach(c => cMap[c.CicIdCiclo] = c);
      setCiclosInfo(cMap);

      const nuevas = {};
      movsRes.forEach(({ cue, movs, saldoArrastre }) => {
        nuevas[cue.CueIdCuenta] = { cue, movs, saldoArrastre: saldoArrastre ?? 0 };
      });
      setSecciones(nuevas);

      // Expandir todas por defecto
      const exp = {};
      cuentas.forEach(c => { exp[c.CueIdCuenta] = true; });
      setExpandidos(exp);
    } catch (e) { toast.error(e.message); }
    finally { setCargando(false); }
  }, [cliente.CliIdCliente, cuentas, desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const toggle = (id) => setExpandidos(p => ({ ...p, [id]: !p[id] }));

  const handleFacturarAnticipoConfirm = async (payload) => {
    try {
      await api.post(`/contabilidad/clientes/${cliente.CliIdCliente}/emitir-factura-anticipo`, payload);
      toast.success('Factura de anticipo emitida correctamente.');
      setShowFacturarAnticipo(false);
      cargar(); // recargar movimientos
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Error al facturar anticipo');
      throw err;
    }
  };

  const TIPOS_MONETARIOS = ['USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA','DINERO_USD','DINERO_UYU'];
  const cuentasRecursos   = cuentas.filter(c => c.ProIdProducto != null || !TIPOS_MONETARIOS.includes(c.CueTipo?.toUpperCase()));
  const cuentasMonetarias = cuentas.filter(c => !cuentasRecursos.includes(c));

  // Para cada cuenta de recursos, arma tabla de movimientos con saldo restante calculado desde el plan
  const planDeCuenta = (c) => planes.find(p =>
    p.PlaActivo && String(p.CueIdCuenta || '') === String(c.CueIdCuenta)
  ) || planes.find(p => String(p.CueIdCuenta || '') === String(c.CueIdCuenta));

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-6 pb-4 px-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-slate-50/50 rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col border border-slate-200"
        style={{ maxHeight: '92vh' }}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 bg-[#f1f5f9] rounded-t-2xl border-b border-slate-200 shrink-0">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold">Estado de cuenta</p>
              <h2 className="text-xl font-black text-slate-800 mt-0.5">{cliente.Nombre}</h2>
              {cliente.NombreFantasia && <p className="text-xs text-slate-500">{cliente.NombreFantasia}</p>}
            </div>
            <div className="flex gap-2">
              <button onClick={() => generarPdfEstadoCuenta(cliente, cuentas, secciones, planes, desde, hasta)} className="flex items-center gap-2 p-2 hover:bg-blue-50 hover:text-blue-600 rounded-lg text-slate-500 text-xs font-bold transition-colors">
                <Printer size={16} /> Descargar PDF
              </button>
              <button
                onClick={async () => {
                  const t = toast.loading('Generando Excel...');
                  try {
                    await exportarExcelEstadoCuenta(cliente, cuentas, secciones, planes, desde, hasta);
                    toast.success('Excel descargado', { id: t });
                  } catch (err) {
                    toast.error('Error al generar Excel: ' + err.message, { id: t });
                  }
                }}
                className="flex items-center gap-2 p-2 hover:bg-emerald-50 hover:text-emerald-600 rounded-lg text-slate-500 text-xs font-bold transition-colors"
              >
                <Download size={16} /> Exportar Excel
              </button>
              <button onClick={onClose} className="p-2 hover:bg-slate-700/50 rounded-lg text-slate-500"><X size={16} /></button>
            </div>
          </div>
          <div className="flex gap-2 mt-3 items-center">
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-[#f1f5f9] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400/30" />
            <span className="text-slate-600 text-sm">→</span>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-[#f1f5f9] text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400/30" />
            <button onClick={cargar}
              className="flex items-center gap-1 text-xs px-3 py-1.5 bg-slate-50 text-slate-800 rounded-lg font-medium hover:bg-slate-700">
              <RefreshCw size={11} className={cargando ? 'animate-spin' : ''} /> Filtrar
            </button>
          </div>
        </div>

        {/* ── Cuerpo ──────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {cargando ? (
            <div className="flex justify-center py-16">
              <div className="animate-spin h-7 w-7 border-2 border-slate-400 border-t-transparent rounded-full" />
            </div>
          ) : (
            <>
              {/* ── Cuentas monetarias ─────────────────────────────────── */}
              {cuentasMonetarias.map(c => {
                const sec  = secciones[c.CueIdCuenta];
                const movs = sec?.movs || [];
                const abierto = expandidos[c.CueIdCuenta];
                const saldo   = Number(c.CueSaldoActual ?? 0);

                return (
                  <div key={c.CueIdCuenta} className="bg-[#f1f5f9] rounded-xl border border-slate-200 overflow-hidden">
                    {/* Cabecera de sección */}
                    <button onClick={() => toggle(c.CueIdCuenta)}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center">
                          <DollarSign size={15} className="text-slate-400" />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-bold text-slate-800">{c.UnidadLabel || c.CueTipo}</p>
                          <p className="text-[11px] text-slate-500">{movs.length} movimientos · {c.CondicionPago || 'Contado'}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-[10px] text-slate-500 uppercase">
                            Saldo actual
                          </p>
                          <p className={`text-base font-black ${saldo < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                            {c.MonSimbolo} {fmtNum(saldo)}
                            {saldo > 0 && <span className="text-xs font-bold text-emerald-600 ml-1">(Saldo a favor)</span>}
                            {saldo < 0 && <span className="text-xs font-bold text-red-600 ml-1">(Deuda)</span>}
                          </p>
                        </div>
                        <div className={`w-5 h-5 rounded flex items-center justify-center text-slate-500 transition-transform ${abierto ? 'rotate-180' : ''}`}>
                          ▾
                        </div>
                      </div>
                    </button>

                    {abierto && (
                      <div className="border-t border-slate-200">
                        {/* Mostrar CiclosPanel solo si el cliente es Semanal (o si tiene ciclos de alguna manera, pero acá podemos mostrarlo siempre que aplique) */}
                        <div className="p-4 bg-slate-50/50">
                          <CiclosPanel cuenta={c} CliIdCliente={c.CliIdCliente} cliente={cliente} onClose={() => {}} onCicloChanged={cargar} />
                        </div>
                        {(() => {
                          const visibleMovs = movs.filter(m => m.visualIsVisible !== false);
                          if (visibleMovs.length === 0) {
                            return <p className="text-xs text-slate-500 text-center py-5">Sin movimientos en el período</p>;
                          }
                          return (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-slate-50/50 text-slate-500 uppercase tracking-wide text-[10px]">
                                  <th className="px-5 py-2 text-left font-semibold">Fecha</th>
                                  <th className="px-4 py-2 text-left font-semibold">Tipo</th>
                                  <th className="px-4 py-2 text-left font-semibold">Concepto</th>
                                  <th className="px-4 py-2 text-right font-semibold">Saldo In.</th>
                                  <th className="px-4 py-2 text-right font-semibold">Importe</th>
                                  <th className="px-4 py-2 text-right font-semibold">Saldo Fn.</th>
                                  <th className="px-4 py-2 text-center font-semibold w-12">Recibo</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50">
                                {visibleMovs.map(m => {
                                  const cred = esCreditoTipo(m.MovTipo);
                                  const cicloInfo = ciclosInfo[m.CicIdCiclo];
                                  const isFacturado = m.CicIdCiclo && cicloInfo && cicloInfo.CicEstado !== 'ABIERTO';
                                  return (
                                    <tr key={m.MovIdMovimiento} className="hover:bg-slate-50/50 transition-colors">
                                      <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">{fmtFecha(m.MovFecha)}</td>
                                      <td className="px-4 py-2.5">
                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                          {ETIQUETA_TIPO[m.MovTipo] || m.MovTipo}
                                        </span>
                                      </td>
                                      <td className="px-4 py-2.5 text-slate-600 max-w-[200px] truncate" title={m.MovConcepto}>
                                        {m.MovConcepto}
                                      </td>
                                      <td className="px-4 py-2.5 text-right text-slate-500 font-medium whitespace-nowrap">
                                        {fmtNum(Number(m.visualSaldoAntes ?? (Number(m.MovSaldoPosterior) - Number(m.MovImporte))))} {c.MonSimbolo}
                                      </td>
                                      <td className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${cred ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {cred ? '+' : '-'}{fmtNum(Math.abs(Number(m.visualImporte ?? m.MovImporte)))} {c.MonSimbolo}
                                      </td>
                                      <td className="px-4 py-2.5 text-right text-slate-800 font-bold whitespace-nowrap">
                                        {fmtNum(Number(m.visualSaldoDespues ?? m.MovSaldoPosterior))} {c.MonSimbolo}
                                      </td>
                                      <td className="px-4 py-2.5 text-center">
                                        <MenuAccionesDoc
                                          m={m}
                                          cuenta={c}
                                          cliente={cliente}
                                          onRefresh={cargar}
                                          onPrint={handleDescargarRecibo}
                                          onCobrar={onRegistrarPago}
                                          hideActionsDropdown={true}
                                          hidePrinter={ORDEN_TYPES.includes(m.MovTipo) && (!!m.DocIdDocumento || isFacturado)}
                                        />
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          );
                        })()}
                        {/* Seccion de ordenes pendientes de facturar dentro del modal de Estado de Cuenta */}
                        <div className="bg-white border-t border-slate-200">
                          <OrdenesEstadoCuenta movs={movs} simbolo={c.MonSimbolo} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* ── Cuentas de recursos (una sección por plan) ─────────── */}
              {cuentasRecursos.map(c => {
                const sec     = secciones[c.CueIdCuenta];
                const movs    = sec?.movs || [];
                const abierto = expandidos[c.CueIdCuenta];
                const plan    = planDeCuenta(c);
                const restante    = Number(c.CueSaldoActual ?? 0);
                const totalPlan   = plan ? Number(plan.PlaCantidadTotal) : null;
                const usado       = totalPlan !== null ? Math.max(0, totalPlan - restante) : 0;
                const pct         = totalPlan ? Math.min(100, Math.max(0, (usado / totalPlan) * 100)) : 0;
                const uni         = c.UniSimbolo || c.UnidadLabel || '';

                return (
                  <div key={c.CueIdCuenta} className="bg-[#f1f5f9] rounded-xl border border-slate-200 overflow-hidden">
                    {/* Cabecera */}
                    <button onClick={() => toggle(c.CueIdCuenta)}
                      className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-slate-50/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                          <Layers size={15} className="text-violet-600" />
                        </div>
                        <div className="text-left">
                          <p className="text-sm font-bold text-slate-800">{c.UnidadLabel || c.CueTipo}</p>
                          {c.NombreArticulo && <p className="text-[11px] text-slate-500">{c.NombreArticulo}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        {restante !== null ? (
                          <div className="text-right">
                            <p className="text-[10px] text-slate-500 uppercase">Restante del plan</p>
                            <p className={`text-base font-black ${restante < totalPlan * 0.1 ? 'text-amber-600' : 'text-violet-700'}`}>
                              {fmtNum(restante)} {uni}
                            </p>
                            <div className="w-32 h-1.5 bg-slate-100 rounded-full mt-1 ml-auto">
                              <div className="h-1.5 bg-violet-500 rounded-full transition-all"
                                style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-[10px] text-slate-500 mt-0.5">{fmtNum(usado)} / {fmtNum(totalPlan)} {uni} usados</p>
                          </div>
                        ) : (
                          <div className="text-right">
                            <p className="text-[10px] text-slate-500 uppercase">Consumido</p>
                            <p className="text-base font-black text-slate-700">{fmtNum(restante)} {uni}</p>
                          </div>
                        )}
                        <div className={`w-5 h-5 rounded flex items-center justify-center text-slate-500 transition-transform ${abierto ? 'rotate-180' : ''}`}>
                          ▾
                        </div>
                      </div>
                    </button>

                    {abierto && (
                      <div className="border-t border-slate-200">
                        {movs.length === 0 ? (
                          <p className="text-xs text-slate-500 text-center py-5">Sin movimientos en el período</p>
                        ) : (
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="bg-slate-50/50 text-slate-500 uppercase tracking-wide text-[10px]">
                                <th className="px-5 py-2 text-left font-semibold">Fecha</th>
                                <th className="px-4 py-2 text-left font-semibold">Tipo</th>
                                <th className="px-4 py-2 text-left font-semibold">Concepto</th>
                                <th className="px-4 py-2 text-right font-semibold">Consumo</th>
                                <th className="px-4 py-2 text-right font-semibold">Acum. usado</th>
                                {totalPlan && <th className="px-4 py-2 text-right font-semibold">Quedan</th>}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {/* Mostrar en orden cronológico para calcular acumulado */}
                              {[...movs].reverse().reduce((acc, m) => {
                                const quedan = Number(m.MovSaldoPosterior ?? 0);
                                const acumUsado = totalPlan !== null ? Math.max(0, totalPlan - quedan) : 0;
                                const importe = Number(m.MovImporte);
                                const isNeg = importe < 0;
                                acc.push({ ...m, _quedan: quedan, _acum: acumUsado, _isNeg: isNeg, _importeAbs: Math.abs(importe) });
                                return acc;
                              }, []).reverse().map(m => (
                                <tr key={m.MovIdMovimiento} className="hover:bg-slate-50/50 transition-colors">
                                  <td className="px-5 py-2.5 text-slate-500 whitespace-nowrap">{fmtFecha(m.MovFecha)}</td>
                                  <td className="px-4 py-2.5">
                                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-50 text-violet-700">
                                      {ETIQUETA_TIPO[m.MovTipo] || m.MovTipo}
                                    </span>
                                  </td>
                                  <td className="px-4 py-2.5 text-slate-600 max-w-[180px] truncate" title={m.MovConcepto}>
                                    {m.MovConcepto}
                                  </td>
                                  <td className={`px-4 py-2.5 text-right font-semibold whitespace-nowrap ${m._isNeg ? 'text-rose-600' : 'text-emerald-600'}`}>
                                    {m._isNeg ? '-' : '+'}{fmtNum(m._importeAbs)} {uni}
                                  </td>
                                  <td className="px-4 py-2.5 text-right text-slate-400 whitespace-nowrap">
                                    {fmtNum(m._acum)} {uni}
                                  </td>
                                  {totalPlan && (
                                    <td className={`px-4 py-2.5 text-right font-bold whitespace-nowrap ${m._quedan < totalPlan * 0.1 ? 'text-amber-600' : 'text-violet-700'}`}>
                                      {fmtNum(m._quedan)} {uni}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {Object.keys(secciones).length === 0 && !cargando && (
                <div className="text-center py-16 text-slate-500">
                  <BarChart3 size={32} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Sin movimientos registrados</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        <div className="px-6 py-2.5 border-t border-slate-200 bg-[#f1f5f9] rounded-b-2xl shrink-0
          flex items-center justify-between text-[11px] text-slate-500">
          <span>{cuentas.length} cuenta{cuentas.length !== 1 ? 's' : ''} · {planes.length} plan{planes.length !== 1 ? 'es' : ''}</span>
          <span>Más reciente primero</span>
        </div>
      </div>
    </div>
  );
};

// ── Card de cuenta ──────────────────────────────────────────
const CuentaCard = ({ cuenta, CliIdCliente, panelActivo, onToggle, onCicloChanged, onRegistrarPago }) => {
  const saldo      = Number(cuenta.CueSaldoActual);
  const deuda      = Number(cuenta.DeudaPendienteTotal ?? 0);
  const negativo   = saldo < 0;
  const esSemanal  = (cuenta.CueDiasCiclo ?? 0) > 0;
  const TIPOS_MONETARIOS = ['USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA','DINERO_USD','DINERO_UYU'];
  const esRecursos = cuenta.ProIdProducto != null || !TIPOS_MONETARIOS.includes(cuenta.CueTipo?.toUpperCase());
  const unidadLabel = cuenta.UnidadLabel || cuenta.CueTipo;

  return (
    <div className={`bg-white rounded-xl border transition-colors shadow-sm mb-2 ${panelActivo ? 'border-indigo-300 ring-2 ring-indigo-50' : 'border-slate-200 hover:border-indigo-200'}`}>
      <div className="px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        
        {/* Lado Izquierdo: Moneda y Saldos */}
        <div className="flex items-center gap-4">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black tracking-widest text-slate-500 uppercase">{unidadLabel}</span>
              {esRecursos && <span className="text-[9px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-widest">Recurso</span>}
              {!esRecursos && negativo && <span className="text-[9px] bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-widest">Saldo Deudor</span>}
              {!esRecursos && !negativo && saldo > 0 && <span className="text-[9px] bg-emerald-100 text-emerald-600 px-1.5 py-0.5 rounded font-bold uppercase tracking-widest">Saldo a Favor</span>}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <span className={`text-xl font-black ${esRecursos ? 'text-violet-600' : negativo ? 'text-rose-600' : 'text-emerald-600'}`}>
                {esRecursos ? `${fmtNum(saldo)} ${cuenta.UniSimbolo || unidadLabel}` : fmt(saldo, cuenta.MonSimbolo)}
              </span>
            </div>
          </div>

          {/* Info Extra Condensada (Solo si no es recurso y tiene deuda/docs) */}
          {!esRecursos && (deuda > 0 || cuenta.DocumentosVencidos > 0 || Number(cuenta.PendienteFacturar || 0) > 0) && (
            <div className="flex items-center gap-3 pl-4 ml-2 border-l border-slate-200">
              {Number(cuenta.PendienteFacturar || 0) > 0 && (
                <div className="flex flex-col border-r border-slate-100 pr-3 mr-1">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Pendiente Facturar</span>
                  <span className="text-sm font-bold text-amber-600">{fmt(Number(cuenta.PendienteFacturar), cuenta.MonSimbolo)}</span>
                </div>
              )}
              {deuda > 0 && (
                <div className="flex flex-col">
                  <span className="text-[9px] text-slate-400 font-bold uppercase tracking-widest">Deuda Vencida/Facturada</span>
                  <span className="text-sm font-bold text-rose-600">{fmt(deuda, cuenta.MonSimbolo)}</span>
                </div>
              )}
              {cuenta.DocumentosVencidos > 0 && (
                <div className="flex items-center gap-1.5 bg-rose-50 text-rose-600 px-2.5 py-1 rounded-lg border border-rose-100">
                  <AlertTriangle size={14} />
                  <span className="text-xs font-bold">{cuenta.DocumentosVencidos} Venc.</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Lado Derecho: Botones de Acción */}
        <div className="flex items-center gap-2">
          {!esRecursos && (
            <>
              <button onClick={() => onToggle('mov')}
                className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-bold border transition-all
                  ${panelActivo === 'mov' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md' : 'bg-slate-50 text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 border-slate-200'}`}>
                <BarChart3 size={14} /> Historial
              </button>
              {deuda > 0 && (
                <button onClick={() => onToggle('deuda')}
                  className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-bold border transition-all
                    ${panelActivo === 'deuda' ? 'bg-rose-600 text-white border-rose-600 shadow-md' : 'bg-rose-50 text-rose-600 hover:bg-rose-100 border-rose-200'}`}>
                  <FileText size={14} /> Ver Pendientes
                </button>
              )}
            </>
          )}
          {esSemanal && (
            <button onClick={() => onToggle('ciclo')}
              className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-bold border transition-all
                ${panelActivo === 'ciclo' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border-indigo-200'}`}>
              <Calendar size={14} /> Ciclos
            </button>
          )}
          {!esRecursos && (
            <button onClick={() => onRegistrarPago(cuenta)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-black border transition-all bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200 shadow-sm ml-2">
              <DollarSign size={14} /> Cobrar / Ajustar
            </button>
          )}
        </div>

      </div>
    </div>
  );
};

export default function ContabilidadCuentasView() {
  const [busqueda, setBusqueda]               = useState('');
  const [filtroTipoCliente, setFiltroTipoCliente] = useState('');
  const [clientesActivos, setClientesActivos] = useState([]);
  const [clienteSel, setClienteSel]           = useState(null);
  const [cuentas, setCuentas]                 = useState([]);
  const [loadingLista, setLoadingLista]       = useState(false);
  const [loadingCuentas, setLoadingCuentas]   = useState(false);
  const [paneles, setPaneles]                 = useState({});
  const [modalPago, setModalPago]             = useState(null);
  const [tabCuentas, setTabCuentas]           = useState('SALDOS');
  const [refreshBilletera, setRefreshBilletera] = useState(0);

  const [ordenesAnticipo, setOrdenesAnticipo] = useState([]);
  const [showFacturarAnticipo, setShowFacturarAnticipo] = useState(false);

  const [globalDesde, setGlobalDesde] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0]; });
  const [globalHasta, setGlobalHasta] = useState(() => new Date().toISOString().split('T')[0]);
  const [globalFiltroTrigger, setGlobalFiltroTrigger] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();
  const [hasAutoSelected, setHasAutoSelected] = useState(false);
  const [modalCancelarOrden, setModalCancelarOrden] = useState(null); // { orden }
  const [cancelWorking, setCancelWorking] = useState(false);

  const cargarClientesActivos = useCallback(async (q = '', tipo = '') => {
    setLoadingLista(true);
    try {
      const qp = new URLSearchParams();
      if (q.trim()) {
         qp.append('q', q.trim());
      }
      if (tipo) {
         qp.append('tipoCliente', tipo);
      }
      qp.append('todos', 'true');
      const data = await fetchAPI(`/api/contabilidad/clientes-activos?${qp.toString()}`);
      setClientesActivos(data.data || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoadingLista(false); }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      cargarClientesActivos(busqueda, filtroTipoCliente);
    }, 400);
    return () => clearTimeout(timer);
  }, [busqueda, filtroTipoCliente, cargarClientesActivos]);

  const seleccionarCliente = async (cli) => {
    if (clienteSel?.CliIdCliente === cli.CliIdCliente) { setClienteSel(null); return; }
    setClienteSel(cli);
    setLoadingCuentas(true);
    setOrdenesAnticipo([]);
    try {
      const [data, anticiposRes] = await Promise.all([
         fetchAPI(`/api/contabilidad/cuentas/${cli.CliIdCliente}`),
         fetchAPI(`/api/contabilidad/clientes/${cli.CliIdCliente}/ordenes-anticipo`).catch(() => ({ data: [] }))
      ]);
      const cuents = data.data || [];
      setCuentas(cuents);
      setOrdenesAnticipo(anticiposRes.data || []);
      const nuevosPaneles = {};
      cuents.forEach(c => nuevosPaneles[c.CueIdCuenta] = 'mov');
      setPaneles(nuevosPaneles);
    } catch (e) { toast.error(e.message); }
    finally { setLoadingCuentas(false); }
  };

  useEffect(() => {
    if (location.state?.selectedClienteId && clientesActivos.length > 0 && !hasAutoSelected) {
      const targetId = Number(location.state.selectedClienteId);
      const found = clientesActivos.find(c => c.CliIdCliente === targetId);
      if (found) {
        setHasAutoSelected(true);
        seleccionarCliente(found);
      }
    }
  }, [location.state, clientesActivos, hasAutoSelected]);

  const recargarCuentas = async () => {
    if (!clienteSel) return;
    setLoadingCuentas(true);
    try {
      const [data, anticiposRes] = await Promise.all([
         fetchAPI(`/api/contabilidad/cuentas/${clienteSel.CliIdCliente}`),
         fetchAPI(`/api/contabilidad/clientes/${clienteSel.CliIdCliente}/ordenes-anticipo`).catch(() => ({ data: [] }))
      ]);
      setCuentas(data.data || []);
      setOrdenesAnticipo(anticiposRes.data || []);
      await cargarClientesActivos(busqueda);
      setRefreshBilletera(prev => prev + 1);
    } catch (e) { toast.error(e.message); }
    finally { setLoadingCuentas(false); }
  };

  const handleFacturarAnticipoConfirm = async (cicloId, payload) => {
    try {
      // Usamos el payload completo que nos da CierreCicloPreviewModal (que incluye monedaFactura, detallesEditados, descuentoValorBase, etc)
      // Agregamos las ordenes al payload usando movsOriginales o lo que haya en la vista (ordenesAnticipo)
      const excluidosSet = new Set(payload.excluidos || []);
      const ordenesParaFacturar = ordenesFiltradas
        .filter(o => !excluidosSet.has(o.MovIdMovimiento))
        .map(o => o.OrdIdOrden || o.MovIdMovimiento);

      const payloadCompleto = {
        ...payload,
        ordenesIds: ordenesParaFacturar,
      };

      await api.post(`/contabilidad/clientes/${clienteSel.CliIdCliente}/emitir-factura-anticipo`, payloadCompleto);
      toast.success('Factura de anticipo emitida correctamente.');
      setShowFacturarAnticipo(false);
      recargarCuentas(); 
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Error al facturar anticipo');
      throw err;
    }
  };

  const togglePanel = (cueId, tipo) =>
    setPaneles(prev => ({ ...prev, [cueId]: prev[cueId] === tipo ? null : tipo }));

  const [generandoPdf, setGenerandoPdf] = useState(false);

  const handleImprimirEstadoCuenta = async () => {
    if (!clienteSel || cuentas.length === 0) return;
    setGenerandoPdf(true);
    const toastId = toast.loading('Generando PDF del Estado de Cuenta...');
    try {
      const p = new URLSearchParams({ top: 300 });
      if (globalDesde) p.append('desde', globalDesde);
      if (globalHasta) p.append('hasta', globalHasta);

      // Fetch planes and movements in parallel
      const [planesRes, ...movsRes] = await Promise.all([
        fetchAPI(`/api/contabilidad/planes/${clienteSel.CliIdCliente}`).catch(() => ({ data: [] })),
        ...cuentas.map(c =>
          fetchAPI(`/api/contabilidad/cuentas/${c.CueIdCuenta}/movimientos?${p}`)
            .then(d => ({ cue: c, movs: d.data || [], saldoArrastre: d.saldoArrastre ?? 0 }))
            .catch(() => ({ cue: c, movs: [], saldoArrastre: 0 }))
        ),
      ]);

      const planes = planesRes.data || [];
      const secciones = {};
      movsRes.forEach(({ cue, movs, saldoArrastre }) => {
        secciones[cue.CueIdCuenta] = { cue, movs, saldoArrastre: saldoArrastre ?? 0 };
      });

      await generarPdfEstadoCuenta(clienteSel, cuentas, secciones, planes, globalDesde, globalHasta);
      toast.success('PDF descargado con éxito.', { id: toastId });
    } catch (e) {
      console.error(e);
      toast.error('Error al generar el PDF: ' + e.message, { id: toastId });
    } finally {
      setGenerandoPdf(false);
    }
  };

  const [exportandoExcel, setExportandoExcel] = useState(false);

  const handleExportarExcel = async () => {
    if (!clienteSel || cuentas.length === 0) return;
    setExportandoExcel(true);
    const toastId = toast.loading('Generando Excel del Estado de Cuenta...');
    try {
      const p = new URLSearchParams({ top: 300 });
      if (globalDesde) p.append('desde', globalDesde);
      if (globalHasta) p.append('hasta', globalHasta);

      const [planesRes, ...movsRes] = await Promise.all([
        fetchAPI(`/api/contabilidad/planes/${clienteSel.CliIdCliente}`).catch(() => ({ data: [] })),
        ...cuentas.map(c =>
          fetchAPI(`/api/contabilidad/cuentas/${c.CueIdCuenta}/movimientos?${p}`)
            .then(d => ({ cue: c, movs: d.data || [], saldoArrastre: d.saldoArrastre ?? 0 }))
            .catch(() => ({ cue: c, movs: [], saldoArrastre: 0 }))
        ),
      ]);

      const planes = planesRes.data || [];
      const seccionesExcel = {};
      movsRes.forEach(({ cue, movs, saldoArrastre }) => {
        seccionesExcel[cue.CueIdCuenta] = { cue, movs, saldoArrastre: saldoArrastre ?? 0 };
      });

      await exportarExcelEstadoCuenta(clienteSel, cuentas, seccionesExcel, planes, globalDesde, globalHasta);
      toast.success('Excel descargado con éxito.', { id: toastId });
    } catch (e) {
      console.error(e);
      toast.error('Error al generar Excel: ' + e.message, { id: toastId });
    } finally {
      setExportandoExcel(false);
    }
  };

  const saldoTotal   = cuentas.reduce((s, c) => s + Number(c.CueSaldoActual ?? 0), 0);
  const deudaTotal   = cuentas.reduce((s, c) => s + Number(c.DeudaPendienteTotal ?? 0), 0);
  const docsVencidos = cuentas.reduce((s, c) => s + Number(c.DocumentosVencidos ?? 0), 0);

  const mostrarClientes = useMemo(() => {
    return clientesActivos;
  }, [clientesActivos]);

  const cuentaActiva = useMemo(() => {
    if (!cuentas || cuentas.length === 0) return null;
    const TIPOS_MONETARIOS = ['USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA','DINERO_USD','DINERO_UYU'];
    
    if (tabCuentas === 'RECURSOS') return null; // Recursos shows all resource accounts, no single 'cuentaActiva'

    return cuentas.find(c => {
      const esRecurso = c.ProIdProducto != null || !TIPOS_MONETARIOS.includes(c.CueTipo?.toUpperCase());
      if (esRecurso) return false;
      if (tabCuentas === 'USD') return c.MonSimbolo === 'US$' || c.CueTipo === 'DINERO_USD';
      return c.MonSimbolo !== 'US$' && c.CueTipo !== 'DINERO_USD'; // UYU default
    });
  }, [cuentas, tabCuentas]);

  const ordenesFiltradas = useMemo(() => {
    if (!cuentaActiva) return [];
    return ordenesAnticipo.filter(o => o.CueIdCuenta === cuentaActiva.CueIdCuenta);
  }, [ordenesAnticipo, cuentaActiva]);

  return (
    <>
      {/* Modal pago */}
      {modalPago && (
        <ModalPago
          cuenta={modalPago}
          onClose={() => setModalPago(null)}
          onSuccess={recargarCuentas}
        />
      )}



      <div className="bg-[#f1f5f9] p-2 sm:p-4 text-slate-700 font-sans custom-scrollbar">
        <div className="flex flex-col md:flex-row gap-6 max-w-[1500px] mx-auto w-full items-start">

        {/* ── Columna izquierda: lista ────────────────────────────────────── */}
        <div className="w-full md:w-80 shrink-0 flex flex-col bg-[#f1f5f9] rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-4 border-b border-slate-200 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h1 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <Users size={16} className="text-indigo-400" />Clientes con Saldo
              </h1>
              <button onClick={() => cargarClientesActivos(busqueda, filtroTipoCliente)} title="Actualizar"
                className="p-1.5 hover:bg-slate-700/50 rounded-lg transition-colors text-slate-500 hover:text-slate-600">
                <RefreshCw size={13} className={loadingLista ? 'animate-spin' : ''} />
              </button>
            </div>
            
            <div className="flex gap-2">
              <div className="relative flex-1 flex items-center">
                <div className="absolute left-3 text-slate-400">
                  <Search size={14} />
                </div>
                <input 
                  type="text" 
                  placeholder="Buscar..." 
                  value={busqueda}
                  onChange={e => setBusqueda(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-indigo-500 focus:bg-white rounded-xl pl-9 pr-8 py-2 text-xs font-bold text-slate-800 placeholder-slate-400 outline-none transition-all" 
                />
                {loadingLista && (
                  <div className="absolute right-3">
                    <RefreshCw size={12} className="text-indigo-500 animate-spin" />
                  </div>
                )}
              </div>
              <select
                value={filtroTipoCliente}
                onChange={e => setFiltroTipoCliente(e.target.value)}
                className="bg-slate-50 border border-slate-200 hover:border-slate-300 focus:border-indigo-500 rounded-xl px-2 py-2 text-xs font-bold text-slate-700 outline-none transition-all w-[100px]"
              >
                <option value="">Todos</option>
                <option value="1">Común</option>
                <option value="2">Semanal</option>
                <option value="3">Rollo</option>
              </select>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loadingLista ? (
              <div className="flex justify-center py-12"><div className="animate-spin h-6 w-6 border-2 border-blue-500 border-t-transparent rounded-full" /></div>
            ) : clientesActivos.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <Zap size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs">Sin clientes con saldo activo</p>
              </div>
            ) : (
              mostrarClientes.map(c => (
                <FilaCliente key={c.CliIdCliente} c={c}
                  seleccionado={clienteSel?.CliIdCliente === c.CliIdCliente}
                  onClick={() => seleccionarCliente(c)} />
              ))
            )}
          </div>

          <div className="px-4 py-2.5 border-t border-slate-200 text-[11px] text-slate-500 text-center">
            {mostrarClientes.length} clientes mostrando
          </div>
        </div>

        {/* ── Columna derecha: detalle ────────────────────────────────────── */}
        <div className="flex-1 space-y-4 min-w-0">
          {!clienteSel ? (
            <div className="flex flex-col items-center justify-center h-full text-slate-500">
              <CreditCard size={48} className="mb-4 opacity-20" />
              <p className="text-base font-medium">Seleccioná un cliente</p>
              <p className="text-sm mt-1">para ver sus cuentas, movimientos y ciclos</p>
            </div>
          ) : (
            <>
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-4 overflow-hidden animate-in fade-in duration-300">
                <div className="p-5 flex flex-col xl:flex-row gap-6">
                  
                  {/* Tarjeta de Información de Cliente (Estilo Caja) */}
                  <div className="bg-indigo-50/30 border border-indigo-100/80 rounded-2xl p-4 flex flex-col gap-3 w-full xl:w-96 shrink-0 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-extrabold text-lg shadow-md shadow-indigo-600/10 shrink-0">
                          <User size={18} />
                        </div>
                        <div className="min-w-0">
                          <h2 className="text-sm font-black text-slate-800 leading-tight truncate max-w-[200px]" title={clienteSel.Nombre}>{clienteSel.Nombre}</h2>
                          <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider font-mono mt-0.5">
                            IDCliente: {clienteSel.IDCliente || clienteSel.CodCliente || clienteSel.CliIdCliente}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 items-end shrink-0">
                        <span className="text-emerald-600 flex items-center gap-0.5 text-[8px] font-black bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-100 select-none">
                          VERIFICADO <CheckCircle2 size={10} />
                        </span>
                        <span className={`text-[8px] font-black px-2 py-0.5 rounded-full border select-none ${clienteSel.TClIdTipoCliente === 2 ? 'text-indigo-600 bg-indigo-50 border-indigo-100' : clienteSel.TClIdTipoCliente === 3 ? 'text-violet-600 bg-violet-50 border-violet-100' : clienteSel.TClIdTipoCliente === 4 ? 'text-rose-600 bg-rose-50 border-rose-100' : 'text-slate-600 bg-slate-50 border-slate-100'}`}>
                          {clienteSel.TipoClienteDescripcion ? clienteSel.TipoClienteDescripcion.toUpperCase() : 'COMÚN'}
                        </span>
                      </div>
                    </div>
                    
                    {clienteSel.NombreFantasia && (
                      <p className="text-xs text-slate-500 font-semibold italic px-1 truncate">"{clienteSel.NombreFantasia}"</p>
                    )}

                    <div className="flex flex-col gap-1 text-xs text-slate-500 font-medium border-t border-slate-200/60 pt-3">
                      {clienteSel.CioRuc && <div>RUC / CI: <span className="font-mono font-bold text-slate-800">{clienteSel.CioRuc}</span></div>}
                      {clienteSel.Email && <div className="truncate" title={clienteSel.Email}>Email: <span className="font-mono text-slate-700">{clienteSel.Email}</span></div>}
                      {clienteSel.TelefonoTrabajo && <div>Teléfono: <span className="font-mono text-slate-700">{clienteSel.TelefonoTrabajo}</span></div>}
                      {clienteSel.DireccionTrabajo && <div className="leading-tight">Dirección: <span className="text-slate-700">{clienteSel.DireccionTrabajo}</span></div>}
                    </div>
                  </div>

                  {/* Billetera, Recursos y Controles de Cuentas */}
                  <div className="flex-1 flex flex-col justify-between gap-4">
                    {/* Fila Superior: Controles (Tabs, Imprimir, Actualizar) */}
                    <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-slate-100">
                      <div className="flex bg-slate-100 rounded-xl border border-slate-200 p-0.5 gap-0.5 select-none">
                        <button 
                          type="button"
                          onClick={() => setTabCuentas('UYU')} 
                          className={`relative px-4 py-2 text-xs font-black rounded-lg transition-colors uppercase tracking-widest ${tabCuentas === 'UYU' || tabCuentas === 'SALDOS' ? 'bg-white text-indigo-600 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                        >
                          UYU
                          {cuentas.some(c => (c.CueTipo?.includes('UYU') || c.MonIdMoneda === 1) && (Number(c.CueSaldoActual) !== 0 || c.DocumentosVencidos > 0 || Number(c.DeudaPendienteTotal) > 0)) && (
                            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-indigo-500 border border-white animate-pulse"></span>
                          )}
                        </button>
                        <button 
                          type="button"
                          onClick={() => setTabCuentas('USD')} 
                          className={`relative px-4 py-2 text-xs font-black rounded-lg transition-colors uppercase tracking-widest ${tabCuentas === 'USD' ? 'bg-white text-emerald-600 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                        >
                          USD
                          {cuentas.some(c => (c.CueTipo?.includes('USD') || c.MonIdMoneda === 2) && (Number(c.CueSaldoActual) !== 0 || c.DocumentosVencidos > 0 || Number(c.DeudaPendienteTotal) > 0)) && (
                            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-500 border border-white animate-pulse"></span>
                          )}
                        </button>
                        <button 
                          type="button"
                          onClick={() => setTabCuentas('RECURSOS')} 
                          className={`relative px-4 py-2 text-xs font-black rounded-lg transition-colors uppercase tracking-widest ${tabCuentas === 'RECURSOS' ? 'bg-white text-violet-600 shadow-sm border border-slate-200/50' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                        >
                          Recursos
                          {cuentas.some(c => (c.ProIdProducto != null || !['USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA','DINERO_USD','DINERO_UYU'].includes(c.CueTipo?.toUpperCase())) && Number(c.CueSaldoActual) !== 0) && (
                            <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-violet-500 border border-white animate-pulse"></span>
                          )}
                        </button>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={handleImprimirEstadoCuenta}
                          title="Imprimir Estado de Cuenta"
                          disabled={cuentas.length === 0 || generandoPdf}
                          className="p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors disabled:opacity-40 border border-slate-200 hover:border-slate-300 shadow-sm"
                        >
                          {generandoPdf ? <RefreshCw size={14} className="animate-spin" /> : <Printer size={14} />}
                        </button>
                        <button
                          type="button"
                          onClick={handleExportarExcel}
                          title="Exportar Estado de Cuenta a Excel"
                          disabled={cuentas.length === 0 || exportandoExcel}
                          className="p-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-lg transition-colors disabled:opacity-40 border border-emerald-200 hover:border-emerald-300 shadow-sm"
                        >
                          {exportandoExcel ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                        </button>
                        <button 
                          type="button"
                          onClick={recargarCuentas} 
                          disabled={loadingCuentas} 
                          title="Actualizar"
                          className="p-2.5 bg-slate-50 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors disabled:opacity-40 border border-slate-200 hover:border-slate-300 shadow-sm"
                        >
                          <RefreshCw size={14} className={loadingCuentas ? 'animate-spin' : ''} />
                        </button>
                      </div>
                    </div>

                    {/* Componente de Billetera y Recursos en tiempo real */}
                    <div className="flex-1 flex items-center min-h-[60px]">
                      <ClienteBilletera key={`${clienteSel.CliIdCliente}_${refreshBilletera}`} clienteId={clienteSel.CliIdCliente} clienteNombre={clienteSel.Nombre} />
                    </div>
                  </div>

                </div>

                {/* FILTRO GLOBAL DE FECHAS */}
                <div className="px-5 py-2.5 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-widest">
                    <Calendar size={14} /> Filtro de período
                  </div>
                  <div className="flex items-center gap-3">
                    <input type="date" value={globalDesde} onChange={e => setGlobalDesde(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 font-medium text-slate-700 bg-white shadow-sm" />
                    <span className="text-slate-400 text-xs font-black">→</span>
                    <input type="date" value={globalHasta} onChange={e => setGlobalHasta(e.target.value)} className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30 font-medium text-slate-700 bg-white shadow-sm" />
                    <button onClick={() => setGlobalFiltroTrigger(t => t + 1)} className="text-xs font-bold uppercase tracking-widest px-4 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg transition-colors shadow-sm">Aplicar</button>
                  </div>
                </div>
              </div>

              {loadingCuentas ? (
                <div className="flex justify-center py-12"><div className="animate-spin h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full" /></div>
              ) : cuentas.length === 0 ? (
                <div className="text-center py-12 bg-[#f1f5f9] rounded-xl border border-slate-200">
                  <CreditCard size={32} className="mx-auto mb-3 text-slate-600" />
                  <p className="text-sm text-slate-400">Sin cuentas contables registradas</p>
                </div>
              ) : (
                <>
                  {/* Panel de Órdenes Pendientes de Facturar */}
                  {ordenesFiltradas.length > 0 && (
                    <div className="mb-4 rounded-xl border border-emerald-200 overflow-hidden shadow-sm animate-in fade-in duration-300">
                      <div className="flex items-center justify-between px-4 py-3 bg-emerald-600 text-white">
                        <div className="flex items-center gap-2">
                          <i className="fa-solid fa-file-invoice-dollar text-sm"></i>
                          <span className="text-sm font-semibold">
                            Órdenes Pendientes de Facturar
                          </span>
                          <span className="bg-white/20 text-white text-[10px] font-bold px-2 py-0.5 rounded-full animate-pulse">
                            ● {ordenesFiltradas.length} PENDIENTE{ordenesFiltradas.length > 1 ? 'S' : ''}
                          </span>
                        </div>
                        <button 
                          onClick={() => {
                            // Navegar a la página completa de pre-factura
                            navigate('/contabilidad/prefactura', {
                              state: {
                                ciclo: { CicIdCiclo: (cuentaActiva && Number(cuentaActiva.CueSaldoActual || 0) > 0) ? 'ANTICIPO' : 'CREDITO', CicFechaInicio: new Date().toISOString(), CicFechaCierre: new Date().toISOString() },
                                cliente: clienteSel,
                                cuenta: cuentaActiva || cuentas[0],
                                movsOriginales: ordenesFiltradas.map(m => ({
                                  ...m,
                                  MovImporte: m.MovImporte < 0 ? m.MovImporte : -Math.abs(m.MovImporte)
                                })),
                                returnTo: '/contabilidad/cuentas',
                              }
                            });
                          }}
                          className="flex items-center gap-1.5 text-xs px-3.5 py-2 bg-white/20 hover:bg-white/30 text-white rounded-lg transition-colors font-bold">
                          <i className="fa-solid fa-file-invoice-dollar"></i>
                          Revisar y Facturar Todas
                        </button>
                      </div>
                      <div className="divide-y divide-emerald-100 bg-emerald-50/30">
                        {ordenesFiltradas.map(orden => (
                          <div key={orden.MovIdMovimiento} className="flex items-center justify-between px-4 py-2.5 hover:bg-emerald-50 transition-colors group">
                            <div className="flex items-center gap-3 flex-1 min-w-0">
                              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></div>
                              <div className="flex flex-col min-w-0">
                                <span className="text-xs font-bold text-slate-700 truncate">
                                  {orden.OrdCodigoOrden || orden.MovConcepto || `Mov #${orden.MovIdMovimiento}`}
                                </span>
                                {orden.OrdNombreTrabajo && (
                                  <span className="text-[10px] text-slate-500 truncate">{orden.OrdNombreTrabajo}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <span className="text-xs font-bold text-emerald-700 font-mono">
                                {cuentaActiva?.MonSimbolo || '$'} {new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(orden.MovImporte))}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setModalCancelarOrden({ orden });
                                }}
                                title="Cancelar esta orden"
                                className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded border border-rose-200">
                                <X size={10} /> Cancelar
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="px-4 py-2 bg-white border-t border-emerald-200 flex items-center justify-between">
                        <span className="text-[10px] text-slate-400 font-bold uppercase">
                          Total: {ordenesFiltradas.length} orden(es)
                        </span>
                        <span className="text-sm font-black text-emerald-700">
                          {cuentaActiva?.MonSimbolo || '$'} {new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ordenesFiltradas.reduce((sum, o) => sum + Math.abs(o.MovImporte), 0))}
                        </span>
                      </div>
                    </div>
                  )}

                  {tabCuentas !== 'RECURSOS' && cuentaActiva && (
                    <div className="animate-in fade-in duration-300">
                      {/* CiclosPanel ocultado — el panel verde "Revisar y Facturar" ya gestiona 
                          la creación/cierre del ciclo de forma transparente */}
                      <MovimientosPanel 
                        CueIdCuenta={cuentaActiva.CueIdCuenta} 
                        simbolo={cuentaActiva.MonSimbolo || '$'} 
                        onClose={() => setClienteSel(null)} 
                        cuenta={cuentaActiva} 
                        CliIdCliente={clienteSel.CliIdCliente}
                        cliente={clienteSel}
                        onRegistrarPago={setModalPago}
                        desde={globalDesde}
                        hasta={globalHasta}
                        trigger={globalFiltroTrigger}
                        ordenesPendientes={ordenesFiltradas}
                      />
                    </div>
                  )}

                  {tabCuentas === 'RECURSOS' && (() => {
                    const recursoCuentas = cuentas.filter(c => {
                      const TIPOS_MONETARIOS = ['USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA','DINERO_USD','DINERO_UYU'];
                      return c.ProIdProducto != null || !TIPOS_MONETARIOS.includes(c.CueTipo?.toUpperCase());
                    });
                    if (recursoCuentas.length === 0) return null;
                    return recursoCuentas.map(cuenta => (
                      <div key={cuenta.CueIdCuenta} className="animate-in fade-in duration-300">
                        <PlanesPanel
                          cuenta={cuenta}
                          CliIdCliente={clienteSel.CliIdCliente}
                          cliente={clienteSel}
                          desde={globalDesde}
                          hasta={globalHasta}
                          onClose={() => {}}
                          onChanged={recargarCuentas}
                        />
                      </div>
                    ));
                  })()}

                  {tabCuentas !== 'RECURSOS' && !cuentaActiva && (
                    <p className="text-center text-slate-400 text-sm py-8 bg-[#f1f5f9] rounded-xl border border-slate-200 border-dashed">No hay cuenta activa en esta moneda.</p>
                  )}
                  {tabCuentas === 'RECURSOS' && cuentas.filter(c => {
                    const TIPOS_MONETARIOS = ['USD','UYU','ARS','EUR','PYG','BRL','CORRIENTE','CREDITO','DEBITO','CAJA','DINERO_USD','DINERO_UYU'];
                    return c.ProIdProducto != null || !TIPOS_MONETARIOS.includes(c.CueTipo?.toUpperCase());
                  }).length === 0 && (
                    <p className="text-center text-slate-400 text-sm py-8 bg-[#f1f5f9] rounded-xl border border-slate-200 border-dashed">No hay planes ni recursos para este cliente.</p>
                  )}
                </>
              )}
            </>
          )}
        </div>
        </div>
      </div>

      {/* Pre-factura ahora es una página completa (/contabilidad/prefactura) — se abre via navigate */}
      {/* ── Modal: Confirmar cancelación de orden ───────────────────────── */}
      {modalCancelarOrden && (() => {
        const ord = modalCancelarOrden.orden;
        const codigo = ord.OrdCodigoOrden || ord.MovConcepto || `Mov#${ord.MovIdMovimiento}`;
        const importe = Math.abs(Number(ord.MovImporte || 0));
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-4 bg-amber-50 border-b border-amber-100">
                <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle size={20} className="text-amber-600" />
                </div>
                <div>
                  <p className="font-bold text-amber-800 text-sm">Cancelar orden</p>
                  <p className="text-[11px] text-amber-600">Esta acción no se puede deshacer</p>
                </div>
              </div>
              <div className="px-5 py-4 space-y-3">
                <div className="bg-slate-50 rounded-xl p-3 border border-slate-100">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Orden</p>
                  <p className="text-sm font-bold text-slate-800">{codigo}</p>
                  {ord.OrdNombreTrabajo && <p className="text-xs text-slate-500 mt-0.5">{ord.OrdNombreTrabajo}</p>}
                </div>
                {importe > 0 && (
                  <div className="bg-amber-50 rounded-xl p-3 border border-amber-100 flex items-center gap-3">
                    <div className="text-center flex-1">
                      <p className="text-[10px] text-amber-500 font-semibold uppercase">Importe a revertir</p>
                      <p className="text-lg font-black text-amber-700">{cuentaActiva?.MonSimbolo || '$'} {new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2 }).format(importe)}</p>
                    </div>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 text-center">El saldo se revertirá y la orden no podrá facturarse.</p>
              </div>
              <div className="px-5 pb-5 flex gap-2">
                <button
                  onClick={() => setModalCancelarOrden(null)}
                  disabled={cancelWorking}
                  className="flex-1 px-4 py-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors disabled:opacity-50"
                >Volver</button>
                <button
                  disabled={cancelWorking}
                  onClick={async () => {
                    setCancelWorking(true);
                    try {
                      const res = await api.post(`/contabilidad/movimientos/${ord.MovIdMovimiento}/anular-orden`);
                      toast.success(res.data?.message || 'Orden cancelada correctamente');
                      setModalCancelarOrden(null);
                      recargarCuentas();
                    } catch (err) {
                      toast.error(err.response?.data?.error || err.message || 'Error al cancelar');
                    } finally {
                      setCancelWorking(false);
                    }
                  }}
                  className="flex-1 px-4 py-2 text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-xl transition-colors disabled:opacity-50"
                >
                  {cancelWorking
                    ? <span className="flex items-center justify-center gap-1"><RefreshCw size={11} className="animate-spin" /> Cancelando...</span>
                    : 'Sí, cancelar orden'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
