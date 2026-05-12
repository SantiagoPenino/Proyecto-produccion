import React, { useState } from 'react';
import { stockService } from '../../services/api';

const StockModal = ({ isOpen, onClose, areaName, areaCode }) => {
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    item: '',
    cantidad: '',
    unidad: 'Unidades',
    prioridad: 'Normal'
  });

  if (!isOpen) return null;

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    if (!formData.item || !formData.cantidad) {
      alert("Por favor complete el ítem y la cantidad.");
      return;
    }

    try {
      setLoading(true);
      const payload = {
        areaId: areaCode,
        ...formData
      };

      await stockService.create(payload);
      alert("✅ Solicitud enviada a Logística correctamente.");
      setFormData({ item: '', cantidad: '', unidad: 'Unidades', prioridad: 'Normal' });
      onClose();
    } catch (error) {
      console.error("❌ ERROR EN FRONTEND:", error);
      alert("❌ Error al enviar: " + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-zinc-900/60 backdrop-blur-sm z-[1300] flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-300"
        onClick={e => e.stopPropagation()}
      >
        {/* Header - Amber Theme */}
        <div className="px-6 py-4 border-b border-amber-100 flex justify-between items-center bg-amber-50">
          <h3 className="text-lg font-black text-amber-800 flex items-center gap-2">
            <i className="fa-solid fa-boxes-stacked text-amber-600 bg-amber-100 p-1.5 rounded-lg"></i>
            Solicitud Insumos <span className="text-amber-600/60 text-sm font-bold ml-1">{areaName}</span>
          </h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-amber-500 hover:bg-amber-100/50 hover:text-amber-700 transition-colors"
          >
            <i className="fa-solid fa-xmark text-lg"></i>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 flex flex-col gap-5">

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-amber-700 uppercase tracking-wider">Insumo / Material</label>
            <input
              name="item"
              type="text"
              placeholder="Ej: Tinta Magenta, Papel..."
              className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all placeholder:text-zinc-400"
              value={formData.item}
              onChange={handleChange}
              autoFocus
            />
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs font-bold text-amber-700 uppercase tracking-wider">Cantidad</label>
              <input
                name="cantidad"
                type="number"
                placeholder="0"
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all placeholder:text-zinc-400"
                value={formData.cantidad}
                onChange={handleChange}
              />
            </div>
            <div className="flex flex-col gap-1.5 flex-1">
              <label className="text-xs font-bold text-amber-700 uppercase tracking-wider">Unidad</label>
              <select
                name="unidad"
                className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all appearance-none cursor-pointer"
                value={formData.unidad}
                onChange={handleChange}
              >
                <option>Unidades</option>
                <option>Litros</option>
                <option>Metros</option>
                <option>Rollos</option>
                <option>Cajas</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-amber-700 uppercase tracking-wider">Prioridad</label>
            <select
              name="prioridad"
              className="w-full px-4 py-2 bg-zinc-50 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 transition-all cursor-pointer"
              value={formData.prioridad}
              onChange={handleChange}
            >
              <option value="Normal">Normal (Reposición)</option>
              <option value="Alta">Alta (Stock Crítico)</option>
              <option value="Urgente">Urgente (Parada de Máquina)</option>
            </select>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-zinc-50 border-t border-zinc-100 flex justify-end gap-3 text-sm font-bold">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white border border-zinc-200 text-zinc-600 rounded-lg hover:bg-zinc-100 transition-colors"
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg shadow-md shadow-amber-200 hover:bg-amber-600 hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={loading}
          >
            {loading ? <span className="flex items-center gap-2"><i className="fa-solid fa-spinner fa-spin"></i> Enviando...</span> : 'Enviar Solicitud'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default StockModal;
