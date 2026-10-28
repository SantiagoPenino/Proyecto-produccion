import React, { useState, useEffect } from 'react';
import { X, CheckCircle, Landmark, Calendar, Building2, Hash, DollarSign, Loader2 } from 'lucide-react';
import api from '../../../services/apiClient';
import { toast } from 'sonner';
import Selector from '../../ui/Selector';
import SelectorFecha from '../../ui/SelectorFecha';

// Estética nueva (27/10/2026): ventana clara por encima de la barra de arriba (antes z-50), banco con el Selector
// propio, fechas con SelectorFecha y «Emitir cheque» en brand-cyan (antes ámbar). La lógica no cambió.
const ETIQUETA = 'flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
const CAMPO = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';

export default function ChequeEmitirModal({ onClose, onSuccess }) {
  const [bancos, setBancos] = useState([]);
  const [loadingBancos, setLoadingBancos] = useState(true);
  const [procesando, setProcesando] = useState(false);

  const [formData, setFormData] = useState({
    NumeroCheque: '',
    IdBanco: '',
    Monto: '',
    FechaEmision: new Date().toISOString().split('T')[0],
    FechaVencimiento: new Date().toISOString().split('T')[0],
    IdProveedorDestino: ''
  });

  useEffect(() => {
    fetchBancos();
  }, []);

  const fetchBancos = async () => {
    try {
      const res = await api.get('/tesoreria/bancos');
      setBancos(res.data.data || []);
    } catch (e) {
      toast.error('Error cargando bancos');
    } finally {
      setLoadingBancos(false);
    }
  };

  const handleChange = (e) => setFormData({ ...formData, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.NumeroCheque || !formData.IdBanco || !formData.Monto) {
      return toast.error('Completar campos obligatorios');
    }
    setProcesando(true);
    try {
      const res = await api.post('/tesoreria/cheques/emitir', {
        ...formData,
        Monto: parseFloat(formData.Monto),
        IdProveedorDestino: formData.IdProveedorDestino ? parseInt(formData.IdProveedorDestino) : null
      });
      toast.success(res.data.message || 'Cheque emitido correctamente');
      onSuccess(res.data.data.IdCheque);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Error al emitir el cheque');
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[6000] flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[92vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-100 flex items-start justify-between gap-3 shrink-0">
          <div className="flex items-start gap-3">
            <Building2 size={24} className="text-brand-cyan shrink-0 mt-0.5" />
            <div>
              <h2 className="text-lg font-black text-zinc-900 tracking-tight">Emitir cheque propio</h2>
              <p className="text-sm text-zinc-500">Pago diferido a proveedores</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar"
            className="shrink-0 text-zinc-400 hover:text-brand-magenta w-9 h-9 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-4 overflow-y-auto">
          {/* Fila 1 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="emitir-numero" className={ETIQUETA}>
                <Hash size={12} /> N° de cheque *
              </label>
              <input
                id="emitir-numero"
                type="text"
                name="NumeroCheque"
                value={formData.NumeroCheque}
                onChange={handleChange}
                required
                placeholder="Ej. 99887766"
                className={`${CAMPO} font-mono`}
              />
            </div>
            <div>
              <label htmlFor="emitir-monto" className={ETIQUETA}>
                <DollarSign size={12} /> Importe *
              </label>
              <input
                id="emitir-monto"
                type="number"
                step="0.01"
                name="Monto"
                value={formData.Monto}
                onChange={handleChange}
                required
                placeholder="0.00"
                className={`${CAMPO} font-black tabular-nums`}
              />
            </div>
          </div>

          {/* Fila 2 */}
          <div>
            <span className={ETIQUETA}>
              <Landmark size={12} /> Mi banco (chequera) *
            </span>
            <Selector name="IdBanco" className="w-full" value={String(formData.IdBanco)} onChange={handleChange} aria-label="Mi banco" anchoLista={260}>
              <option value="">{loadingBancos ? 'Cargando bancos…' : 'Seleccione mi banco...'}</option>
              {bancos.map(b => (
                <option key={b.IdBanco} value={String(b.IdBanco)}>{b.NombreBanco}</option>
              ))}
            </Selector>
          </div>

          {/* Fila 3 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <span className={ETIQUETA}>
                <Calendar size={12} /> Fecha emisión *
              </span>
              <SelectorFecha name="FechaEmision" className="w-full" value={formData.FechaEmision} onChange={handleChange} aria-label="Fecha de emisión" />
            </div>
            <div>
              <span className={ETIQUETA}>
                <Calendar size={12} className="text-brand-cyan" /> Fecha vencimiento *
              </span>
              <SelectorFecha name="FechaVencimiento" className="w-full" value={formData.FechaVencimiento} onChange={handleChange} aria-label="Fecha de vencimiento" />
            </div>
          </div>

          {/* Fila 4 */}
          <div>
            <label htmlFor="emitir-proveedor" className={ETIQUETA}>
              <Building2 size={12} /> ID proveedor destino
            </label>
            <input
              id="emitir-proveedor"
              type="number"
              name="IdProveedorDestino"
              value={formData.IdProveedorDestino}
              onChange={handleChange}
              placeholder="ID del proveedor en el sistema (opcional)"
              className={CAMPO}
            />
          </div>
        </form>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-100 flex justify-end gap-2 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={procesando}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {procesando ? <><Loader2 size={15} className="animate-spin" /> Procesando...</> : <><CheckCircle size={15} /> Emitir cheque</>}
          </button>
        </div>
      </div>
    </div>
  );
}
