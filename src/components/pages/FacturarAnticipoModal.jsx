import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import toast from 'react-hot-toast';

export default function FacturarAnticipoModal({
  cliente,
  cuenta,
  ordenes,
  onClose,
  onConfirm
}) {
  const [working, setWorking] = useState(false);
  const [monedaFactura, setMonedaFactura] = useState(cuenta.MonIdMoneda === 2 ? 'USD' : 'UYU');
  
  // Tipo Documento (CONTADO porque ya está pagado)
  const tieneRUT = cliente?.CioRuc && String(cliente.CioRuc).replace(/\D/g, '').length === 12;
  const [tipoDocumento, setTipoDocumento] = useState(tieneRUT ? 'E-FACTURA CONTADO' : 'E-TICKET CONTADO');
  
  // Datos DGI
  const [cliDgiNombre, setCliDgiNombre] = useState(cliente?.Nombre || cliente?.NombreFantasia || '');
  const [cliDgiDocumento, setCliDgiDocumento] = useState(cliente?.CioRuc || '');
  const [cliDgiDireccion, setCliDgiDireccion] = useState(cliente?.DireccionTrabajo || '');
  const [cliDgiCiudad, setCliDgiCiudad] = useState(String(cliente?.DepartamentoID || 10));
  
  const [observaciones, setObservaciones] = useState('Pago Anticipado');
  const [valError, setValError] = useState('');

  // Total
  const total = ordenes.reduce((acc, o) => acc + Number(o.OReCostoTotalOrden || 0), 0);
  const simbolo = monedaFactura === 'USD' ? 'US$' : '$U';
  const fmt = (val) => Number(val).toFixed(2);

  const handleFacturar = async () => {
    setWorking(true);
    setValError('');
    
    if (!cliDgiNombre || !cliDgiDocumento || !cliDgiDireccion || !cliDgiCiudad) {
      setValError('Todos los datos del comprobante son obligatorios.');
      setWorking(false);
      return;
    }

    const docLimpio = String(cliDgiDocumento).replace(/\s/g, '');
    if (!/^\d+$/.test(docLimpio)) {
      setValError('El documento debe contener únicamente números.');
      setWorking(false);
      return;
    }

    if (tipoDocumento.includes('TICKET') && docLimpio.length !== 8) {
      setValError('Para emitir un e-Ticket, la Cédula (CI) debe tener exactamente 8 dígitos.');
      setWorking(false);
      return;
    } else if (tipoDocumento.includes('FACTURA') && docLimpio.length !== 12) {
      setValError('Para emitir una e-Factura, el RUT debe tener exactamente 12 dígitos.');
      setWorking(false);
      return;
    }

    try {
      const payload = {
        ordenesIds: ordenes.map(o => o.OrdIdOrden),
        tipoDocumento,
        observaciones,
        cliDgiNombre,
        cliDgiDocumento,
        cliDgiDireccion,
        cliDgiCiudad
      };

      await onConfirm(payload);
    } catch (err) {
      toast.error('Error al facturar: ' + err.message);
    } finally {
      setWorking(false);
    }
  };

  const handleUpdateClient = async () => {
    setWorking(true);
    setValError('');
    try {
      await api.patch(`/contabilidad/clientes/${cliente.CliIdCliente}/dgi`, {
        Nombre: cliDgiNombre,
        Documento: cliDgiDocumento,
        Direccion: cliDgiDireccion,
        Ciudad: cliDgiCiudad
      });
      toast.success('Datos del cliente actualizados en la base de datos.');
    } catch (err) {
      toast.error('Error al actualizar: ' + err.message);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-800/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[95vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 bg-white border-b border-slate-100">
          <div>
            <h3 className="text-xl font-black text-slate-800">Facturar Órdenes por Anticipo</h3>
            <p className="text-sm text-slate-500 mt-1">Se generará un documento contado para {ordenes.length} órdenes ya cobradas.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
            <X size={20} />
          </button>
        </div>
        
        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 flex flex-col gap-4">
          
          {valError && (
            <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl shadow-sm text-sm font-medium flex items-center gap-2">
              <i className="fa-solid fa-triangle-exclamation"></i>
              {valError}
            </div>
          )}

          {/* DGI */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex justify-between items-center mb-3">
              <h4 className="text-xs font-black uppercase tracking-widest text-slate-500">Datos DGI del Comprobante</h4>
              <button onClick={handleUpdateClient} disabled={working} 
                className="flex items-center gap-1.5 text-[10px] uppercase font-bold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-3 py-1.5 rounded-md transition-colors border border-indigo-200 shadow-sm">
                <i className="fa-solid fa-cloud-arrow-up"></i>
                Actualizar Ficha
              </button>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400">Nombre / Razón Social</label>
                <input type="text" value={cliDgiNombre} onChange={e => setCliDgiNombre(e.target.value)}
                  className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-indigo-500 font-medium" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400">Documento (RUT / CI)</label>
                <input type="text" value={cliDgiDocumento} onChange={e => setCliDgiDocumento(e.target.value)}
                  className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-indigo-500 font-mono" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400">Dirección</label>
                <input type="text" value={cliDgiDireccion} onChange={e => setCliDgiDireccion(e.target.value)}
                  className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-indigo-500 font-medium" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400">Ciudad / Depto</label>
                <select value={cliDgiCiudad} onChange={e => setCliDgiCiudad(e.target.value)}
                  className="bg-white border border-slate-200 text-slate-700 px-3 py-1.5 rounded-lg text-sm focus:outline-none focus:border-indigo-500 font-medium">
                  <option value="1">Artigas</option>
                  <option value="2">Canelones</option>
                  <option value="10">Montevideo</option>
                  {/* Simplificado para brevedad */}
                </select>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
             <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3">Orden</th>
                    <th className="px-4 py-3">Descripción</th>
                    <th className="px-4 py-3 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ordenes.map(o => (
                    <tr key={o.OrdIdOrden} className="hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono font-medium text-indigo-600">{o.OrdCodigoOrden}</td>
                      <td className="px-4 py-3 text-slate-600">{o.OrdNombreTrabajo || 'Sin descripción'}</td>
                      <td className="px-4 py-3 text-right font-mono font-medium text-slate-700">{simbolo} {fmt(o.OReCostoTotalOrden)}</td>
                    </tr>
                  ))}
                </tbody>
             </table>
          </div>

        </div>

        {/* Footer */}
        <div className="bg-white px-6 py-5 border-t border-slate-100 flex items-center justify-between">
           <div className="flex items-center gap-4">
              <select 
                value={tipoDocumento} 
                onChange={e => setTipoDocumento(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-700 outline-none focus:border-indigo-500"
              >
                <option value="E-FACTURA CONTADO">e-Factura Contado</option>
                <option value="E-TICKET CONTADO">e-Ticket Contado</option>
                <option value="FACTURA">Factura Manual</option>
              </select>
           </div>
           <div className="text-right">
             <p className="text-indigo-500 uppercase font-black text-[11px] mb-1">Total a Facturar</p>
             <p className="font-mono font-black text-indigo-600 text-3xl">
               {simbolo} {fmt(total)}
             </p>
           </div>
        </div>

        {/* Actions */}
        <div className="bg-slate-50 px-6 py-4 flex justify-end gap-3 border-t border-slate-200">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-800">
            Cancelar
          </button>
          <button onClick={handleFacturar} disabled={working}
            className="flex items-center gap-2 px-8 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black rounded-xl shadow-md disabled:opacity-50">
            {working ? <RefreshCw size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
            Emitir Documento DGI
          </button>
        </div>
      </div>
    </div>
  );
}
