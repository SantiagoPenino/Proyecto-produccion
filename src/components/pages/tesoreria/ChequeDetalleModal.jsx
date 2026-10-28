import React, { useState, useEffect } from 'react';
import { X, Landmark, Calendar, User, Hash, DollarSign, Building2, PenTool, Save, Lock, Loader2 } from 'lucide-react';
import api from '../../../services/apiClient';
import { toast } from 'sonner';
import { fmtFecha, toInputDate } from '../../../utils/fechas';
import Selector from '../../ui/Selector';
import SelectorFecha from '../../ui/SelectorFecha';

// Estética nueva (27/10/2026): ventana clara por encima de la barra de arriba (antes z-50, el encabezado quedaba
// tapado), banco y cliente con el Selector propio, fechas con SelectorFecha y «Guardar cambios» en brand-cyan.
const ETIQUETA = 'flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';

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

  // En la moneda del cheque (1 = $, 2 = US$), no siempre en pesos.
  const fmtMonto = (n) => new Intl.NumberFormat('es-UY', {
    style: 'currency', currency: Number(cheque.IdMoneda) === 2 ? 'USD' : 'UYU'
  }).format(Number(n) || 0);
  const inputCls = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 disabled:bg-zinc-50 disabled:text-zinc-400';

  return (
    <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <Landmark size={24} className="text-brand-cyan shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h2 className="text-lg font-black text-zinc-900 tracking-tight">Cheque N° <span className="font-mono">{cheque.NumeroCheque}</span></h2>
              <p className="text-sm text-zinc-500">
                {editable ? 'Detalle del cheque — podés completar o corregir los datos' : 'Detalle del cheque (solo lectura)'}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar"
            className="shrink-0 text-zinc-400 hover:text-brand-magenta w-9 h-9 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 flex flex-col gap-5 overflow-y-auto">

          {/* Importe + estado: SOLO LECTURA */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="col-span-2 sm:col-span-1 bg-zinc-50 border border-zinc-100 rounded-xl p-3">
              <div className="flex items-center gap-1.5 text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                <DollarSign size={12} /> Importe <Lock size={10} />
              </div>
              <div className="text-lg font-black text-zinc-900 mt-1 tabular-nums">{fmtMonto(cheque.Monto)}</div>
            </div>
            <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-3">
              <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Estado</div>
              <div className="text-sm font-black text-zinc-700 mt-1.5">{(cheque.Estado || '').replace('_', ' ')}</div>
            </div>
            <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-3">
              <div className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Tipo</div>
              <div className="text-sm font-black text-zinc-700 mt-1.5">{cheque.Tipo}</div>
            </div>
          </div>
          {editable && (
            <p className="-mt-2 text-[11px] text-zinc-400 flex items-start gap-1.5">
              <Lock size={11} className="shrink-0 mt-0.5" /> El importe no se edita: define el asiento contable. Si está mal, es otro cheque — anulalo y cargá el correcto.
            </p>
          )}

          {/* Nº + Banco + Agencia */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-3">
              <label className={ETIQUETA}><Hash size={12} /> Cheque Nº *</label>
              <input type="text" value={form.NumeroCheque} disabled={!editable} onChange={e => set('NumeroCheque', e.target.value)} className={`${inputCls} font-mono`} aria-label="Número de cheque" />
            </div>
            <div className="sm:col-span-5">
              <label className={ETIQUETA}><Landmark size={12} /> Banco *</label>
              <Selector className="w-full" value={String(form.IdBanco)} disabled={!editable} onChange={e => set('IdBanco', e.target.value)} aria-label="Banco" anchoLista={240}>
                <option value="">Seleccione…</option>
                {bancos.map(b => <option key={b.IdBanco} value={String(b.IdBanco)}>{b.NombreBanco}</option>)}
              </Selector>
            </div>
            <div className="sm:col-span-4">
              <label className={ETIQUETA}><Building2 size={12} /> Agencia</label>
              <input type="text" value={form.Agencia} disabled={!editable} onChange={e => set('Agencia', e.target.value)} className={inputCls} aria-label="Agencia" />
            </div>
          </div>

          {/* Cliente que lo depositó — el dato clave que suele faltar */}
          <div className="bg-brand-cyan/5 border border-brand-cyan/15 rounded-xl p-4">
            <label className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-brand-cyan mb-1.5">
              <User size={12} /> Cliente que lo depositó
            </label>
            <Selector className="w-full" value={String(form.IdClienteOrigen)} disabled={!editable} onChange={e => set('IdClienteOrigen', e.target.value)} aria-label="Cliente que lo depositó" anchoLista={320}>
              <option value="">Sin asignar…</option>
              {/* /clients devuelve CliIdCliente / Nombre / NombreFantasia. Con los nombres
                  viejos (IdCliente / RazonSocial) todas las opciones salían vacías. */}
              {clientes.map(c => (
                <option key={c.CliIdCliente} value={String(c.CliIdCliente)}>
                  {(c.Nombre || '').trim()}{c.NombreFantasia && c.NombreFantasia.trim() !== (c.Nombre || '').trim() ? ` — ${c.NombreFantasia.trim()}` : ''}
                </option>
              ))}
            </Selector>
            <p className="text-[11px] text-zinc-500 mt-2">
              Quién te entregó el cheque. Es distinto del librador (quién lo firmó).
            </p>
          </div>

          {/* Librador / Endoso */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={ETIQUETA}><PenTool size={12} /> Emitido por (librador)</label>
              <input type="text" value={form.EmitidoPor} disabled={!editable} onChange={e => set('EmitidoPor', e.target.value)} placeholder="Titular de la cuenta" className={inputCls} aria-label="Emitido por" />
            </div>
            <div>
              <label className={ETIQUETA}><PenTool size={12} /> Endosado por</label>
              <input type="text" value={form.EndosadoPor} disabled={!editable} onChange={e => set('EndosadoPor', e.target.value)} placeholder="Si aplica" className={inputCls} aria-label="Endosado por" />
            </div>
          </div>

          {/* Fechas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={ETIQUETA}><Calendar size={12} /> Emisión</label>
              <SelectorFecha className="w-full" value={form.FechaEmision} disabled={!editable} onChange={e => set('FechaEmision', e.target.value)} aria-label="Fecha de emisión" />
              {!editable && <p className="text-[11px] text-zinc-400 mt-1">{fmtFecha(cheque.FechaEmision)}</p>}
            </div>
            <div>
              <label className={ETIQUETA}><Calendar size={12} className="text-brand-cyan" /> Vencimiento</label>
              <SelectorFecha className="w-full" value={form.FechaVencimiento} disabled={!editable} onChange={e => set('FechaVencimiento', e.target.value)} aria-label="Fecha de vencimiento" />
              {!editable && <p className="text-[11px] text-zinc-400 mt-1">{fmtFecha(cheque.FechaVencimiento)}</p>}
            </div>
          </div>

          {/* Notas */}
          <div>
            <label className={ETIQUETA}>Notas</label>
            <textarea value={form.Notas} disabled={!editable} onChange={e => set('Notas', e.target.value)} rows={2}
              className={`${inputCls} resize-none`} placeholder="Observaciones del cheque…" aria-label="Notas" />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-100 bg-white flex justify-end gap-2 shrink-0">
          <button type="button" onClick={onClose}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors">
            {editable ? 'Cancelar' : 'Cerrar'}
          </button>
          {editable && (
            <button onClick={guardar} disabled={procesando}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {procesando ? <><Loader2 size={15} className="animate-spin" /> Guardando…</> : <><Save size={15} /> Guardar cambios</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
