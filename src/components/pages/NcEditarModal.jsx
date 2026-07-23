import React, { useState, useEffect, useMemo } from 'react';
import { X, Save, Plus, Trash2, FileText, AlertTriangle, Loader2, User, Search, Link2 } from 'lucide-react';
import api from '../../services/apiClient';
import { toast } from 'sonner';
import { useEmpresas } from '../../hooks/useEmpresas';
import { getTipoDocName } from '../../utils/tiposDocumento';

/*
 * ══════════════════════════════════════════════════════════════════════════
 *  Edición de una Nota de Crédito / Débito YA CREADA, mientras no se envió a DGI.
 * ══════════════════════════════════════════════════════════════════════════
 *
 *  Es una copia de NcExternaModal.jsx (el alta de NC sobre factura externa) con
 *  el mismo layout, porque una nota se edita mirando lo mismo que se carga:
 *  cliente, motivo, datos del comprobante original y líneas a acreditar.
 *
 *  Por qué NO se reusa FacturacionManualModal: ese modal existe para EMITIR una
 *  venta. Trae solapas de tipo de comprobante, serie, contado/crédito, medios de
 *  pago y calculadora de vuelto — nada de eso aplica a una nota, y además al
 *  abrir una NC mandaba DocTipo='E-Ticket Contado' y la CONVERTÍA en venta.
 *
 *  Qué se guarda y dónde:
 *    · cliente, líneas, importes, motivo → la NOTA          (editarFactura)
 *    · tipo/serie/número/fecha/total del original → el documento REFERENCIADO,
 *      que es donde viven esos datos (referenciaExterna en el mismo endpoint).
 *      Solo se editan si el referenciado es un stub externo; si la nota corrige
 *      un comprobante emitido por este sistema, se muestran de solo lectura.
 */

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const nuevaLinea = () => ({
  id: Date.now() + Math.random(),
  concepto: '',
  DcdDscItem: '',
  cantidad: 1,
  precioUnitario: 0,
  iva: 22,
});

/** 'YYYY-MM-DD' desde lo que venga del backend, leído en UTC (ver utils/fechas.js). */
const toDateInput = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d)) return '';
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

