import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';
import { validarDocumentoUY } from '../../utils/documentoUY';
import { esEFactura, esETicket } from '../../utils/dgiComprobante';

/*
 * Bloque "Datos DGI del Comprobante" — el mismo que la Facturación Manual, reutilizable.
 * Deja editar los datos del RECEPTOR por comprobante (nombre, documento, dirección, ciudad),
 * con validación en vivo del documento contra el tipo de CFE elegido.
 *
 * Es controlado: el padre le pasa `value` y recibe `onChange(nuevoValue)`. No guarda nada por
 * su cuenta; procesar/emitir es responsabilidad del padre.
 *
 *   value = { nombre, nombreFantasia, documento, direccion, ciudad }
 */
export default function DatosDgiComprobante({
  value,
  onChange,
  cliente = null,        // ficha del cliente elegido (para "Restaurar")
  tipoDoc,               // código o etiqueta del comprobante
  totalUYU = 0,          // total del comprobante en pesos (para el umbral del e-Ticket)
  umbralUYU = 0,
}) {
  const [departamentos, setDepartamentos] = useState([]);

  useEffect(() => {
    api.get('/nomenclators/departments')
      .then(r => setDepartamentos(r.data?.data || r.data || []))
      .catch(() => setDepartamentos([]));
  }, []);

  const set = (campo, val) => onChange({ ...value, [campo]: val });

  // Rellena los datos DGI desde la ficha del cliente elegido.
  const restaurarDesdeFicha = () => {
    if (!cliente) return;
    onChange({
      nombre: cliente.Nombre || cliente.NombreFantasia || '',
      nombreFantasia: value.nombreFantasia || '',
      documento: cliente.CioRuc || '',
      direccion: cliente.DireccionTrabajo || '',
      ciudad: cliente.Ciudad || cliente.Departamento || '',
    });
  };

  // Consumidor final: sin datos de receptor (e-Ticket a consumidor).
  const consumidorFinal = () => onChange({
    nombre: 'CONSUMIDOR FINAL', nombreFantasia: '', documento: '', direccion: '', ciudad: '',
  });

  const factura = esEFactura(tipoDoc);
  const ticket = esETicket(tipoDoc);

  // Feedback en vivo del documento (misma lógica que la Facturación Manual).
  const feedbackDoc = () => {
    if (!factura && !ticket) return null;
    const docStr = String(value.documento || '').trim();
    if (!docStr) {
      if (factura) return <span className="text-[9px] font-black text-rose-600 px-1 block mt-0.5">✗ La e-Factura requiere el RUT del cliente (12 dígitos, sin puntos ni guiones)</span>;
      if (ticket && totalUYU > umbralUYU && umbralUYU > 0) {
        return <span className="text-[9px] font-black text-amber-600 px-1 block mt-0.5">⚠ Supera el umbral DGI: ingresá la CI o el RUT del comprador</span>;
      }
      return null;
    }
    const v = validarDocumentoUY(docStr);
    if (!v.valido) return <span className="text-[9px] font-black text-rose-600 px-1 block mt-0.5">✗ {v.motivo}</span>;
    if (factura && v.tipo !== 'RUT') return <span className="text-[9px] font-black text-rose-600 px-1 block mt-0.5">✗ Es una Cédula válida, pero la e-Factura requiere un RUT (12 dígitos)</span>;
    return <span className="text-[9px] font-black text-emerald-600 px-1 block mt-0.5">✓ {v.tipo === 'RUT' ? 'RUT válido' : 'Cédula válida'}</span>;
  };

  return (
    <div className="flex flex-col gap-2.5 bg-zinc-50 border border-zinc-200/60 rounded-xl p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[9px] font-black text-zinc-400 uppercase tracking-widest px-1">Datos DGI Comprobante</h3>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={consumidorFinal}
            className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 cursor-pointer">
            Cons. Final
          </button>
          <button type="button" onClick={restaurarDesdeFicha} disabled={!cliente}
            className="px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed">
            Restaurar
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-1">
        <div>
          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">Nombre / Razón Social</label>
          <input type="text" value={value.nombre || ''} onChange={e => set('nombre', e.target.value)}
            className="w-full border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-indigo-500 outline-none bg-white text-zinc-800 shadow-sm mt-0.5" />
        </div>
        <div>
          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">Nombre de Fantasía (opcional — se imprime en ESTE comprobante, no va a DGI)</label>
          <input type="text" value={value.nombreFantasia || ''} onChange={e => set('nombreFantasia', e.target.value)}
            placeholder="Vacío = no se imprime ninguna línea de fantasía"
            className="w-full border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-indigo-500 outline-none bg-white text-zinc-800 shadow-sm mt-0.5" />
        </div>
        <div>
          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">Documento (RUT / CI)</label>
          <input type="text" value={value.documento || ''} onChange={e => set('documento', e.target.value)}
            className="w-full border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-indigo-500 outline-none bg-white text-zinc-800 shadow-sm mt-0.5" />
          {feedbackDoc()}
        </div>
        <div>
          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">Dirección DGI</label>
          <input type="text" value={value.direccion || ''} onChange={e => set('direccion', e.target.value)}
            className="w-full border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-indigo-500 outline-none bg-white text-zinc-800 shadow-sm mt-0.5" />
        </div>
        <div>
          <label className="text-[8px] font-black text-zinc-400 uppercase tracking-widest px-1">Ciudad / Depto</label>
          <select value={value.ciudad || ''} onChange={e => set('ciudad', e.target.value)}
            className="w-full border border-zinc-200 rounded-lg px-2.5 py-1.5 text-xs font-bold focus:border-indigo-500 outline-none bg-white text-zinc-800 shadow-sm mt-0.5 cursor-pointer">
            <option value="">— Seleccionar —</option>
            {departamentos.map((d, i) => {
              const nombre = d.Nombre || d.nombre || d.Departamento || d;
              return <option key={d.Id || d.id || i} value={nombre}>{nombre}</option>;
            })}
          </select>
        </div>
      </div>
    </div>
  );
}
