import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, Plus, Trash2, FileText, AlertTriangle, Loader2, User, Search } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';
import { useEmpresas } from '../../hooks/useEmpresas';

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const nuevaLinea = () => ({
  id: Date.now() + Math.random(),
  concepto: '',
  DcdDscItem: '',
  cantidad: 1,
  precioUnitario: 0,
  iva: 22,
});

export default function NcExternaModal({ onClose, onSuccess }) {
  const { empresas, empresaSeleccionada, setEmpresaSeleccionada } = useEmpresas();
  const [loading, setLoading] = useState(false);
  const [clientes, setClientes] = useState([]);
  const [qCliente, setQCliente] = useState('');
  const [cliente, setCliente] = useState(null);

  const [tipoOrigen, setTipoOrigen] = useState('TICKET'); // 'FACTURA' | 'TICKET'
  const [serieOrigen, setSerieOrigen] = useState('');
  const [numeroOrigen, setNumeroOrigen] = useState('');
  const [fechaOrigen, setFechaOrigen] = useState(todayStr());
  const [totalOrigen, setTotalOrigen] = useState('');
  const [monedaId, setMonedaId] = useState(1); // 1 UYU / 2 USD
  const [motivo, setMotivo] = useState('');
  const [lineas, setLineas] = useState([nuevaLinea()]);

  useEffect(() => {
    api.get('/clients').then(res => setClientes(res.data || [])).catch(() => {});
  }, []);

  const filteredClientes = useMemo(() => {
    if (!qCliente.trim()) return [];
    const q = qCliente.toLowerCase();
    return clientes.filter(c =>
      String(c.Nombre || '').toLowerCase().includes(q) ||
      String(c.NombreFantasia || '').toLowerCase().includes(q) ||
      String(c.CioRuc || '').toLowerCase().includes(q)
    ).slice(0, 10);
  }, [clientes, qCliente]);

  const totales = useMemo(() => {
    let subtotal = 0, total = 0;
    lineas.forEach(l => {
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
      total: parseFloat(total.toFixed(2)),
    };
  }, [lineas]);

  const handleLineChange = (index, field, val) => {
    setLineas(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: val };
      return updated;
    });
  };

  const handleAddLinea = () => setLineas(prev => [...prev, nuevaLinea()]);
  const handleDeleteLinea = (index) => setLineas(prev => prev.filter((_, idx) => idx !== index));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!cliente) return toast.error('Debe seleccionar el cliente');
    if (!serieOrigen.trim() || !numeroOrigen.trim()) return toast.error('Debe indicar Serie y Número de la factura original');
    if (!fechaOrigen) return toast.error('Debe indicar la fecha de emisión de la factura original');
    const totalOrigenNum = Number(totalOrigen);
    if (!totalOrigenNum || totalOrigenNum <= 0) return toast.error('Debe indicar el total de la factura original');
    if (!motivo.trim()) return toast.error('Debe ingresar un motivo para la Nota de Crédito');
    if (lineas.length === 0) return toast.error('Debe acreditar al menos una línea');
    if (totales.total > totalOrigenNum + 0.01) {
      return toast.error(`El total a acreditar (${fmt(totales.total)}) no puede superar el total de la factura original (${fmt(totalOrigenNum)})`);
    }

    setLoading(true);
    try {
      const payload = {
        clienteId: cliente.CliIdCliente,
        tipoOrigen,
        serieOrigen: serieOrigen.trim(),
        numeroOrigen: numeroOrigen.trim(),
        fechaOrigen,
        totalOrigen: totalOrigenNum,
        monedaId,
        motivo: motivo.trim(),
        empresaId: empresaSeleccionada?.EmpIdEmpresa ?? null,
        Lineas: lineas.map(l => ({
          concepto: (l.concepto || '').trim(),
          DcdDscItem: (l.DcdDscItem || '').trim(),
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          iva: l.iva,
        })),
        Totales: totales,
      };
      const res = await api.post('/contabilidad/caja/nota-credito-externa', payload);
      toast.success(`Nota de Crédito ${res.data?.ncNumero || ''} generada — enviala a DGI desde la Bandeja CFE`);
      onSuccess();
    } catch (error) {
      toast.error('Error al generar la Nota de Crédito: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const currencySymbol = monedaId === 2 ? 'U$S' : '$';

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/50 flex flex-col w-screen h-screen overflow-hidden animate-in fade-in select-none">
      <div className="bg-white border-b border-zinc-200 px-6 py-3.5 flex items-center justify-between shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-red-600 shadow-red-600/10 p-2 rounded-xl text-white shadow-md">
            <FileText size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-zinc-800 tracking-tight leading-none">
              Nota de Crédito sobre Factura Externa
            </h2>
            <p className="text-xs font-semibold text-zinc-400 mt-1">
              Para facturas emitidas con el sistema de facturación electrónica anterior. Solo genera el CFE a enviar a DGI — no afecta la cuenta corriente del cliente.
            </p>
          </div>
        </div>
        {empresas.length > 0 && (
          <div className="flex items-center gap-2 ml-auto mr-3">
            <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Empresa emisora</span>
            <select
              value={empresaSeleccionada?.EmpIdEmpresa ?? ''}
              onChange={(ev) => setEmpresaSeleccionada(empresas.find(e => e.EmpIdEmpresa === Number(ev.target.value)))}
              disabled={empresas.length <= 1}
              className="bg-white border border-zinc-200 rounded-lg px-3 py-1.5 text-sm font-bold text-zinc-800 outline-none focus:border-red-500 cursor-pointer disabled:cursor-default"
            >
              {empresas.map(e => (
                <option key={e.EmpIdEmpresa} value={e.EmpIdEmpresa}>{e.EmpNombreFantasia || e.EmpRazonSocial}</option>
              ))}
            </select>
          </div>
        )}
        <button onClick={onClose} className="p-2 text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 rounded-xl transition-all">
          <X size={20} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col p-4 gap-4 min-h-0 overflow-y-auto bg-zinc-50">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 shrink-0">
          {/* Cliente */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-4 flex flex-col gap-3 shadow-sm">
            <h3 className="text-xs font-bold uppercase text-zinc-400 tracking-wider flex items-center justify-between">
              Cliente
              <span className="text-[9px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider">Requerido</span>
            </h3>
            {!cliente ? (
              <div className="relative">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                  <input
                    type="text"
                    value={qCliente}
                    onChange={e => setQCliente(e.target.value)}
                    placeholder="Buscar cliente por nombre, RUT, C.I..."
                    className="w-full bg-zinc-50 border border-zinc-200 focus:border-red-500 focus:bg-white rounded-xl pl-8 pr-4 py-2 text-xs font-bold text-zinc-800 placeholder-zinc-400 outline-none transition-all"
                  />
                </div>
                {filteredClientes.length > 0 && (
                  <div className="absolute left-0 right-0 mt-1.5 bg-white border border-zinc-200 rounded-xl shadow-xl z-30 max-h-52 overflow-y-auto p-1.5 flex flex-col gap-1">
                    {filteredClientes.map(c => (
                      <div
                        key={c.CodCliente || c.CliIdCliente}
                        onClick={() => { setCliente(c); setQCliente(''); }}
                        className="p-2 hover:bg-red-50/50 border border-transparent hover:border-red-100/50 rounded-lg cursor-pointer transition-all flex flex-col"
                      >
                        <span className="text-xs font-extrabold text-zinc-800">{c.Nombre || c.NombreFantasia}</span>
                        <span className="text-[10px] text-zinc-400 font-mono font-bold mt-0.5">
                          {c.CioRuc ? `RUT/CI: ${c.CioRuc}` : `ID: ${c.CodCliente || c.CliIdCliente}`}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-red-50/30 border border-red-100 rounded-xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center text-white shrink-0">
                    <User size={14} />
                  </div>
                  <div>
                    <p className="text-zinc-800 text-xs font-black leading-tight">{cliente.Nombre || cliente.NombreFantasia}</p>
                    <p className="text-[10px] text-zinc-400 font-bold font-mono">{cliente.CioRuc || `ID: ${cliente.CliIdCliente}`}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setCliente(null)} className="text-zinc-400 hover:text-red-600 p-1">
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Motivo */}
          <div className="bg-white border border-zinc-200 rounded-2xl p-4 flex flex-col gap-2 shadow-sm">
            <h3 className="text-xs font-bold uppercase text-zinc-500 tracking-wider flex items-center justify-between">
              Motivo de Emisión
              <span className="text-[9px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-extrabold uppercase tracking-wider">Requerido</span>
            </h3>
            <textarea
              value={motivo}
              onChange={e => setMotivo(e.target.value)}
              placeholder="Ej. Nota de crédito de factura emitida en el sistema anterior"
              className="w-full border border-zinc-200 focus:border-red-500 rounded-xl px-3 py-2 text-xs font-semibold text-zinc-700 outline-none resize-none min-h-[54px]"
            />
          </div>
        </div>

        {/* Datos de la factura original */}
        <div className="bg-white border border-amber-200 rounded-2xl p-4 shadow-sm shrink-0">
          <h3 className="text-xs font-bold uppercase text-amber-700 tracking-wider mb-3 flex items-center gap-1.5">
            <AlertTriangle size={13} /> Datos de la Factura Original (sistema anterior)
          </h3>
          <p className="text-[10px] text-zinc-400 font-semibold mb-3">
            Deben coincidir EXACTAMENTE con lo que DGI tiene registrado para esa factura (tipo, serie, número y fecha), o DGI rechazará esta Nota de Crédito.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Tipo</label>
              <select
                value={tipoOrigen}
                onChange={e => setTipoOrigen(e.target.value)}
                className="border border-zinc-200 focus:border-red-500 rounded-xl px-2 py-1.5 text-xs font-bold text-zinc-700 outline-none"
              >
                <option value="TICKET">E-Ticket</option>
                <option value="FACTURA">E-Factura</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Serie</label>
              <input type="text" value={serieOrigen} onChange={e => setSerieOrigen(e.target.value)}
                className="border border-zinc-200 focus:border-red-500 rounded-xl px-2 py-1.5 text-xs font-bold text-zinc-700 outline-none" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Número</label>
              <input type="text" value={numeroOrigen} onChange={e => setNumeroOrigen(e.target.value)}
                className="border border-zinc-200 focus:border-red-500 rounded-xl px-2 py-1.5 text-xs font-bold text-zinc-700 outline-none" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Fecha Emisión</label>
              <input type="date" value={fechaOrigen} onChange={e => setFechaOrigen(e.target.value)}
                className="border border-zinc-200 focus:border-red-500 rounded-xl px-2 py-1.5 text-xs font-bold text-zinc-700 outline-none" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Total Original</label>
              <div className="flex items-center gap-1">
                <select value={monedaId} onChange={e => setMonedaId(Number(e.target.value))}
                  className="border border-zinc-200 focus:border-red-500 rounded-xl px-1.5 py-1.5 text-xs font-bold text-zinc-700 outline-none">
                  <option value={1}>$</option>
                  <option value={2}>U$S</option>
                </select>
                <input type="number" min="0" step="0.01" value={totalOrigen} onChange={e => setTotalOrigen(e.target.value)}
                  className="w-full border border-zinc-200 focus:border-red-500 rounded-xl px-2 py-1.5 text-xs font-bold text-zinc-700 outline-none" />
              </div>
            </div>
          </div>
        </div>

        {/* Líneas a acreditar */}
        <div className="flex-1 bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden flex flex-col min-h-0">
          <div className="bg-zinc-50 border-b border-zinc-200 px-4 py-2.5 flex items-center justify-between shrink-0">
            <span className="text-xs font-black text-zinc-600 uppercase tracking-widest">Líneas a Acreditar</span>
            <button type="button" onClick={handleAddLinea}
              className="flex items-center gap-1 text-[10px] font-black text-red-600 hover:text-red-800 bg-red-50 hover:bg-red-100 border border-red-200 rounded-lg px-2.5 py-1 transition-all uppercase tracking-wider">
              <Plus size={12} /> Agregar Línea
            </button>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-black text-zinc-400 uppercase tracking-wider">
                  <th className="py-2.5 px-4 w-12 text-center">#</th>
                  <th className="py-2.5 px-2">Concepto</th>
                  <th className="py-2.5 px-2 w-24 text-center">Cantidad</th>
                  <th className="py-2.5 px-2 w-32 text-right">Precio Unit.</th>
                  <th className="py-2.5 px-2 w-20 text-center">IVA</th>
                  <th className="py-2.5 px-4 w-32 text-right">Total</th>
                  <th className="py-2.5 px-4 w-12 text-center"></th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((line, idx) => {
                  const total = (parseFloat(line.cantidad) || 0) * (parseFloat(line.precioUnitario) || 0);
                  return (
                    <tr key={line.id} className="border-b border-zinc-100 hover:bg-red-50/10">
                      <td className="py-2.5 px-4 text-center text-xs text-zinc-400 font-mono">{idx + 1}</td>
                      <td className="py-2.5 px-2">
                        <input type="text" value={line.concepto} onChange={e => handleLineChange(idx, 'concepto', e.target.value)}
                          placeholder="Concepto"
                          className="w-full text-xs font-bold border border-zinc-200 focus:border-red-500 rounded-lg px-2 py-1 outline-none" />
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <input type="number" min="0" step="0.0001" value={line.cantidad} onChange={e => handleLineChange(idx, 'cantidad', e.target.value)}
                          className="w-20 text-center text-xs font-bold border border-zinc-200 focus:border-red-500 text-red-600 bg-red-50/20 rounded-lg px-2 py-1 outline-none font-mono" />
                      </td>
                      <td className="py-2.5 px-2 text-right">
                        <input type="number" min="0" step="0.01" value={line.precioUnitario} onChange={e => handleLineChange(idx, 'precioUnitario', e.target.value)}
                          className="w-24 text-right text-xs font-bold border border-zinc-200 focus:border-red-500 text-red-600 bg-red-50/20 rounded-lg px-2 py-1 outline-none font-mono" />
                      </td>
                      <td className="py-2.5 px-2 text-center">
                        <select value={line.iva} onChange={e => handleLineChange(idx, 'iva', Number(e.target.value))}
                          className="text-[10px] font-black bg-zinc-100 text-zinc-600 border border-zinc-200 rounded-md px-1.5 py-1 outline-none">
                          <option value={22}>22%</option>
                          <option value={10}>10%</option>
                          <option value={0}>0%</option>
                        </select>
                      </td>
                      <td className="py-2.5 px-4 text-right text-xs font-extrabold text-zinc-800 font-mono">
                        {currencySymbol} {fmt(total)}
                      </td>
                      <td className="py-2.5 px-4 text-center">
                        <button type="button" onClick={() => handleDeleteLinea(idx)}
                          className="p-1.5 text-zinc-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-zinc-50 border-t border-zinc-200 p-4 shrink-0 flex flex-col sm:flex-row gap-4 items-center justify-between">
            <div className="flex items-center gap-3 text-xs bg-amber-50 border border-amber-200 text-amber-800 px-3.5 py-2 rounded-xl">
              <AlertTriangle size={16} className="shrink-0" />
              <div className="font-semibold leading-normal">
                No genera movimiento en la cuenta corriente del cliente. Solo el CFE para DGI.
              </div>
            </div>
            <div className="flex items-center gap-6 self-end sm:self-auto">
              <div className="text-right flex flex-col">
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">Subtotal Neto</span>
                <span className="text-xs font-bold text-zinc-600 font-mono">{currencySymbol} {fmt(totales.subtotal)}</span>
              </div>
              <div className="text-right flex flex-col">
                <span className="text-[10px] font-black text-zinc-400 uppercase tracking-wider">IVA</span>
                <span className="text-xs font-bold text-zinc-600 font-mono">{currencySymbol} {fmt(totales.iva)}</span>
              </div>
              <div className="border rounded-xl px-4 py-2 text-right flex flex-col bg-red-50 border-red-200">
                <span className="text-[10px] font-black text-red-500 uppercase tracking-wider">Total a Acreditar</span>
                <span className="text-lg font-black text-red-700 font-mono leading-none mt-1">{currencySymbol} {fmt(totales.total)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl p-4 shrink-0 flex items-center justify-between shadow-sm">
          <button type="button" onClick={onClose} disabled={loading}
            className="px-5 py-2.5 rounded-xl border border-zinc-200 text-xs font-black text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700 transition-all uppercase tracking-wider shadow-sm">
            Cancelar
          </button>
          <button type="submit" disabled={loading}
            className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-black text-xs uppercase tracking-wider transition-all disabled:opacity-50 shadow-md">
            {loading ? (<><Loader2 size={16} className="animate-spin" /> Generando...</>) : (<><Save size={16} /> Confirmar y Generar NC</>)}
          </button>
        </div>
      </form>
    </div>
  );
}
