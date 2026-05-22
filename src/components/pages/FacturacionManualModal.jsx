import React, { useState, useEffect, useMemo } from 'react';
import { X, CheckCircle, FileText, User, Plus, Trash2, DollarSign } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';



export default function FacturacionManualModal({ onClose, onSuccess, initialData }) {
  const [clientes, setClientes] = useState([]);
  const [tiposDocs, setTiposDocs] = useState([]);
  const [monedas, setMonedas] = useState([]);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState(() => {
    if (initialData) {
      return {
        DocTipo: initialData.DocTipo || 'FACTURA',
        MonIdMoneda: initialData.MonIdMoneda || 1,
        CliIdCliente: initialData.CliIdCliente || '',
        Lineas: (initialData.lineas || []).map((l, idx) => {
          const qty = parseFloat(l.DcdCantidad) || 1;
          const sub = parseFloat(l.DcdSubtotal) || 0;
          const imp = parseFloat(l.DcdImpuestos) || 0;
          
          // Calcular el precio unitario neto real facturado
          const unitPrice = qty > 0 ? (sub / qty) : (parseFloat(l.DcdPrecioUnitario) || 0);
          
          // Calcular la tasa de IVA aproximada (22%, 10%, o 0%)
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
            cantidad: qty,
            precioUnitario: parseFloat(unitPrice.toFixed(4)),
            iva: ivaRate
          };
        })
      };
    }
    return {
      DocTipo: 'FACTURA',
      MonIdMoneda: 1, // 1 = UYU, 2 = USD
      CliIdCliente: '',
      Lineas: [
        { id: Date.now(), concepto: '', cantidad: 1, precioUnitario: '', iva: 22 }
      ]
    };
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [resClientes, resNomencladores] = await Promise.all([
        api.get('/clients'),
        api.get('/contabilidad/cfe/nomencladores')
      ]);
      setClientes(resClientes.data || []);
      if (resNomencladores.data?.success) {
        const tDocs = resNomencladores.data.tiposDocumentos || [];
        setTiposDocs(tDocs);
        setMonedas(resNomencladores.data.monedas || []);
        if (tDocs.length > 0 && !initialData) {
          setFormData(prev => ({ ...prev, DocTipo: tDocs[0].value }));
        }
      }
    } catch (e) {
      console.error('Error cargando datos:', e);
    }
  };

  // --- Helpers para Líneas ---
  const addLinea = () => {
    setFormData(prev => ({
      ...prev,
      Lineas: [...prev.Lineas, { id: Date.now(), concepto: '', cantidad: 1, precioUnitario: '', iva: 22 }]
    }));
  };

  const removeLinea = (id) => {
    setFormData(prev => ({
      ...prev,
      Lineas: prev.Lineas.filter(l => l.id !== id)
    }));
  };

  const updateLinea = (id, field, value) => {
    setFormData(prev => ({
      ...prev,
      Lineas: prev.Lineas.map(l => l.id === id ? { ...l, [field]: value } : l)
    }));
  };

  // --- Cálculos ---
  const totales = useMemo(() => {
    let subtotal = 0;
    let totalIva = 0;
    formData.Lineas.forEach(l => {
      const qty = parseFloat(l.cantidad) || 0;
      const price = parseFloat(l.precioUnitario) || 0;
      const ivaRate = parseFloat(l.iva) || 0;
      const lineNeto = qty * price;
      const lineIva = lineNeto * (ivaRate / 100);
      subtotal += lineNeto;
      totalIva += lineIva;
    });
    return {
      subtotal,
      iva: totalIva,
      total: subtotal + totalIva
    };
  }, [formData.Lineas]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (formData.DocTipo === 'FACTURA' && !formData.CliIdCliente) {
      return toast.error('Las e-Facturas requieren un cliente con RUT seleccionado.');
    }
    
    const lineasValidas = formData.Lineas.filter(l => l.concepto.trim() !== '' && l.precioUnitario > 0);
    if (lineasValidas.length === 0) {
      return toast.error('Debe agregar al menos una línea con concepto y precio.');
    }

    setLoading(true);
    try {
      await api.post('/contabilidad/cfe/manual', {
        DocTipo: formData.DocTipo,
        MonIdMoneda: formData.MonIdMoneda,
        CliIdCliente: formData.CliIdCliente ? parseInt(formData.CliIdCliente) : null,
        Lineas: lineasValidas.map(l => ({
          concepto: l.concepto,
          cantidad: parseFloat(l.cantidad),
          precioUnitario: parseFloat(l.precioUnitario),
          iva: parseFloat(l.iva)
        })),
        Totales: totales
      });
      toast.success('Documento generado exitosamente');
      onSuccess();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Error al emitir el documento');
    } finally {
      setLoading(false);
    }
  };

  const formatMoney = (val) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2 }).format(val);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50  animate-in fade-in">
      <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full overflow-hidden flex flex-col h-[85vh]">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2.5 rounded-xl text-blue-600">
              <FileText size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 tracking-tight">Nueva Factura Manual Libre</h2>
              <p className="text-sm font-medium text-slate-500">Emisión directa a DGI sin pasar por Caja</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
            <X size={24} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          <form id="factura-form" onSubmit={handleSubmit} className="flex flex-col gap-8">
            
            {/* Cabezal */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-slate-50 p-5 rounded-2xl border border-slate-100">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Tipo de Documento</label>
                <select 
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={formData.DocTipo}
                  onChange={(e) => setFormData({...formData, DocTipo: e.target.value})}
                >
                  {tiposDocs.length > 0 
                    ? tiposDocs.map(t => <option key={t.value} value={t.value}>{t.label}</option>)
                    : <option value={formData.DocTipo}>Cargando documentos...</option>
                  }
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">Moneda</label>
                <select 
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={formData.MonIdMoneda}
                  onChange={(e) => setFormData({...formData, MonIdMoneda: parseInt(e.target.value)})}
                >
                  {monedas.length > 0 ? (
                    monedas.map(m => <option key={m.id} value={m.id}>{m.simbolo} - {m.nombre}</option>)
                  ) : (
                    <>
                      <option value={1}>UYU - Pesos Uruguayos</option>
                      <option value={2}>USD - Dólares</option>
                    </>
                  )}
                </select>
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-bold text-slate-700 mb-2">
                  <User size={16} className="text-slate-400"/> Cliente (Opcional en e-Ticket)
                </label>
                <select 
                  className="w-full border border-slate-200 rounded-xl px-4 py-2.5 font-medium text-slate-800 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={formData.CliIdCliente}
                  onChange={(e) => setFormData({...formData, CliIdCliente: e.target.value})}
                >
                  <option value="">Consumidor Final / Mostrador</option>
                  {clientes.map(c => (
                    <option key={c.CodCliente || c.CliIdCliente} value={c.CodCliente || c.CliIdCliente}>
                      {c.Nombre || c.NombreFantasia} {c.CioRuc ? `(RUT: ${c.CioRuc})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Líneas */}
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-800">Conceptos a Facturar</h3>
                <button 
                  type="button" 
                  onClick={addLinea}
                  className="text-sm font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 flex items-center gap-1"
                >
                  <Plus size={16}/> Agregar Fila
                </button>
              </div>

              <div className="border border-slate-200 rounded-2xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase">
                    <tr>
                      <th className="p-3 pl-4">Concepto o Descripción</th>
                      <th className="p-3 w-24">Cant.</th>
                      <th className="p-3 w-32">Precio Unit.</th>
                      <th className="p-3 w-28">IVA %</th>
                      <th className="p-3 w-32 text-right">Subtotal</th>
                      <th className="p-3 w-12 text-center"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {formData.Lineas.map((line, index) => {
                      const net = (parseFloat(line.cantidad) || 0) * (parseFloat(line.precioUnitario) || 0);
                      return (
                        <tr key={line.id} className="hover:bg-slate-50">
                          <td className="p-2 pl-4">
                            <input 
                              type="text" 
                              required
                              placeholder="Ej. Servicios varios..."
                              className="w-full bg-transparent border-none focus:ring-0 text-sm font-medium outline-none"
                              value={line.concepto}
                              onChange={(e) => updateLinea(line.id, 'concepto', e.target.value)}
                            />
                          </td>
                          <td className="p-2">
                            <input 
                              type="number" 
                              required min="0" step="any"
                              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm outline-none focus:border-blue-500"
                              value={line.cantidad}
                              onChange={(e) => updateLinea(line.id, 'cantidad', e.target.value)}
                            />
                          </td>
                          <td className="p-2">
                            <input 
                              type="number" 
                              required min="0" step="any"
                              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm outline-none focus:border-blue-500"
                              value={line.precioUnitario}
                              onChange={(e) => updateLinea(line.id, 'precioUnitario', e.target.value)}
                            />
                          </td>
                          <td className="p-2">
                            <select 
                              className="w-full bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm outline-none focus:border-blue-500"
                              value={line.iva}
                              onChange={(e) => updateLinea(line.id, 'iva', e.target.value)}
                            >
                              <option value={22}>Básico 22%</option>
                              <option value={10}>Mínimo 10%</option>
                              <option value={0}>Exento 0%</option>
                            </select>
                          </td>
                          <td className="p-2 text-right font-mono text-sm text-slate-700">
                            {formatMoney(net)}
                          </td>
                          <td className="p-2 text-center">
                            {formData.Lineas.length > 1 && (
                              <button 
                                type="button" 
                                onClick={() => removeLinea(line.id)}
                                className="text-slate-300 hover:text-red-500 p-1"
                              >
                                <Trash2 size={16}/>
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </form>

          {/* Resumen */}
          <div className="mt-8 flex justify-end">
            <div className="w-72 bg-slate-50 p-5 rounded-2xl border border-slate-100 flex flex-col gap-2">
              <div className="flex justify-between text-sm font-bold text-slate-500">
                <span>Subtotal Neto</span>
                <span>{formData.MonIdMoneda === 1 ? '$' : 'U$S'} {formatMoney(totales.subtotal)}</span>
              </div>
              <div className="flex justify-between text-sm font-bold text-slate-500">
                <span>IVA Total</span>
                <span>{formData.MonIdMoneda === 1 ? '$' : 'U$S'} {formatMoney(totales.iva)}</span>
              </div>
              <div className="h-px bg-slate-200 my-1"></div>
              <div className="flex justify-between text-lg font-black text-slate-800">
                <span>Total Final</span>
                <span className="text-blue-600">{formData.MonIdMoneda === 1 ? '$' : 'U$S'} {formatMoney(totales.total)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-100 bg-white flex justify-end gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl font-bold text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            form="factura-form"
            disabled={loading}
            className="px-6 py-2.5 rounded-xl font-bold bg-blue-600 text-white hover:bg-blue-700 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Generando...' : <><CheckCircle size={18} /> Generar y Enviar a Deuda</>}
          </button>
        </div>
      </div>
    </div>
  );
}
