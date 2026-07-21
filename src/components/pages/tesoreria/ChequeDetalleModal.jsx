import React, { useState, useEffect } from 'react';
import { X, Landmark, Calendar, User, Hash, DollarSign, Building2, PenTool, Save, Lock, CheckCircle } from 'lucide-react';
import api from '../../../services/apiClient';
import { toast } from 'sonner';
import { fmtFecha, toInputDate } from '../../../utils/fechas';

/**
 * Ver / editar el detalle de un cheque que está en cartera (o emitido).
 * Pensado sobre todo para completar datos que quedaron sin cargar — el cliente que lo
 * depositó, el librador — sin tener que anular y recargar.
 *
 * El IMPORTE y el ESTADO se muestran pero NO se editan: el importe define el asiento
 * contable ya generado (si está mal, es otro cheque → anular y recargar) y el estado se
 * maneja con los botones de acción.
 */
export default function ChequeDetalleModal({ cheque, onClose, onSaved }) {
  const [bancos, setBancos] = useState([]);
  const [clientes, setClientes] = useState([]);
  const [procesando, setProcesando] = useState(false);

  // Editable solo mientras el cheque sigue vivo.
  const editable = cheque.Estado === 'EN_CARTERA' || cheque.Estado === 'EMITIDO';

  const [form, setForm] = useState({
    NumeroCheque:     cheque.NumeroCheque || '',
    IdBanco:          cheque.IdBanco || '',
    FechaEmision:     toInputDate(cheque.FechaEmision),
    FechaVencimiento: toInputDate(cheque.FechaVencimiento),
    IdClienteOrigen:  cheque.IdClienteOrigen || '',
    EmitidoPor:       cheque.EmitidoPor || '',
    EndosadoPor:      cheque.EndosadoPor || '',
    Agencia:          cheque.Agencia || '',
    ClasificacionPlazo: cheque.ClasificacionPlazo || 'Común',
    Notas:            cheque.Notas || '',
  });

  useEffect(() => {
    api.get('/tesoreria/bancos').then(r => setBancos(r.data.data || [])).catch(() => {});
    api.get('/clients').then(r => setClientes(r.data || [])).catch(() => {});
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const guardar = async () => {
    if (!form.NumeroCheque || !form.IdBanco) {
      return toast.error('El número de cheque y el banco son obligatorios.');
    }
    setProcesando(true);
    try {
      await api.put(`/tesoreria/cheques/${cheque.IdCheque}`, {
        ...form,
        IdBanco: parseInt(form.IdBanco, 10),
        IdClienteOrigen: form.IdClienteOrigen ? parseInt(form.IdClienteOrigen, 10) : null,
      });
      toast.success('Cheque actualizado');
      onSaved?.();
    } catch (error) {
      toast.error(error.response?.data?.error || 'No se pudo guardar el cheque');
    } finally {
      setProcesando(false);
    }
  };

  const fmtMonto = (n) => new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU' }).format(Number(n) || 0);
  const inputCls = 'w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-white disabled:bg-slate-50 disabled:text-slate-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-100 p-2.5 rounded-xl text-indigo-600">
              <Landmark size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight">Cheque N° {cheque.NumeroCheque}</h2>
              <p className="text-sm font-medium text-slate-500">
                {editable ? 'Detalle del cheque — podés completar o corregir los datos' : 'Detalle del cheque (solo lectura)'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-6 overflow-y-auto max-h-[75vh]">

          {/* Importe + estado: SOLO LECTURA */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <DollarSign size={12} /> Importe <Lock size={10} />
              </div>
              <div className="text-lg font-black text-slate-800 mt-1">{fmtMonto(cheque.Monto)}</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Estado</div>
              <div className="text-sm font-black text-slate-700 mt-1.5">{(cheque.Estado || '').replace('_', ' ')}</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tipo</div>
              <div className="text-sm font-black text-slate-700 mt-1.5">{cheque.Tipo}</div>
            </div>
          </div>
          {editable && (
            <p className="-mt-3 text-[11px] text-slate-400 font-medium flex items-center gap-1.5">
              <Lock size={11} /> El importe no se edita: define el asiento contable. Si está mal, es otro cheque — anulalo y cargá el correcto.
            </p>
          )}

          {/* Nº + Banco + Agencia */}
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-3">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2"><Hash size={16} className="text-slate-400" /> Cheque Nº *</label>
              <input type="text" value={form.NumeroCheque} disabled={!editable} onChange={e => set('NumeroCheque', e.target.value)} className={inputCls} />
            </div>
            <div className="col-span-5">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2"><Landmark size={16} className="text-slate-400" /> Banco *</label>
              <select value={form.IdBanco} disabled={!editable} onChange={e => set('IdBanco', e.target.value)} className={inputCls}>
                <option value="">Seleccione…</option>
                {bancos.map(b => <option key={b.IdBanco} value={b.IdBanco}>{b.NombreBanco}</option>)}
              </select>
            </div>
            <div className="col-span-4">
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2"><Building2 size={16} className="text-slate-400" /> Agencia</label>
              <input type="text" value={form.Agencia} disabled={!editable} onChange={e => set('Agencia', e.target.value)} className={inputCls} />
            </div>
          </div>

          {/* Cliente que lo depositó — el dato clave que suele faltar */}
          <div className="bg-indigo-50/50 border border-indigo-100 rounded-xl p-4">
            <label className="flex items-center gap-2 text-sm font-black text-indigo-700 mb-2">
              <User size={16} /> Cliente que lo depositó
            </label>
            <select value={form.IdClienteOrigen} disabled={!editable} onChange={e => set('IdClienteOrigen', e.target.value)}
              className="w-full border border-indigo-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 bg-white disabled:bg-slate-50">
              <option value="">Sin asignar…</option>
              {clientes.map(c => <option key={c.IdCliente} value={c.IdCliente}>{c.RazonSocial || c.NombreFidelidad}</option>)}
            </select>
            <p className="text-[11px] text-indigo-500/80 font-medium mt-2">
              Quién te entregó el cheque. Es distinto del librador (quién lo firmó).
            </p>
          </div>

          {/* Librador / Endoso */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2"><PenTool size={16} className="text-slate-400" /> Emitido por (librador)</label>
              <input type="text" value={form.EmitidoPor} disabled={!editable} onChange={e => set('EmitidoPor', e.target.value)} placeholder="Titular de la cuenta" className={inputCls} />
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2"><PenTool size={16} className="text-slate-400" /> Endosado por</label>
              <input type="text" value={form.EndosadoPor} disabled={!editable} onChange={e => set('EndosadoPor', e.target.value)} placeholder="Si aplica" className={inputCls} />
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-100">
            <div>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2"><Calendar size={16} className="text-slate-400" /> Emisión</label>
              <input type="date" value={form.FechaEmision} disabled={!editable} onChange={e => set('FechaEmision', e.target.value)} className={inputCls} />
              {!editable && <p className="text-[11px] text-slate-400 mt-1">{fmtFecha(cheque.FechaEmision)}</p>}
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2"><Calendar size={16} className="text-indigo-400" /> Vencimiento</label>
              <input type="date" value={form.FechaVencimiento} disabled={!editable} onChange={e => set('FechaVencimiento', e.target.value)} className={inputCls} />
              {!editable && <p className="text-[11px] text-slate-400 mt-1">{fmtFecha(cheque.FechaVencimiento)}</p>}
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className="text-sm font-bold text-slate-700 mb-2 block">Notas</label>
            <textarea value={form.Notas} disabled={!editable} onChange={e => set('Notas', e.target.value)} rows={2}
              className={inputCls} placeholder="Observaciones del cheque…" />
          </div>
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-100 bg-white flex justify-end gap-3 shrink-0">
          <button type="button" onClick={onClose} className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-200 transition-colors">
            {editable ? 'Cancelar' : 'Cerrar'}
          </button>
          {editable && (
            <button onClick={guardar} disabled={procesando}
              className="px-6 py-2.5 rounded-xl font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors flex items-center gap-2 shadow-lg shadow-indigo-600/20 disabled:opacity-50 disabled:cursor-not-allowed">
              {procesando ? 'Guardando…' : <><Save size={18} /> Guardar cambios</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