export default function NcEditarModal({ docId, onClose, onSuccess }) {
  const { empresas, empresaSeleccionada, setEmpresaSeleccionada } = useEmpresas();
  const [cargando, setCargando] = useState(true);
  const [loading, setLoading] = useState(false);

  const [doc, setDoc] = useState(null);            // la nota que se está editando
  const [refOrigen, setRefOrigen] = useState(null); // documento referenciado, tal como vino

  const [clientes, setClientes] = useState([]);
  const [qCliente, setQCliente] = useState('');
  const [cliente, setCliente] = useState(null);

  const [tipoOrigen, setTipoOrigen] = useState('TICKET'); // 'FACTURA' | 'TICKET'
  const [serieOrigen, setSerieOrigen] = useState('');
  const [numeroOrigen, setNumeroOrigen] = useState('');
  const [fechaOrigen, setFechaOrigen] = useState('');
  const [totalOrigen, setTotalOrigen] = useState('');
  const [monedaId, setMonedaId] = useState(1);
  const [motivo, setMotivo] = useState('');
  const [lineas, setLineas] = useState([]);

  // El original solo se puede corregir si es un stub externo cargado a mano.
  const origenEditable = refOrigen?.origen === 'EXTERNO';

  useEffect(() => {
    api.get('/clients').then(res => setClientes(res.data || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!docId) return;
    let vivo = true;
    setCargando(true);
    api.get(`/contabilidad/cfe/documentos/${docId}/detalle`)
      .then(res => {
        if (!vivo) return;
        const d = res.data?.doc;
        const ref = res.data?.referencia || null;
        if (!d) throw new Error('Sin datos del documento');
        setDoc(d);
        setRefOrigen(ref);
        setMonedaId(d.MonIdMoneda === 2 ? 2 : 1);
        setMotivo(d.DocMotivoRef || '');
        setCliente(d.CliIdCliente ? {
          CliIdCliente: d.CliIdCliente,
          Nombre: d.CliRazonSocial || d.DocCliNombre,
          NombreFantasia: d.CliNombreFantasia,
          CioRuc: d.CliRUT || d.DocCliDocumento,
        } : null);

        if (ref) {
          setTipoOrigen(/factura/i.test(ref.DocTipo || '') ? 'FACTURA' : 'TICKET');
          setSerieOrigen(String(ref.DocSerie || '').trim());
          setNumeroOrigen(String(ref.DocNumero || '').trim());
          setFechaOrigen(toDateInput(ref.DocFechaEmision));
          setTotalOrigen(String(ref.DocTotal ?? ''));
        }

        const det = res.data?.detalles || [];
        setLineas(det.length ? det.map((l, i) => ({
          id: `${l.DcdIdDetalle || i}-${i}`,
          concepto: l.DcdNomItem || '',
          DcdDscItem: l.DcdDscItem || '',
          cantidad: l.DcdCantidad ?? 1,
          // Precio CON iva: la grilla trabaja sobre el total de línea, igual que en el alta
          precioUnitario: Number(l.DcdCantidad) ? Number(l.DcdTotal) / Number(l.DcdCantidad) : Number(l.DcdTotal || 0),
          iva: Number(l.DcdImpuestos) > 0 ? 22 : 0,
        })) : [nuevaLinea()]);
      })
      .catch(err => toast.error('No se pudo cargar la nota: ' + (err.response?.data?.error || err.message)))
      .finally(() => { if (vivo) setCargando(false); });
    return () => { vivo = false; };
  }, [docId]);

  // La empresa emisora del documento manda sobre el default del hook
  useEffect(() => {
    if (doc?.EmpIdEmpresa && empresas.length) {
      const m = empresas.find(e => e.EmpIdEmpresa === doc.EmpIdEmpresa);
      if (m) setEmpresaSeleccionada(m);
    }
  }, [doc, empresas, setEmpresaSeleccionada]);

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
      total += lineTotal;
      subtotal += lineTotal / (1 + ivaRate / 100);
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
    if (!motivo.trim()) return toast.error('Debe ingresar un motivo para la nota');
    // NO se filtran las líneas incompletas: los totales se calculan sobre TODAS, así que
    // descartar alguna al guardar dejaba la cabecera con un importe y el detalle con otro
    // (la nota decía 3,08 y la única línea guardada era de 1,08). Si una línea está a medias,
    // se avisa y no se guarda nada.
    const incompletas = lineas
      .map((l, i) => ({ n: i + 1, l }))
      .filter(({ l }) => !(l.concepto || '').trim() || !((parseFloat(l.precioUnitario) || 0) > 0));
    if (incompletas.length) {
      return toast.error(
        `La línea ${incompletas.map(x => x.n).join(', ')} está incompleta (le falta concepto o importe). ` +
        `Completala o borrala: si no, el total de la nota no coincidiría con el detalle.`
      );
    }
    const lineasValidas = lineas;
    if (!lineasValidas.length) return toast.error('Debe acreditar al menos una línea con concepto e importe');

    if (origenEditable) {
      if (!serieOrigen.trim() || !numeroOrigen.trim()) return toast.error('Debe indicar Serie y Número del comprobante original');
      if (!fechaOrigen) return toast.error('Debe indicar la fecha de emisión del comprobante original');
      const totalOrigenNum = Number(totalOrigen);
      if (!totalOrigenNum || totalOrigenNum <= 0) return toast.error('Debe indicar el total del comprobante original');
      if (totales.total > totalOrigenNum + 0.01) {
        return toast.error(`El total a acreditar (${fmt(totales.total)}) no puede superar el del comprobante original (${fmt(totalOrigenNum)})`);
      }
    }

    setLoading(true);
    try {
      await api.put(`/contabilidad/cfe/documentos/${docId}`, {
        // DocTipo vacío: el backend conserva el tipo propio de la nota. Mandarlo la convertiría
        // en otro documento (y de hecho el candado del backend lo rechaza para NC/ND).
        DocTipo: '',
        CliIdCliente: cliente.CliIdCliente,
        MonIdMoneda: monedaId,
        DocSubtotal: totales.subtotal,
        DocImpuestos: totales.iva,
        DocTotal: totales.total,
        DocObservaciones: motivo.trim(),
        DocCliNombre: cliente.Nombre || cliente.NombreFantasia || '',
        DocCliDocumento: cliente.CioRuc || '',
        DocMotivoRef: motivo.trim(),
        empresaId: empresaSeleccionada?.EmpIdEmpresa ?? null,
        // DocPagado se devuelve TAL CUAL vino. Mandarlo en false hace que el backend lo lea
        // como "devolver a pendientes un documento cobrado", frene con FACTURA_YA_COBRADA y,
        // si se confirmara, le regenere la deuda al cliente. Editar una nota no cambia su
        // condición de pago: acá solo se corrigen datos del comprobante.
        DocPagado: doc?.DocPagado === true || doc?.DocPagado === 1,
        preservarPagos: true,
        ...(origenEditable ? {
          referenciaExterna: {
            tipo: tipoOrigen,
            serie: serieOrigen.trim(),
            numero: numeroOrigen.trim(),
            fecha: fechaOrigen,
            total: Number(totalOrigen),
            monedaId,
          }
        } : {}),
        lineas: lineasValidas.map(l => {
          const qty = parseFloat(l.cantidad) || 1;
          const price = parseFloat(l.precioUnitario) || 0;
          const ivaRate = parseFloat(l.iva) || 0;
          const lineTotal = qty * price;
          const lineNeto = lineTotal / (1 + ivaRate / 100);
          // Los nombres son los que espera editarFactura al reinsertar el detalle.
          // Convención de la tabla: DcdPrecioUnitario y DcdTotal van CON IVA,
          // DcdSubtotal es el neto — igual que lo que guarda el alta de la NC.
          return {
            DcdNomItem: (l.concepto || '').trim(),
            DcdDscItem: (l.DcdDscItem || '').trim(),
            DcdCantidad: qty,
            DcdPrecioUnitario: price,
            DcdSubtotal: parseFloat(lineNeto.toFixed(2)),
            DcdImpuestos: parseFloat((lineTotal - lineNeto).toFixed(2)),
            DcdTotal: parseFloat(lineTotal.toFixed(2)),
          };
        }),
      });
      toast.success('Nota actualizada — revisá la vista previa DGI antes de enviarla');
      onSuccess?.();
    } catch (error) {
      toast.error('Error al guardar la nota: ' + (error.response?.data?.error || error.message));
    } finally {
      setLoading(false);
    }
  };

  const currencySymbol = monedaId === 2 ? 'U$S' : '$';
  const rotuloNota = getTipoDocName(doc?.DocTipo, 'Nota');

  if (cargando) {
    return (
      <div className="fixed inset-0 z-[9999] bg-slate-900/50 flex items-center justify-center">
        <div className="bg-white rounded-2xl px-6 py-5 flex items-center gap-3 text-zinc-600 font-bold text-sm shadow-xl">
          <Loader2 className="animate-spin" size={18} /> Cargando la nota…
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/50 flex flex-col w-screen h-screen overflow-hidden animate-in fade-in select-none">
      <div className="bg-white border-b border-zinc-200 px-6 py-3.5 flex items-center justify-between shadow-sm shrink-0">
        <div className="flex items-center gap-3">
          <div className="bg-red-600 shadow-red-600/10 p-2 rounded-xl text-white shadow-md">
            <FileText size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-zinc-800 tracking-tight leading-none">
              Editando {rotuloNota} {doc?.DocSerie}-{doc?.DocNumero}
            </h2>
            <p className="text-xs font-semibold text-zinc-400 mt-1">
              Se modifica la nota existente, que todavía no fue enviada a DGI. No se crea una nueva ni se emite nada.
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
            <p className="text-[9px] font-semibold text-zinc-400">
              Viaja a DGI dentro de la referencia. Se recorta a 90 caracteres.
            </p>
          </div>
        </div>

        {/* Comprobante original que corrige la nota */}
        <div className="bg-white border border-amber-200 rounded-2xl p-4 shadow-sm shrink-0">
          <h3 className="text-xs font-bold uppercase text-amber-700 tracking-wider mb-3 flex items-center gap-1.5">
            <Link2 size={13} /> Comprobante que corrige esta nota
          </h3>

          {!refOrigen && (
            <p className="text-[11px] font-bold text-red-700 mb-2">
              Esta nota no tiene comprobante de referencia. DGI la exige para toda NC/ND: así no se puede emitir.
            </p>
          )}

          {refOrigen?.origen === 'PROPIO' && (
            <p className="text-[10px] font-semibold text-emerald-700 mb-3">
              Emitido por este sistema ({refOrigen.CfeNumeroOficial}). Los datos salen del CFE real, por eso no se editan.
            </p>
          )}
          {refOrigen?.origen === 'SIN_EMITIR' && (
            <p className="text-[10px] font-bold text-red-700 mb-3 leading-snug">
              Este documento nunca se envió a DGI, así que DGI no lo conoce y va a rechazar la nota.
            </p>
          )}
          {origenEditable && (
            <p className="text-[10px] text-zinc-400 font-semibold mb-3">
              Deben coincidir EXACTAMENTE con lo que DGI tiene registrado para ese comprobante (tipo, serie, número y fecha),
              o lo rechaza con "No se encontró el CFE referenciado".
            </p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Tipo</label>
              <select
                value={tipoOrigen}
                disabled={!origenEditable}
                onChange={e => setTipoOrigen(e.target.value)}
                className="border border-zinc-200 focus:border-red-500 rounded-xl px-2 py-1.5 text-xs font-bold text-zinc-700 outline-none disabled:bg-zinc-100 disabled:text-zinc-500"
              >
                <option value="TICKET">E-Ticket</option>
                <option value="FACTURA">E-Factura</option>
              </select>
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Serie</label>
              <input type="text" value={serieOrigen} disabled={!origenEditable} onChange={e => setSerieOrigen(e.target.value)}
                className="border border-zinc-200 focus:border-red-500 rounded-xl px-2 py-1.5 text-xs font-bold text-zinc-700 outline-none disabled:bg-zinc-100 disabled:text-zinc-500" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Número</label>
              <input type="text" value={numeroOrigen} disabled={!origenEditable} onChange={e => setNumeroOrigen(e.target.value)}
                className="border border-zinc-200 focus:border-red-500 rounded-xl px-2 py-1.5 text-xs font-bold text-zinc-700 outline-none disabled:bg-zinc-100 disabled:text-zinc-500" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Fecha Emisión</label>
              <input type="date" value={fechaOrigen} disabled={!origenEditable} onChange={e => setFechaOrigen(e.target.value)}
                className="border border-zinc-200 focus:border-red-500 rounded-xl px-2 py-1.5 text-xs font-bold text-zinc-700 outline-none disabled:bg-zinc-100 disabled:text-zinc-500" />
            </div>
            <div className="flex flex-col">
              <label className="text-[10px] font-bold text-zinc-400 uppercase mb-1">Total Original</label>
              <div className="flex items-center gap-1">
                <select value={monedaId} disabled={!origenEditable} onChange={e => setMonedaId(Number(e.target.value))}
                  className="border border-zinc-200 focus:border-red-500 rounded-xl px-1.5 py-1.5 text-xs font-bold text-zinc-700 outline-none disabled:bg-zinc-100 disabled:text-zinc-500">
                  <option value={1}>$</option>
                  <option value={2}>U$S</option>
                </select>
                <input type="number" min="0" step="0.01" value={totalOrigen} disabled={!origenEditable} onChange={e => setTotalOrigen(e.target.value)}
                  className="w-full border border-zinc-200 focus:border-red-500 rounded-xl px-2 py-1.5 text-xs font-bold text-zinc-700 outline-none disabled:bg-zinc-100 disabled:text-zinc-500" />
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
                Guardar solo actualiza la nota. Para emitirla usá "Enviar a DGI" en la Bandeja CFE.
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
            {loading ? (<><Loader2 size={16} className="animate-spin" /> Guardando...</>) : (<><Save size={16} /> Guardar Cambios de la Nota</>)}
          </button>
        </div>
      </form>
    </div>
  );
}
