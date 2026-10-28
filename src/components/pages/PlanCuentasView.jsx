import React, { useState, useEffect } from 'react';
import api from '../../services/apiClient';
import { Network, FolderTree, FileText, CheckCircle, Plus, X, Edit, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import Selector from '../ui/Selector';

// Estética nueva (28/10/2026): encabezado con ícono brand-cyan sin fondo, árbol en una tarjeta blanca (en el celular,
// una lista con la sangría del nivel en vez de la tabla de 6 columnas), índigo → brand-cyan, la moneda como «$» /
// «US$» / «Ambas», selects con el Selector propio y la ventana en z-[6000].
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full bg-white border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
const TH = 'px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'inline-flex items-center text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide whitespace-nowrap';

// Naturaleza de la cuenta: activo verde, pasivo magenta, ganancia brand-cyan (antes índigo), pérdida ámbar
const COLOR_TIPO = {
  ACTIVO: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  PASIVO: 'bg-brand-magenta/10 border-brand-magenta/20 text-brand-magenta',
  GANANCIA: 'bg-brand-cyan/10 border-brand-cyan/20 text-brand-cyan',
  PERDIDA: 'bg-amber-50 border-amber-200 text-amber-700',
};
// En pantalla, «$» y «US$» (la base guarda UYU / USD / AMBAS)
const MONEDA = { UYU: '$', USD: 'US$', AMBAS: 'Ambas' };

// Tabla en pantallas anchas; en el celular, lista. Se dibuja una sola de las dos vistas.
const MQ_TABLA = '(min-width: 768px)';
function useConTabla() {
  const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
  useEffect(() => {
    const mq = window.matchMedia(MQ_TABLA);
    const cambio = () => setConTabla(mq.matches);
    mq.addEventListener('change', cambio);
    return () => mq.removeEventListener('change', cambio);
  }, []);
  return conTabla;
}

export default function PlanCuentasView() {
  const [cuentas, setCuentas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const conTabla = useConTabla();

  const [form, setForm] = useState({
    codigo: '', nombre: '', nivel: 1, tipoBase: 'ACTIVO', moneda: 'AMBAS', imputable: false, activa: true
  });

  const fetchData = () => {
    setLoading(true);
    api.get('/contabilidad/erp/cuentas').then(res => {
      if (res.data.success) setCuentas(res.data.data);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(() => { fetchData(); }, []);

  const openForm = (cuenta = null) => {
    if (cuenta) {
      setEditingId(cuenta.CueId);
      setForm({
        codigo: cuenta.CueCodigo,
        nombre: cuenta.CueNombre,
        nivel: cuenta.CueNivel,
        tipoBase: cuenta.CueTipoBase,
        moneda: cuenta.CueMoneda,
        imputable: cuenta.CueImputable,
        activa: cuenta.CueActiva
      });
    } else {
      setEditingId(null);
      setForm({ codigo: '', nombre: '', nivel: 1, tipoBase: 'ACTIVO', moneda: 'AMBAS', imputable: false, activa: true });
    }
    setModalOpen(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    try {
      if (editingId) {
        await api.put(`/contabilidad/erp/cuentas/${editingId}`, form);
        toast.success("Cuenta actualizada con éxito");
      } else {
        await api.post('/contabilidad/erp/cuentas', form);
        toast.success("Cuenta agregada con éxito");
      }
      setModalOpen(false);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || "Error al guardar");
    }
  };

  // Piezas de cada cuenta, para la tabla y para la lista del celular
  const nombreCuenta = (c) => {
    const isParent = !c.CueImputable;
    return (
      <span className="inline-flex items-center gap-2.5 min-w-0">
        {isParent ? <FolderTree size={17} className="text-brand-cyan shrink-0" /> : <FileText size={17} className="text-zinc-300 shrink-0" />}
        <span className={`${isParent ? 'font-black text-zinc-900' : 'font-semibold text-zinc-700'} text-sm truncate`}>{c.CueNombre}</span>
        {!c.CueActiva && <span className={`${CHIP} bg-zinc-100 border-zinc-200 text-zinc-500`}>Inactiva</span>}
      </span>
    );
  };
  const chipTipo = (c) => (
    <span className={`${CHIP} ${COLOR_TIPO[c.CueTipoBase] || 'bg-zinc-50 border-zinc-200 text-zinc-600'}`}>{c.CueTipoBase}</span>
  );
  const moneda = (c) => <span className="text-xs font-bold text-zinc-500">{MONEDA[c.CueMoneda] ?? c.CueMoneda}</span>;
  const botonEditar = (c) => (
    <button onClick={() => openForm(c)} title="Editar la cuenta" aria-label="Editar la cuenta"
      className="p-2 rounded-lg border border-zinc-200 bg-white text-zinc-400 hover:text-brand-cyan hover:border-brand-cyan/30 hover:bg-brand-cyan/5 transition-colors"><Edit size={15}/></button>
  );

  return (
    <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Network size={30} className="text-brand-cyan shrink-0" />
          <div className="min-w-[220px] flex-1">
            <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Plan de Cuentas Bimonetario</h1>
            <p className="text-sm text-zinc-500 mt-1">Estructura jerárquica del motor ERP.</p>
          </div>
          <button
            onClick={() => openForm()}
            className={`${BTN_PRINCIPAL} w-full sm:w-auto sm:ml-auto`}
          >
            <Plus size={16} /> Nueva cuenta
          </button>
        </div>

        {loading ? (
          <div className={`${CARD} flex flex-col items-center justify-center gap-3 py-16`}>
            <Loader2 className="animate-spin text-brand-cyan" size={30}/>
            <span className="text-sm text-zinc-400">Cargando la estructura...</span>
          </div>
        ) : (
          <div className={`${CARD} overflow-hidden`}>
            {cuentas.length > 0 && (conTabla ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-zinc-50 border-b border-zinc-200">
                    <tr>
                      <th className={TH}>Código</th>
                      <th className={`${TH} w-full`}>Nombre de la cuenta</th>
                      <th className={TH}>Tipo base</th>
                      <th className={`${TH} text-center`}>Imputable</th>
                      <th className={TH}>Moneda</th>
                      <th className={`${TH} text-right`}>Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {cuentas.map(c => {
                      const padding = (c.CueNivel - 1) * 24;
                      return (
                        <tr key={c.CueId} className={`hover:bg-zinc-50 transition-colors ${!c.CueActiva ? 'opacity-50' : ''}`}>
                          <td className="px-4 py-2.5 font-mono font-bold text-zinc-400 text-xs">{c.CueCodigo}</td>
                          <td className="px-4 py-2.5" style={{ paddingLeft: `${padding + 16}px` }}>{nombreCuenta(c)}</td>
                          <td className="px-4 py-2.5">{chipTipo(c)}</td>
                          <td className="px-4 py-2.5 text-center">{c.CueImputable ? <CheckCircle size={17} className="mx-auto text-emerald-500"/> : <span className="text-zinc-300 font-bold">-</span>}</td>
                          <td className="px-4 py-2.5">{moneda(c)}</td>
                          <td className="px-4 py-2.5 text-right">{botonEditar(c)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {cuentas.map(c => (
                  <li key={c.CueId} className={`py-2.5 pr-3 flex items-center gap-2 ${!c.CueActiva ? 'opacity-50' : ''}`}
                    style={{ paddingLeft: `${(c.CueNivel - 1) * 14 + 12}px` }}>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0">{nombreCuenta(c)}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap pl-[27px]">
                        <span className="font-mono text-[11px] font-bold text-zinc-400">{c.CueCodigo}</span>
                        {chipTipo(c)}
                        {moneda(c)}
                        {c.CueImputable && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700"><CheckCircle size={12}/> Imputable</span>}
                      </div>
                    </div>
                    {botonEditar(c)}
                  </li>
                ))}
              </ul>
            ))}

            {cuentas.length === 0 && (
                <div className="p-14 text-center flex flex-col items-center gap-2">
                    <Network size={40} className="text-brand-cyan" />
                    <p className="text-sm font-bold text-zinc-700">No hay cuentas contables registradas.</p>
                </div>
            )}
          </div>
        )}

        {/* MODAL MANTENIMIENTO CUENTAS */}
        {modalOpen && (
          <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/40 p-3 sm:p-4">
            <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-xl max-h-[92vh] shadow-xl flex flex-col overflow-hidden">
              <div className="flex justify-between items-center gap-3 px-5 sm:px-6 py-4 border-b border-zinc-100">
                <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2.5">
                  <Network size={22} className="text-brand-cyan shrink-0" />
                  {editingId ? 'Editar cuenta' : 'Nueva cuenta contable'}
                </h2>
                <button onClick={() => setModalOpen(false)} title="Cerrar" aria-label="Cerrar" className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"><X size={20}/></button>
              </div>
              <form onSubmit={handleSave} className="p-5 sm:p-6 flex flex-col gap-4 overflow-y-auto">

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className={ETIQUETA}>Código contable</label>
                    <input autoFocus required type="text" value={form.codigo} onChange={e=>setForm({...form, codigo: e.target.value})} placeholder="Ej: 1.1.1" className={`${CAMPO} font-mono`} />
                  </div>
                  <div>
                    <label className={ETIQUETA}>Nivel en el árbol</label>
                    <input required type="number" min="1" value={form.nivel} onChange={e=>setForm({...form, nivel: Number(e.target.value)})} className={CAMPO} />
                  </div>
                </div>

                <div>
                  <label className={ETIQUETA}>Nombre de la cuenta</label>
                  <input required type="text" value={form.nombre} onChange={e=>setForm({...form, nombre: e.target.value})} placeholder="Ej: Caja Moneda Nacional" className={CAMPO} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <span className={ETIQUETA}>Naturaleza (base)</span>
                    <Selector className="w-full" value={form.tipoBase} aria-label="Naturaleza" onChange={e=>setForm({...form, tipoBase: e.target.value})}>
                      <option value="ACTIVO">ACTIVO</option>
                      <option value="PASIVO">PASIVO</option>
                      <option value="PATRIMONIO">PATRIMONIO NETO</option>
                      <option value="GANANCIA">INGRESOS / GANANCIAS</option>
                      <option value="PERDIDA">EGRESOS / PÉRDIDAS</option>
                    </Selector>
                  </div>
                  <div>
                    <span className={ETIQUETA}>Moneda base</span>
                    <Selector className="w-full" value={form.moneda} aria-label="Moneda base" onChange={e=>setForm({...form, moneda: e.target.value})}>
                      <option value="UYU">Pesos uruguayos ($)</option>
                      <option value="USD">Dólares (US$)</option>
                      <option value="AMBAS">Bimonetaria (ambas)</option>
                    </Selector>
                  </div>
                </div>

                <div className="flex flex-wrap gap-x-8 gap-y-3 bg-zinc-50 py-3.5 px-4 rounded-xl border border-zinc-100">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={form.imputable} onChange={e=>setForm({...form, imputable: e.target.checked})} className="w-4 h-4 accent-[#006E97]" />
                    <span className="text-sm font-bold text-zinc-700">Cuenta imputable</span>
                  </label>

                  {editingId && (
                    <label className="flex items-center gap-2.5 cursor-pointer">
                        <input type="checkbox" checked={form.activa} onChange={e=>setForm({...form, activa: e.target.checked})} className="w-4 h-4 accent-[#006E97]" />
                        <span className="text-sm font-bold text-zinc-700">Activa</span>
                    </label>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={() => setModalOpen(false)} className={BTN_SECUNDARIO}>Cancelar</button>
                  <button type="submit" className={BTN_PRINCIPAL}>Guardar cuenta</button>
                </div>
              </form>
            </div>
          </div>
        )}
    </div>
  );
}
