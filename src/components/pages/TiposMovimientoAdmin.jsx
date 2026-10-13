// SIN USO (13/10): nunca tuvo ruta. Es la única UI para editar TiposMovimiento. Ver docs/auditoria-limpieza-2026-10-09.md.
import React, { useEffect, useState, useCallback } from 'react';
import { Settings, RefreshCw, Save, CheckCircle, XCircle, Info, Trash2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

import api from '../../services/api';

const fetchAPI = async (url, opts = {}) => {
  try {
    const cleanUrl = url.startsWith('/api') ? url.replace('/api', '') : url;
    const config = {
      method: opts.method || 'GET',
      url: cleanUrl,
      data: opts.body,
      headers: opts.headers || {},
    };
    if (opts.body) {
       config.headers['Content-Type'] = 'application/json';
    }
    const res = await api.request(config);
    return res.data;
  } catch (error) {
    if (error.response?.data) throw new Error(error.response.data.error || 'Error de red');
    throw error;
  }
};

const EfectoBadge = ({ value, onChange }) => {
  const opts = [
    { v:  1, label: '+1 Suma',   cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20' },
    { v:  0, label: '0 Neutro',  cls: 'bg-slate-800 text-slate-400 border-slate-700 hover:bg-slate-700'  },
    { v: -1, label: '-1 Resta',  cls: 'bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20' },
  ];
  return (
    <div className="flex gap-1 justify-center">
      {opts.map(o => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          type="button"
          className={`px-2 py-1 text-[11px] uppercase font-bold rounded border transition-all whitespace-nowrap ${
            value === o.v
              ? o.cls + ' ring-1 ring-offset-0 ring-indigo-400'
              : 'bg-slate-900 border-slate-800 text-slate-600 hover:border-slate-500 hover:text-slate-400'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
};

const Toggle = ({ value, onChange }) => (
  <button
    onClick={() => onChange(!value)}
    type="button"
    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 ${
      value ? 'bg-indigo-600' : 'bg-slate-800 shadow-inner'
    }`}
  >
    <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
      value ? 'translate-x-5' : 'translate-x-1'
    }`} />
  </button>
);

const TiposMovimientoAdmin = () => {
  const [tipos, setTipos]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState({});
  const [edits, setEdits]       = useState({});
  
  const [modalOpen, setModalOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [form, setForm] = useState({
      TmoId: '', TmoNombre: '', TmoDescripcion: '', TmoPrefijo: '',
      TmoAfectaSaldo: 0, TmoGeneraDeuda: false, TmoAplicaRecurso: false, TmoRequiereDoc: false, TmoActivo: true, TmoOrden: 100
  });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchAPI('/api/contabilidad/tipos-movimiento');
      setTipos(res.data || []);
      setEdits({});
    } catch (e) { toast.error('Error cargando tipos: ' + e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const handleCrear = async (e) => {
      e.preventDefault();
      setIsCreating(true);
      try {
          await fetchAPI('/api/contabilidad/tipos-movimiento', {
              method: 'POST',
              body: JSON.stringify(form)
          });
          toast.success("Tipo de movimiento creado con éxito.");
          setModalOpen(false);
          await cargar();
      } catch (err) {
          toast.error(err.message);
      } finally {
          setIsCreating(false);
      }
  };

  const handleEliminar = async (TmoId) => {
      if(!window.confirm(`¿Estás completamente seguro de ELIMINAR el tipo de movimiento: ${TmoId}? Esta acción es irreversible.`)) return;
      try {
          await fetchAPI(`/api/contabilidad/tipos-movimiento/${TmoId}`, { method: 'DELETE' });
          toast.success("Tipo de movimiento eliminado.");
          await cargar();
      } catch (err) {
          toast.error(err.message);
      }
  }

  const setField = (TmoId, campo, valor) => {
    setEdits(prev => ({
      ...prev,
      [TmoId]: { ...(prev[TmoId] || {}), [campo]: valor },
    }));
  };

  const guardar = async (tipo) => {
    const cambios = edits[tipo.TmoId];
    if (!cambios || Object.keys(cambios).length === 0) {
      toast('Sin cambios para guardar.', { icon: 'ℹ️' });
      return;
    }
    setSaving(s => ({ ...s, [tipo.TmoId]: true }));
    try {
      await fetchAPI(`/api/contabilidad/tipos-movimiento/${tipo.TmoId}`, {
        method: 'PATCH',
        body: JSON.stringify(cambios),
      });
      toast.success(`'${tipo.TmoId}' actualizado.`);
      await cargar();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(s => ({ ...s, [tipo.TmoId]: false })); }
  };

  const val = (tipo, campo) => edits[tipo.TmoId]?.[campo] !== undefined ? edits[tipo.TmoId][campo] : tipo[campo];
  const sucioPor = (tipo) => edits[tipo.TmoId] && Object.keys(edits[tipo.TmoId]).length > 0;

  // Clasificamos usando "TmoRequiereDoc" para saber si es un documento formal, y hacemos fallback al array de IDs viejo por retrocompatibilidad
  const isDocumento = (t) => t.TmoRequiereDoc || ['FACTURA','FACTURA_CICLO','RECIBO','TICKET'].includes(t.TmoId);
  const internos   = tipos.filter(t => !isDocumento(t));
  const documentos = tipos.filter(t =>  isDocumento(t));

  const openModalFor = (isDoc) => {
      setForm({
          TmoId: '', TmoNombre: '', TmoDescripcion: '', TmoPrefijo: isDoc ? 'FC' : '',
          TmoAfectaSaldo: 0, TmoGeneraDeuda: false, TmoAplicaRecurso: false, TmoRequiereDoc: isDoc, TmoActivo: true, TmoOrden: isDoc ? 250 : 100
      });
      setModalOpen(true);
  }

  const TipoRow = ({ tipo }) => {
    const sucio    = sucioPor(tipo);
    const guardando = saving[tipo.TmoId];
    return (
      <tr className={`border-b border-slate-800 text-sm transition-colors ${sucio ? 'bg-indigo-900/10' : 'hover:bg-slate-800/50'}`}>
        <td className="px-4 py-4 font-mono text-xs font-bold text-slate-500 whitespace-nowrap min-w-[120px]">
          {tipo.TmoId}
        </td>
        <td className="px-4 py-4 min-w-[200px]">
          <input value={val(tipo, 'TmoNombre')} onChange={e => setField(tipo.TmoId, 'TmoNombre', e.target.value)} className="w-full px-3 py-2 border border-slate-700 bg-slate-900 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
        </td>
        <td className="px-4 py-4 min-w-[260px] hidden lg:table-cell">
          <textarea rows={1} value={val(tipo, 'TmoDescripcion') || ''} onChange={e => setField(tipo.TmoId, 'TmoDescripcion', e.target.value)} className="w-full px-3 py-2 border border-slate-700 bg-slate-800/50 rounded-lg text-xs text-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-slate-800 resize-y min-h-[38px]" placeholder="Descripción extendida..." />
        </td>
        <td className="px-4 py-4 text-center">
          <input value={val(tipo, 'TmoPrefijo') || ''} onChange={e => setField(tipo.TmoId, 'TmoPrefijo', e.target.value.toUpperCase().slice(0,5))} className="w-16 px-2 py-2 border border-slate-700 bg-slate-900 rounded-lg text-xs text-center font-mono font-bold text-emerald-400 focus:outline-none focus:border-indigo-500 uppercase mx-auto block" placeholder="FC" />
        </td>
        <td className="px-4 py-4">
          <EfectoBadge value={val(tipo, 'TmoAfectaSaldo')} onChange={v => setField(tipo.TmoId, 'TmoAfectaSaldo', v)} />
        </td>
        <td className="px-4 py-4 text-center align-middle">
          <Toggle value={!!val(tipo, 'TmoGeneraDeuda')} onChange={v => setField(tipo.TmoId, 'TmoGeneraDeuda', v)} />
        </td>
        <td className="px-4 py-4 text-center align-middle">
          <Toggle value={!!val(tipo, 'TmoAplicaRecurso')} onChange={v => setField(tipo.TmoId, 'TmoAplicaRecurso', v)} />
        </td>
        <td className="px-4 py-4 text-center align-middle">
          <Toggle value={!!val(tipo, 'TmoActivo')} onChange={v => setField(tipo.TmoId, 'TmoActivo', v)} />
        </td>
        <td className="px-4 py-4 text-center">
          <input type="number" value={val(tipo, 'TmoOrden')} onChange={e => setField(tipo.TmoId, 'TmoOrden', parseInt(e.target.value))} className="w-16 px-2 py-2 border border-slate-700 bg-slate-900 text-slate-300 rounded-lg text-xs text-center mx-auto block focus:outline-none focus:border-indigo-500" />
        </td>
        <td className="px-4 py-4 text-center flex items-center justify-center gap-3">
          {sucio ? (
            <button onClick={() => guardar(tipo)} disabled={guardando} className="flex-1 py-2 px-3 bg-indigo-600/20 text-indigo-400 hover:text-indigo-300 border border-indigo-600/50 hover:bg-indigo-600/40 text-xs font-black uppercase rounded shadow-lg disabled:opacity-50 transition-colors">
              {guardando ? <RefreshCw size={14} className="animate-spin inline mr-1" /> : <Save size={14} className="inline mr-1" />}
              Guardar
            </button>
          ) : (
            <>
                <span className="text-slate-600 flex-1 py-2 text-xs font-bold">—</span>
                <button onClick={() => handleEliminar(tipo.TmoId)} className="p-2 text-slate-500 hover:text-rose-500 bg-slate-800 hover:bg-slate-800 rounded-lg transition-colors border border-transparent hover:border-rose-500/30" title="Eliminar"><Trash2 size={16}/></button>
            </>
          )}
        </td>
      </tr>
    );
  };

  const Tabla = ({ titulo, items, color, isDoc }) => (
    <div className="mb-12">
      <div className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4`}>
        <div className="flex items-center gap-3">
            <span className={`w-3 h-8 rounded-full ${color}`} />
            <h2 className="text-xl font-black text-white">{titulo}</h2>
            <span className="text-xs font-bold text-slate-500 uppercase bg-slate-800 px-3 py-1.5 rounded-full shadow-sm">{items.length} TIPOS</span>
        </div>
        <button
            onClick={() => openModalFor(isDoc)}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl font-bold transition-all shadow-lg text-slate-300 w-fit"
        >
            <Plus size={16} /> 
            {isDoc ? 'Nuevo Documento' : 'Nuevo Movimiento'}
        </button>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-x-auto custom-scrollbar">
        <table className="w-full text-left text-sm whitespace-nowrap min-w-[1200px]">
          <thead className="bg-slate-800 text-slate-300 font-bold uppercase text-[10px] tracking-wider sticky top-0 z-10">
            <tr>
              <th className="px-4 py-4 border-b border-slate-700">ID Único</th>
              <th className="px-4 py-4 border-b border-slate-700">Nombre Visible</th>
              <th className="px-4 py-4 border-b border-slate-700 hidden lg:table-cell">Descripción y Uso</th>
              <th className="px-4 py-4 border-b border-slate-700 text-center">Prefijo</th>
              <th className="px-4 py-4 border-b border-slate-700 text-center">Efecto en Saldo</th>
              <th className="px-4 py-4 border-b border-slate-700 text-center" title="Genera DeudaDocumento">Afecta Deuda</th>
              <th className="px-4 py-4 border-b border-slate-700 text-center" title="Afecta inventario de recursos">Afecta Recursos</th>
              <th className="px-4 py-4 border-b border-slate-700 text-center">Habilitado</th>
              <th className="px-4 py-4 border-b border-slate-700 text-center">Orden</th>
              <th className="px-4 py-4 border-b border-slate-700 text-center">Acciones y Guardado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/50">
            {items.map(t => <TipoRow key={t.TmoId} tipo={t} />)}
            {items.length === 0 && (
                <tr><td colSpan="10" className="p-12 text-center text-slate-500 text-lg">No hay registros clasificados aquí. <button onClick={()=>openModalFor(isDoc)} className="text-indigo-400 font-bold hover:underline">¡Crea el primero!</button></td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="h-full bg-[#0f1117] p-4 sm:p-8 overflow-y-auto text-slate-200 font-sans custom-scrollbar">
      <div className="max-w-[1400px] mx-auto flex flex-col gap-6">

        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 mb-2">
            <div>
              <h1 className="text-3xl sm:text-4xl font-black text-white flex items-center gap-3">
                <Settings className="text-indigo-400" size={36} /> ABM de Tipos de Movimiento
              </h1>
              <p className="text-slate-400 text-sm mt-2 max-w-2xl">
                Sistema centralizado para definir la naturaleza contable y logística de las transacciones. Modifica anchos de impacto, deudas recíprocas y controles de recursos de forma atómica.
              </p>
            </div>
          <div className="flex gap-3">
            <button
                onClick={cargar}
                disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 text-sm bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl font-bold transition-all shadow-lg text-slate-300"
            >
                <RefreshCw size={18} className={loading ? 'animate-spin text-indigo-400' : 'text-indigo-400'} />
                Forzar Recarga
            </button>
          </div>
        </div>

        {/* Leyenda Expandible Interactiva (A pedido del usuario) */}
        <div className="bg-indigo-900/10 border border-indigo-800/30 rounded-2xl p-6 flex gap-4 items-start shadow-sm mt-2">
          <Info size={24} className="text-indigo-400 mt-1 shrink-0" />
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 w-full text-sm">
            <div>
                <strong className="text-indigo-200 block mb-1 uppercase tracking-wider text-xs">Afectación de Saldos</strong>
                <span className="text-indigo-300/80 leading-relaxed"><span className="text-emerald-400 font-bold">+1 Suma</span> (aumenta fondo o abona crédito), <span className="text-rose-400 font-bold">-1 Resta</span> (debita cuenta or gasta), o <span className="text-slate-400 font-bold">0 Neutro</span> (solo deja huella en logs sin alterar caja).</span>
            </div>
            <div>
                <strong className="text-indigo-200 block mb-1 uppercase tracking-wider text-xs">Vínculo con Deudas</strong>
                <span className="text-indigo-300/80 leading-relaxed">Si activas <b>Deuda</b>, este tipo de movimiento exigirá crear (o saldar) un comprobante formal de obligación en la vista "Estado de Cuenta".</span>
            </div>
            <div>
                 <strong className="text-indigo-200 block mb-1 uppercase tracking-wider text-xs">Gestión de Recursos</strong>
                <span className="text-indigo-300/80 leading-relaxed">Si activas <b>Recursos</b>, el ERP interceptará este movimiento para descontar y auditar "Planes de Metros/DTF" en paralelo al dinero.</span>
            </div>
            <div>
                 <strong className="text-indigo-200 block mb-1 uppercase tracking-wider text-xs">Clasificación Automática</strong>
                <span className="text-indigo-300/80 leading-relaxed">El ERP clasifica entre <b>Movimiento Interno</b> y <b>Documento Contable</b> usando la propiedad subyacente de "Requiere Formalidad Fiscal".</span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-32">
            <div className="animate-spin h-12 w-12 rounded-full border-4 border-indigo-500 border-t-transparent shadow-lg" />
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-10">
            <Tabla
              titulo="Movimientos Internos de Caja y Submayores"
              items={internos}
              color="bg-indigo-500"
              isDoc={false}
            />
            <Tabla
              titulo="Documentos Formales (Exigen Correlativo)"
              items={documentos}
              color="bg-amber-500"
              isDoc={true}
            />
          </div>
        )}
      </div>

      {modalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70  p-4">
            <div className="bg-[#0f1117] border border-slate-700 rounded-3xl w-full max-w-2xl shadow-2xl flex flex-col overflow-hidden">
              <div className="flex justify-between items-center px-8 py-6 border-b border-slate-800/80 bg-slate-900/50">
                <div>
                   <h2 className="text-2xl font-black text-white flex items-center gap-3">
                       <Plus size={28} className="text-indigo-400"/> 
                       {form.TmoRequiereDoc ? 'Nuevo Documento' : 'Nuevo Movimiento'}
                   </h2>
                   <p className="text-xs text-slate-400 mt-1 uppercase tracking-wider indent-10">Creación de Nomenclador Contable</p>
                </div>
                <button onClick={() => setModalOpen(false)} className="text-slate-500 hover:text-white bg-slate-800 hover:bg-slate-700 p-2 rounded-full transition-colors"><X size={20}/></button>
              </div>
              <form onSubmit={handleCrear} className="p-8 flex flex-col gap-6 overflow-y-auto max-h-[80vh] custom-scrollbar">
                
                <div className="grid grid-cols-5 gap-6">
                  <div className="col-span-2">
                    <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">ID (Clave Única)</label>
                    <input autoFocus required type="text" value={form.TmoId} onChange={e=>setForm({...form, TmoId: e.target.value.toUpperCase().replace(/\s/g,'_')})} placeholder="Ej: VENTA_USD" className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-emerald-400 font-mono text-base outline-none focus:border-indigo-500 uppercase shadow-inner" />
                  </div>
                  <div className="col-span-3">
                    <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">Nombre Visible</label>
                    <input required type="text" value={form.TmoNombre} onChange={e=>setForm({...form, TmoNombre: e.target.value})} placeholder="Para mostrar en la UI..." className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-white text-base outline-none focus:border-indigo-500 shadow-inner" />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">Descripción Detallada (Guía para el usuario)</label>
                  <textarea rows={2} value={form.TmoDescripcion} onChange={e=>setForm({...form, TmoDescripcion: e.target.value})} placeholder="¿Cuándo se usa este movimiento y qué hace?..." className="w-full bg-slate-800/80 border border-slate-700 rounded-xl px-4 py-3 text-slate-300 outline-none focus:border-indigo-500 resize-none shadow-inner" />
                </div>

                <div className="grid grid-cols-2 gap-6 mt-2">
                  <div className="p-5 bg-slate-900/80 border border-slate-800 rounded-2xl flex flex-col gap-5">
                    <h3 className="text-sm font-black text-white border-b border-slate-800 pb-2">Comportamiento Inicial</h3>
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-400 uppercase">Prefijo Comprobante</span>
                        <input type="text" value={form.TmoPrefijo} onChange={e=>setForm({...form, TmoPrefijo: e.target.value})} className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-emerald-400 font-mono uppercase text-center focus:outline-none" />
                    </div>
                     <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-400 uppercase">Orden Visual</span>
                        <input type="number" value={form.TmoOrden} onChange={e=>setForm({...form, TmoOrden: parseInt(e.target.value)})} className="w-20 bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-slate-300 text-center focus:outline-none focus:border-indigo-500" />
                    </div>
                  </div>

                  <div className="p-5 bg-indigo-900/10 border border-indigo-900/30 rounded-2xl flex flex-col gap-4 relative overflow-hidden">
                    <div className="absolute -right-4 -top-4 w-20 h-20 bg-indigo-500/10 rounded-full blur-xl"></div>
                    <h3 className="text-sm font-black text-indigo-200 border-b border-indigo-900/50 pb-2">Naturaleza Contable</h3>
                    <div className="flex flex-col gap-2">
                        <span className="text-xs font-bold text-slate-400 uppercase">Afectación de Saldos (Efecto)</span>
                        <div className="mt-1"><EfectoBadge value={form.TmoAfectaSaldo} onChange={v => setForm({...form, TmoAfectaSaldo: v})} /></div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-4 justify-between bg-slate-800/40 p-5 rounded-2xl border border-slate-700 mt-2">
                  <div className="flex flex-col items-center gap-3">
                      <span className="text-xs font-bold text-slate-400">Genera Deuda</span>
                      <Toggle value={form.TmoGeneraDeuda} onChange={v=>setForm({...form, TmoGeneraDeuda: v})} />
                  </div>
                  <div className="flex flex-col items-center gap-3">
                      <span className="text-xs font-bold text-slate-400">Afecta Recursos</span>
                      <Toggle value={form.TmoAplicaRecurso} onChange={v=>setForm({...form, TmoAplicaRecurso: v})} />
                  </div>
                  <div className="flex flex-col items-center gap-3">
                      <span className="text-xs font-bold text-indigo-400">Es Documento Formal</span>
                      <Toggle value={form.TmoRequiereDoc} onChange={v=>setForm({...form, TmoRequiereDoc: v})} />
                  </div>
                  <div className="flex flex-col items-center gap-3">
                      <span className="text-xs font-bold text-amber-500">Tipo Activo/Visible</span>
                      <Toggle value={form.TmoActivo} onChange={v=>setForm({...form, TmoActivo: v})} />
                  </div>
                </div>

                <div className="flex justify-end gap-4 mt-6 border-t border-slate-800 pt-6">
                  <button type="button" disabled={isCreating} onClick={() => setModalOpen(false)} className="px-6 py-3 rounded-xl font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors">Cancelar Misión</button>
                  <button type="submit" disabled={isCreating} className="bg-indigo-600 hover:bg-indigo-500 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-xl shadow-indigo-600/20 disabled:opacity-50 flex items-center gap-2 text-lg">
                    {isCreating ? <RefreshCw size={22} className="animate-spin"/> : <Save size={22}/>} Registrar en ERP
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

    </div>
  );
};

export default TiposMovimientoAdmin;
