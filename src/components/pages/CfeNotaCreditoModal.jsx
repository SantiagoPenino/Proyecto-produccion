import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, Trash2, Lock, FileText, AlertTriangle, Loader2 } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function CfeNotaCreditoModal({ doc, lineas, onClose, onSuccess, mode = 'NC' }) {
  const [loading, setLoading] = useState(false);
  const [motivo, setMotivo] = useState('');
  const isND = mode === 'ND';
  
  // Mapear líneas originales para edición
  const [formData, setFormData] = useState(() => {
    const formattedLineas = (lineas || []).map((l, idx) => {
      const qty = parseFloat(l.DcdCantidad) || 1;
      const sub = parseFloat(l.DcdSubtotal) || 0;
      const imp = parseFloat(l.DcdImpuestos) || 0;
      const total = parseFloat(l.DcdTotal) || (sub + imp);
      const unitPrice = qty > 0 ? (total / qty) : (parseFloat(l.DcdPrecioUnitario) || 0);
      
      let ivaRate = 22;
      if (sub > 0) {
        const ratio = (imp / sub) * 100;
        if (ratio < 2) ivaRate = 0;
        else if (ratio < 15) ivaRate = 10;
        else ivaRate = 22;
      }

      return {
        id: Date.now() + idx,
        concepto: (l.DcdNomItem || '').trim(),
        DcdDscItem: (l.DcdDscItem || '').trim(),
        cantidad: qty,
        precioUnitario: parseFloat(unitPrice.toFixed(4)),
        iva: ivaRate,
        originalQty: qty,
        originalPrice: parseFloat(unitPrice.toFixed(4))
      };
    });

    return {
      Lineas: formattedLineas
    };
  });

  // Calcular totales de forma dinámica
  const totales = useMemo(() => {
    let subtotal = 0;
    let total = 0;
    formData.Lineas.forEach(l => {
      const qty = parseFloat(l.cantidad) || 0;
      const price = parseFloat(l.precioUnitario) || 0;
      const ivaRate = parseFloat(l.iva) || 0;
      const lineTotal = qty * price;
      const lineNeto = lineTotal / (1 + ivaRate / 100);
      
      total += lineTotal;
      subtotal += lineNeto;
    });
    return {
      subtotal: parseFloat(subtotal.toFixed(2)),
      iva: parseFloat((total - subtotal).toFixed(2)),
      total: parseFloat(total.toFixed(2))
    };
  }, [formData.Lineas]);

  // Manejar edición de línea
  const handleLineChange = (index, field, val) => {
    setFormData(prev => {
      const updatedLines = [...prev.Lineas];
      const line = { ...updatedLines[index] };

      if (field === 'cantidad') {
        let numVal = parseFloat(val);
        if (isNaN(numVal) || numVal < 0) numVal = 0;
        if (numVal > line.originalQty) {
          toast.warning(`La cantidad no puede superar el valor original de ${line.originalQty}`);
          numVal = line.originalQty;
        }
        line.cantidad = numVal;
      } else if (field === 'precioUnitario') {
        let numVal = parseFloat(val);
        if (isNaN(numVal) || numVal < 0) numVal = 0;
        if (numVal > line.originalPrice) {
          toast.warning(`El precio unitario no puede superar el valor original de ${line.originalPrice}`);
          numVal = line.originalPrice;
        }
        line.precioUnitario = numVal;
      }

      updatedLines[index] = line;
      return { ...prev, Lineas: updatedLines };
    });
  };

  // Eliminar una línea
  const handleDeleteLine = (index) => {
    setFormData(prev => {
      const updatedLines = prev.Lineas.filter((_, idx) => idx !== index);
      return { ...prev, Lineas: updatedLines };
    });
  };

  // Restaurar líneas originales
  const handleRestoreOriginals = () => {
    const formattedLineas = (lineas || []).map((l, idx) => {
      const qty = parseFloat(l.DcdCantidad) || 1;
      const sub = parseFloat(l.DcdSubtotal) || 0;
      const imp = parseFloat(l.DcdImpuestos) || 0;
      const total = parseFloat(l.DcdTotal) || (sub + imp);
      const unitPrice = qty > 0 ? (total / qty) : (parseFloat(l.DcdPrecioUnitario) || 0);
      
      let ivaRate = 22;
      if (sub > 0) {
        const ratio = (imp / sub) * 100;
        if (ratio < 2) ivaRate = 0;
        else if (ratio < 15) ivaRate = 10;
        else ivaRate = 22;
      }

      return {
        id: Date.now() + idx,
        concepto: (l.DcdNomItem || '').trim(),
        DcdDscItem: (l.DcdDscItem || '').trim(),
        cantidad: qty,
        precioUnitario: parseFloat(unitPrice.toFixed(4)),
        iva: ivaRate,
        originalQty: qty,
        originalPrice: parseFloat(unitPrice.toFixed(4))
      };
    });

    setFormData({ Lineas: formattedLineas });
    toast.info('Líneas originales restauradas');
  };

  // Enviar formulario
  const handleSubmit = async (e) => {
    e.preventDefault();
    const docName = isND ? 'Nota de Débito' : 'Nota de Crédito';
    if (!motivo.trim()) {
      return toast.error(`Debe ingresar un motivo o explicación para la ${docName}`);
    }
    if (formData.Lineas.length === 0) {
      return toast.error(`Debe ${isND ? 'debitar' : 'acreditar'} al menos una línea`);
    }

    const originalTotal = Number(doc.DocTotal) || 0;
    const isPartial = totales.total < originalTotal - 0.01;

    if (isPartial) {
      const confirm = window.confirm(
        `${docName} PARCIAL\n\nEl total a ${isND ? 'debitar' : 'acreditar'} (${fmt(totales.total)}) es menor al total del documento original (${fmt(originalTotal)}).\n\n¿Desea guardar esta ${docName} Parcial?`
      );
      if (!confirm) return;
    } else {
      const confirm = window.confirm(
        `${docName} Total\n\nSe emitirá una ${docName} por el 100% del total (${fmt(totales.total)}).\n\n¿Desea continuar?`
      );
      if (!confirm) return;
    }

    setLoading(true);
    try {
      const payload = {
        docIdOrigen: doc.DocIdDocumento,
        monto: totales.total,
        motivo: motivo,
        clienteId: doc.CliIdCliente || 1,
        cuentaId: doc.CueIdCuenta || (doc.MonIdMoneda === 2 ? 119 : 118),
        monedaId: doc.MonIdMoneda || 1,
        Lineas: formData.Lineas.map(l => ({
          concepto: l.concepto,
          DcdDscItem: l.DcdDscItem,
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          iva: l.iva
        })),
        Totales: totales
      };

      const endpoint = isND ? '/contabilidad/caja/nota-debito' : '/contabilidad/caja/nota-credito';
      await api.post(endpoint, payload);
      toast.success(`${docName} generada correctamente`);
      onSuccess();
    } catch (error) {
      toast.error(`Error al generar la ${docName}: ` + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const isUsd = doc.MonIdMoneda === 2;
  const currencySymbol = isUsd ? 'U$S' : '$';

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/50 flex flex-col w-screen h-screen overflow-hidden animate-in fade-in select-none">
      {/* HEADER */}
      <div className="bg-white border-b border-zinc-200 px-6 py-3.5 flex items-center justify-between shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className={`${isND ? 'bg-blue-600 shadow-blue-600/10' : 'bg-red-600 shadow-red-600/10'} p-2 rounded-xl text-white shadow-md animate-pulse`}>
            <FileText size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-zinc-800 tracking-tight leading-none">
              Generar {isND ? 'Nota de Débito' : 'Nota de Crédito'}
            </h2>
            <p className="text-xs font-semibold text-zinc-400 mt-1">
              Comprobante de referencia: <span className="font-bold text-zinc-600">{doc.DocSerie}-{doc.DocNumero}</span>
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-xl transition-all">
          <X size={20} />
        </button>
      </div>

      {/* CONTENIDO PRINCIPAL */}
      <div className="flex-1 flex flex-col p-4 gap-4 min-h-0 overflow-y-auto bg-zinc-50">
        
        {/* PANEL SUPERIOR: CLIENTE (LOCKED) Y MOTIVO */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 shrink-0">
          
          {/* Panel Cliente Bloqueado */}
          <div className="bg-zinc-100 border border-zinc-200 rounded-2xl p-4 md:col-span-2 flex flex-col gap-3 relative shadow-inner">
            <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-zinc-200 border border-zinc-300 text-[10px] font-black text-zinc-500 uppercase tracking-widest">
              <Lock size={10} />
              <span>Cliente Bloqueado</span>
            </div>
            
            <h3 className="text-xs font-bold uppercase text-zinc-400 tracking-wider">Información del Cliente Receptor</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-zinc-400 uppercase">Nombre / Razón Social</span>
                <input 
                  type="text" 
                  value={doc.DocCliNombre || 'Consumidor Final'} 
                  readOnly 
                  className="bg-zinc-200/50 border border-zinc-300 text-zinc-500 font-semibold rounded-xl px-3 py-1.5 mt-1 outline-none text-xs" 
                />
              </div>
              <div className="flex flex-col">
                <span className="text-[10px] font-bold text-zinc-400 uppercase">Documento / RUT</span>
                <input 
                  type="text" 
                  value={doc.DocCliDocumento || '—'} 
                  readOnly 
                  className="bg-zinc-200/50 border border-zinc-300 text-zinc-500 font-semibold rounded-xl px-3 py-1.5 mt-1 outline-none text-xs" 
                />
              </div>
              <div className="flex flex-col sm:col-span-2">
                <span className="text-[10px] font-bold text-zinc-400 uppercase">Dirección y Ciudad</span>
                <input 
                  type="text" 
                  value={`${doc.DocCliDireccion || ''} ${doc.DocCliCiudad || ''}`.trim() || '—'} 
                  readOnly 
                  className="bg-zinc-200/50 border border-zinc-300 text-zinc-500 font-semibold rounded-xl px-3 py-1.5 mt-1 outline-none text-xs" 
                />
              </div>
            </div>
          </div>

          {/* Panel Motivo */}
          <div className={`bg-white border rounded-2xl p-4 flex flex-col gap-3 shadow-sm transition-all duration-200 ${!motivo.trim() ? (isND ? 'border-blue-200 bg-blue-50/5' : 'border-red-200 bg-red-50/5') : 'border-zinc-200'}`}>
            <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider flex items-center justify-between">
              <span>Motivo de Emisión</span>
              <span className={`text-[9px] ${isND ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'} px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider`}>Requerido</span>
            </h3>
            <div className="flex flex-col flex-1">
              <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Descripción / Observación <span className="text-red-500 font-bold">*</span></label>
              <textarea
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                placeholder={isND ? "Indique el motivo de la Nota de Débito (ej. Reverso de Nota de Crédito emitida por error)" : "Indique el motivo de la Nota de Crédito (ej. Devolución de mercadería, ajuste de precio)"}
                className={`w-full flex-1 border rounded-xl px-3 py-2 text-xs font-semibold text-zinc-700 outline-none resize-none min-h-[70px] transition-all
                  ${!motivo.trim() 
                    ? (isND 
                      ? 'border-blue-300 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 placeholder-blue-300/60 font-semibold' 
                      : 'border-red-300 focus:border-red-500 focus:ring-1 focus:ring-red-500 placeholder-red-300/60 font-semibold')
                    : 'border-zinc-200 focus:border-zinc-400 font-semibold'
                  }`}
                required
              />
            </div>
          </div>

        </div>

        {/* TABLA DE LINEAS (NO ADICION - SOLO EDITAR Y ELIMINAR) */}
        <div className="flex-1 bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-0">
          <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-2.5 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-zinc-600 uppercase tracking-widest">Detalle del Comprobante</span>
              <span className={`text-[10px] ${isND ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-red-50 text-red-700 border-red-200'} border rounded-full px-2.5 py-0.5 font-bold uppercase`}>
                Solo editar o eliminar
              </span>
            </div>
            <div className="flex items-center gap-4">
              {formData.Lineas.length < (lineas || []).length && (
                <button
                  type="button"
                  onClick={handleRestoreOriginals}
                  className="text-[10px] font-black text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-lg px-2.5 py-1 transition-all uppercase tracking-wider"
                >
                  Restaurar Líneas Originales
                </button>
              )}
              <div className="text-xs font-bold text-zinc-400">
                Moneda: <span className="font-black text-zinc-700">{isUsd ? 'Dólares (USD)' : 'Pesos (UYU)'}</span>
              </div>
            </div>
          </div>

          {/* Tabla scrollable */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-black text-zinc-400 uppercase tracking-wider shrink-0 select-none">
                  <th className="py-2.5 px-4 w-12 text-center">#</th>
                  <th className="py-2.5 px-2">Concepto</th>
                  <th className="py-2.5 px-2 w-28 text-center">Cant. Original</th>
                  <th className="py-2.5 px-2 w-28 text-center">Cant. a {isND ? 'Debitar' : 'Acreditar'}</th>
                  <th className="py-2.5 px-2 w-32 text-right">Precio Original</th>
                  <th className="py-2.5 px-2 w-32 text-right">Precio a {isND ? 'Debitar' : 'Acreditar'}</th>
                  <th className="py-2.5 px-2 w-20 text-center">IVA</th>
                  <th className="py-2.5 px-4 w-36 text-right">Subtotal</th>
                  <th className="py-2.5 px-4 w-36 text-right">Total</th>
                  <th className="py-2.5 px-4 w-12 text-center"></th>
                </tr>
              </thead>
              <tbody>
                {formData.Lineas.map((line, idx) => {
                  const subtotal = (line.cantidad * line.precioUnitario) / (1 + line.iva / 100);
                  const total = line.cantidad * line.precioUnitario;
                  
                  return (
                    <tr key={line.id} className={`border-b border-zinc-100 ${isND ? 'hover:bg-blue-50/10' : 'hover:bg-red-50/10'} transition-colors`}>
                      <td className="py-3 px-4 text-center text-xs text-zinc-400 font-mono">{idx + 1}</td>
                      <td className="py-3 px-2">
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-zinc-700">{line.concepto}</span>
                          {line.DcdDscItem && <span className="text-[10px] text-zinc-400 mt-0.5">{line.DcdDscItem}</span>}
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center text-xs font-bold text-zinc-400 font-mono bg-zinc-50/40">
                        {line.originalQty}
                      </td>
                      <td className="py-3 px-2 text-center">
                        <input
                          type="number"
                          value={line.cantidad}
                          onChange={e => handleLineChange(idx, 'cantidad', e.target.value)}
                          className={`w-20 text-center text-xs font-bold border border-zinc-200 ${isND ? 'focus:border-blue-500 text-blue-600 bg-blue-50/20' : 'focus:border-red-500 text-red-600 bg-red-50/20'} rounded-lg px-2 py-1 outline-none font-mono`}
                          min="0"
                          step="0.0001"
                        />
                      </td>
                      <td className="py-3 px-2 text-right text-xs font-bold text-zinc-400 font-mono bg-zinc-50/40">
                        {currencySymbol} {fmt(line.originalPrice)}
                      </td>
                      <td className="py-3 px-2 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <span className="text-xs font-bold text-zinc-400">{currencySymbol}</span>
                          <input
                            type="number"
                            value={line.precioUnitario}
                            onChange={e => handleLineChange(idx, 'precioUnitario', e.target.value)}
                            className={`w-24 text-right text-xs font-bold border border-zinc-200 ${isND ? 'focus:border-blue-500 text-blue-600 bg-blue-50/20' : 'focus:border-red-500 text-red-600 bg-red-50/20'} rounded-lg px-2 py-1 outline-none font-mono`}
                            min="0"
                            step="0.01"
                          />
                        </div>
                      </td>
                      <td className="py-3 px-2 text-center">
                        <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-black bg-zinc-100 text-zinc-600 border border-zinc-200">
                          {line.iva}%
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-xs font-bold text-zinc-500 font-mono">
                        {currencySymbol} {fmt(subtotal)}
                      </td>
                      <td className="py-3 px-4 text-right text-xs font-extrabold text-zinc-800 font-mono">
                        {currencySymbol} {fmt(total)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleDeleteLine(idx)}
                          className={`p-1.5 text-zinc-300 ${isND ? 'hover:text-blue-600 hover:bg-blue-50' : 'hover:text-red-600 hover:bg-red-50'} rounded-lg transition-colors`}
                          title={`Eliminar de la nota de ${isND ? 'débito' : 'crédito'}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {formData.Lineas.length === 0 && (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-sm font-semibold text-zinc-400 italic">
                      No hay líneas en la Nota de {isND ? 'Débito' : 'Crédito'}. Se requiere al menos un concepto.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* PANEL DE TOTALES COMPILADO Y TOTALES ORIGINALES */}
          <div className="bg-zinc-50 border-t border-zinc-200 p-4 shrink-0 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 px-3.5 py-2 rounded-xl">
              <AlertTriangle size={16} className="shrink-0" />
              <div className="font-semibold leading-normal">
                Comprobante original total: <span className="font-black text-amber-900">{currencySymbol} {fmt(doc.DocTotal)}</span>. 
                El total de la Nota de {isND ? 'Débito' : 'Crédito'} no puede superarlo.
              </div>
            </div>

            <div className="flex items-center gap-6 self-end sm:self-auto">
              <div className="text-right flex flex-col">
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Subtotal Neto</span>
                <span className="text-xs font-bold text-zinc-600 font-mono">{currencySymbol} {fmt(totales.subtotal)}</span>
              </div>
              <div className="text-right flex flex-col">
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">{isND ? 'IVA Debitado' : 'IVA Reversado'}</span>
                <span className="text-xs font-bold text-zinc-600 font-mono">{currencySymbol} {fmt(totales.iva)}</span>
              </div>
              <div className={`border rounded-xl px-4 py-2 text-right flex flex-col ${isND ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                <span className={`text-[10px] font-black ${isND ? 'text-blue-500' : 'text-red-500'} uppercase tracking-wider`}>
                  Total a {isND ? 'Debitar' : 'Acreditar'}
                </span>
                <span className={`text-lg font-black ${isND ? 'text-blue-700' : 'text-red-700'} font-mono leading-none mt-1`}>
                  {currencySymbol} {fmt(totales.total)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ACCIONES DEL FORMULARIO */}
        <div className="bg-white border border-zinc-200 rounded-2xl p-4 shrink-0 flex items-center justify-between shadow-sm">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-5 py-2.5 rounded-xl border border-zinc-200 text-xs font-black text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-all uppercase tracking-wider shadow-sm"
          >
            Cancelar
          </button>
          
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || formData.Lineas.length === 0}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl ${isND ? 'bg-blue-600 hover:bg-blue-700 shadow-blue-600/10' : 'bg-red-600 hover:bg-red-700 shadow-red-600/10'} text-white font-black text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-md`}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Generando...
              </>
            ) : (
              <>
                <Save size={16} />
                Confirmar y Generar {isND ? 'ND' : 'NC'}
              </>
            )}
          </button>
        </div>

      </div>
    </div>
  );
}
