import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';
import { PlusCircle, Save, X, Edit, Trash2, BookOpen, Info, Loader2 } from 'lucide-react';
import Selector from '../ui/Selector';
import useConfirmar from '../ui/useConfirmar';

const fetchAPI = async (url, method = 'GET', body = undefined) => {
  try {
    const cleanUrl = url.startsWith('/api') ? url.replace('/api', '') : url;
    const config = { method, url: cleanUrl };
    if (body !== undefined) { config.data = body; config.headers = { 'Content-Type': 'application/json' }; }
    const res = await api.request(config);
    return res.data;
  } catch (error) {
    if (error.response?.data) throw new Error(error.response.data.error || error.response.data.message || 'Error');
    throw error;
  }
};

const FORMULAS = ['TOTAL', 'NETO', 'IVA', 'DESCUENTO'];

// Estética nueva (28/10/2026): encabezado con ícono brand-cyan sin fondo, tabla clara (en el celular, tarjetas),
// el efecto en saldo con color de estado (resta en magenta, suma en verde), editar y eliminar siempre visibles
// (antes solo al pasar el mouse), confirmación propia en vez de window.confirm, selects con el Selector propio,
// el efecto como pastillas y la ventana en z-[6000].
const EFECTO_LABELS = {
  '-1': { label: 'Resta saldo', color: 'text-brand-magenta bg-brand-magenta/10 border-brand-magenta/20' },
  '0':  { label: 'Neutro',      color: 'text-zinc-500 bg-zinc-50 border-zinc-200' },
  '1':  { label: 'Suma saldo',  color: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
};

const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full bg-white border border-zinc-200 rounded-xl px-3 py-2.5 text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
const TH = 'px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border whitespace-nowrap';
const BTN_ICONO = 'p-2 rounded-lg border border-zinc-200 bg-white text-zinc-400 transition-colors';

// Tabla en pantallas anchas; en el celular, tarjetas. Se dibuja una sola de las dos vistas.
const MQ_TABLA = '(min-width: 1024px)';
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

const EMPTY_FORM = {
  EvtCodigo: '', EvtNombre: '', EvtDescripcion: '', EvtPrefijo: '', EvtSubtipo: '',
  EvtAfectaSaldo: 0, EvtGeneraDeuda: false, EvtAplicaRecurso: false,
  EvtUsaEntidad: false, EvtRequiereDoc: false, EvtActivo: true, EvtOrden: 100,
  lineas: []
};

export default function ContabilidadMotorReglasAdmin() {
  const [eventos, setEventos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [form, setForm] = useState(null);
  const [tab, setTab] = useState('comportamiento'); // 'comportamiento' | 'asiento'
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [confirmar, ventanaConfirmar] = useConfirmar();
  const conTabla = useConTabla();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetchAPI('/api/contabilidad/motor/transacciones');
      setEventos(resp.data || []);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const openForm = async (codigo) => {
    if (!codigo) {
      setForm({ ...EMPTY_FORM });
      setTab('comportamiento');
      setModalVisible(true);
      return;
    }
    try {
      const t = eventos.find(x => x.EvtCodigo === codigo);
      const linRes = await fetchAPI('/api/contabilidad/motor/transacciones/' + codigo + '/reglas');
      setForm({ ...t, lineas: (linRes.data || []).map(r => ({ ...r, CueCodigo: r.CueCodigo, RasNaturaleza: r.RasNaturaleza, RasFormula: r.RasFormula, RasOrden: r.RasOrden })) });
      setTab('comportamiento');
      setModalVisible(true);
    } catch (e) {
      toast.error('Error al cargar: ' + e.message);
    }
  };

  const handleSave = async () => {
    if (!form.EvtCodigo || !form.EvtNombre) return toast.error('Codigo y Nombre son obligatorios');
    try {
      await fetchAPI('/api/contabilidad/motor/transacciones', 'POST', form);
      toast.success('Evento guardado correctamente');
      setModalVisible(false);
      loadData();
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
  };

  const handleDelete = async (codigo) => {
    if (!(await confirmar({ titulo: '¿Eliminar este tipo de evento?', texto: `Se borra el evento ${codigo} y sus reglas de asiento.`, confirmar: 'Eliminar', peligro: true }))) return;
    try {
      await fetchAPI('/api/contabilidad/motor/transacciones/' + codigo, 'DELETE');
      toast.success('Eliminado');
      loadData();
    } catch (e) {
      toast.error('Error: ' + e.message);
    }
  };

  const addLinea = () => setForm(f => ({
    ...f, lineas: [...f.lineas, { CueCodigo: '', RasNaturaleza: 'DEBE', RasFormula: 'TOTAL', RasOrden: (f.lineas.length + 1) * 10 }]
  }));

  const removeLinea = (idx) => setForm(f => { const nl = [...f.lineas]; nl.splice(idx, 1); return { ...f, lineas: nl }; });
  const updateLinea = (idx, campo, valor) => setForm(f => { const nl = [...f.lineas]; nl[idx] = { ...nl[idx], [campo]: valor }; return { ...f, lineas: nl }; });
  const setField = (campo, valor) => setForm(f => ({ ...f, [campo]: valor }));

  const isExisting = form && eventos.some(x => x.EvtCodigo === form.EvtCodigo);
  const eventosMostrados = eventos.filter(t => mostrarInactivos || t.EvtActivo);

  // Piezas de la lista, para la tabla y para las tarjetas del celular
  const chipEfecto = (t) => {
    const ef = EFECTO_LABELS[String(t.EvtAfectaSaldo)] || EFECTO_LABELS['0'];
    return <span className={`${CHIP} ${ef.color}`}>{ef.label}</span>;
  };
  const textoDeuda = (t) => (t.EvtGeneraDeuda
    ? <span className="text-amber-700 text-xs font-bold">Sí</span>
    : <span className="text-zinc-400 text-xs">No</span>);
  const textoRecursos = (t) => (t.EvtAplicaRecurso
    ? <span className="text-brand-cyan text-xs font-bold">Sí (metros/kg)</span>
    : <span className="text-zinc-400 text-xs">No</span>);
  const botonReglas = (t) => (
    <button onClick={() => openForm(t.EvtCodigo)} className="text-xs font-bold text-brand-cyan hover:underline underline-offset-2">Ver reglas</button>
  );
  const acciones = (t) => (
    <div className="inline-flex gap-1.5">
      <button onClick={() => openForm(t.EvtCodigo)} title="Editar" aria-label="Editar"
        className={`${BTN_ICONO} hover:text-brand-cyan hover:border-brand-cyan/30 hover:bg-brand-cyan/5`}><Edit size={14} /></button>
      <button onClick={() => handleDelete(t.EvtCodigo)} title="Eliminar" aria-label="Eliminar"
        className={`${BTN_ICONO} hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5`}><Trash2 size={14} /></button>
    </div>
  );
  const codigo = (t) => (
    <span className="font-mono text-xs font-bold text-zinc-600 bg-zinc-50 border border-zinc-200 px-2 py-0.5 rounded-lg">{t.EvtCodigo}</span>
  );
  const nombre = (t) => (
    <>
      <div className="font-bold text-zinc-900">
        {t.EvtNombre}
        {!t.EvtActivo && <span className={`${CHIP} ml-2 align-middle bg-zinc-100 text-zinc-500 border-zinc-200`}>Inactivo</span>}
      </div>
      {t.EvtDescripcion && <div className="text-xs text-zinc-500 mt-0.5">{t.EvtDescripcion.substring(0,60)}{t.EvtDescripcion.length > 60 ? '...' : ''}</div>}
    </>
  );

  return (
    <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <BookOpen size={30} className="text-brand-cyan shrink-0" />
        <div className="min-w-[220px] flex-1">
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Motor de Eventos Contables</h1>
          <p className="text-sm text-zinc-500 mt-1 max-w-3xl">
            Tabla unificada: define cómo cada tipo de evento afecta el saldo del cliente (Submayor)
            y qué asiento genera en el Libro Mayor. Reemplaza toda la lógica hardcodeada del sistema.
          </p>
        </div>
        <div className="flex gap-2 items-center w-full sm:w-auto sm:ml-auto">
          <label className={`${BTN_SECUNDARIO} cursor-pointer flex-1 sm:flex-none`}>
            <input type="checkbox" checked={mostrarInactivos} onChange={(e) => setMostrarInactivos(e.target.checked)} className="w-4 h-4 accent-[#006E97]" />
            Mostrar inactivos
          </label>
          <button onClick={() => openForm(null)} className={`${BTN_PRINCIPAL} flex-1 sm:flex-none`}>
            <PlusCircle size={15} /> Nuevo evento
          </button>
        </div>
      </div>

      {/* Table */}
      <div className={`${CARD} overflow-hidden`}>
        {loading ? (
          <div className="py-12 flex flex-col items-center gap-2 text-sm text-zinc-400">
            <Loader2 size={24} className="animate-spin text-brand-cyan" />
            Cargando eventos...
          </div>
        ) : eventosMostrados.length === 0 ? (
          <div className="py-12 px-4 flex flex-col items-center gap-2 text-center">
            <BookOpen size={40} className="text-brand-cyan" />
            <p className="text-sm font-bold text-zinc-700">Sin eventos configurados</p>
          </div>
        ) : conTabla ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200">
                <tr>
                  <th className={TH}>Código</th>
                  <th className={TH}>Nombre</th>
                  <th className={TH}>Efecto saldo</th>
                  <th className={TH}>Genera deuda</th>
                  <th className={TH}>Usa recursos</th>
                  <th className={TH}>Reglas asiento</th>
                  <th className={`${TH} text-right`}>Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {eventosMostrados.map(t => (
                  <tr key={t.EvtCodigo} className={`hover:bg-zinc-50 transition-colors ${!t.EvtActivo ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-3">{codigo(t)}</td>
                    <td className="px-4 py-3">{nombre(t)}</td>
                    <td className="px-4 py-3">{chipEfecto(t)}</td>
                    <td className="px-4 py-3">{textoDeuda(t)}</td>
                    <td className="px-4 py-3">{textoRecursos(t)}</td>
                    <td className="px-4 py-3">{botonReglas(t)}</td>
                    <td className="px-4 py-3 text-right">{acciones(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <ul className="divide-y divide-zinc-100">
            {eventosMostrados.map(t => (
              <li key={t.EvtCodigo} className={`px-4 py-3 flex flex-col gap-2.5 ${!t.EvtActivo ? 'opacity-60' : ''}`}>
                <div className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">{codigo(t)}</div>
                  <div className="min-w-0 flex-1 text-sm">{nombre(t)}</div>
                  {acciones(t)}
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-zinc-50 border border-zinc-100 px-3 py-2.5">
                  <div className="min-w-0"><dt className={ETIQUETA}>Efecto saldo</dt><dd>{chipEfecto(t)}</dd></div>
                  <div className="min-w-0"><dt className={ETIQUETA}>Reglas asiento</dt><dd>{botonReglas(t)}</dd></div>
                  <div className="min-w-0"><dt className={ETIQUETA}>Genera deuda</dt><dd>{textoDeuda(t)}</dd></div>
                  <div className="min-w-0"><dt className={ETIQUETA}>Usa recursos</dt><dd>{textoRecursos(t)}</dd></div>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-4 bg-brand-cyan/5 border border-brand-cyan/20 rounded-2xl text-xs text-zinc-600 flex gap-3">
        <Info size={15} className="text-brand-cyan flex-shrink-0 mt-0.5" />
        <span>
          <b className="font-mono text-brand-cyan">META_CLIENTE</b> en las reglas de asiento se resuelve automáticamente a la cuenta contable del cliente involucrado en la transacción.
          <b className="font-mono text-brand-cyan ml-2">META_CAJA</b> se resuelve a la cuenta de caja activa en la sesión.
        </span>
      </div>

      {/* Modal */}
      {modalVisible && form && (
        <div className="fixed inset-0 bg-black/40 z-[6000] flex items-center justify-center p-3 sm:p-4">
          <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-4xl max-h-[92vh] flex flex-col shadow-xl overflow-hidden">
            {/* Modal Header */}
            <div className="px-5 sm:px-6 py-4 border-b border-zinc-100 flex justify-between items-start gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <BookOpen size={22} className="text-brand-cyan shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <h2 className="text-lg font-black text-zinc-900 leading-tight">Configuración del evento contable</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Código: <span className="font-mono font-bold text-brand-cyan">{form.EvtCodigo || '(nuevo)'}</span></p>
                </div>
              </div>
              <button onClick={() => setModalVisible(false)} title="Cerrar" aria-label="Cerrar" className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"><X size={18} /></button>
            </div>

            {/* Tabs */}
            <div className="px-5 sm:px-6 pt-3">
              <div className="inline-flex flex-wrap rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                {['comportamiento', 'asiento'].map(t => (
                  <button key={t} onClick={() => setTab(t)}
                    className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-bold transition-colors ${tab === t ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>
                    {t === 'comportamiento' ? 'Comportamiento en Submayor' : 'Reglas de asiento (Libro Mayor)'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-auto p-5 sm:p-6">
              {/* Tab: Comportamiento */}
              {tab === 'comportamiento' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <label className={ETIQUETA}>Código (ID único) *</label>
                      <input type="text" value={form.EvtCodigo} readOnly={isExisting}
                        onChange={e => setField('EvtCodigo', e.target.value.toUpperCase())}
                        className={`${CAMPO} font-mono ${isExisting ? 'bg-zinc-50 text-zinc-500' : ''}`}
                        placeholder="Ej: ORDEN" />
                    </div>
                    <div className="sm:col-span-2">
                      <label className={ETIQUETA}>Nombre visible *</label>
                      <input type="text" value={form.EvtNombre} onChange={e => setField('EvtNombre', e.target.value)}
                        className={CAMPO} />
                    </div>
                    <div className="sm:col-span-3">
                      <label className={ETIQUETA}>Descripción</label>
                      <input type="text" value={form.EvtDescripcion || ''} onChange={e => setField('EvtDescripcion', e.target.value)}
                        className={CAMPO} />
                    </div>
                    <div>
                      <label className={ETIQUETA}>Prefijo comprobante</label>
                      <input type="text" maxLength={5} value={form.EvtPrefijo || ''} onChange={e => setField('EvtPrefijo', e.target.value.toUpperCase())}
                        className={`${CAMPO} font-mono`}
                        placeholder="FC, TK, NC..." />
                    </div>
                    <div>
                      <label className={ETIQUETA}>Subtipo / secuencia</label>
                      <input type="text" value={form.EvtSubtipo || ''} onChange={e => setField('EvtSubtipo', e.target.value)}
                        className={`${CAMPO} font-mono`}
                        placeholder="FACTURA_PLAN..." />
                    </div>
                    <div>
                      <label className={ETIQUETA}>Orden de aparición</label>
                      <input type="number" value={form.EvtOrden} onChange={e => setField('EvtOrden', parseInt(e.target.value))}
                        className={CAMPO} />
                    </div>
                  </div>

                  {/* Comportamiento */}
                  <div className="border border-zinc-200 rounded-xl p-4 sm:p-5 space-y-4">
                    <h3 className="text-sm font-black text-zinc-900">Comportamiento en la cuenta corriente del cliente (Submayor)</h3>

                    <div>
                      <span className={ETIQUETA}>Efecto en saldo del cliente</span>
                      <div role="radiogroup" aria-label="Efecto en saldo del cliente" className="flex flex-wrap gap-2">
                        {[{ val: -1, label: '-1 Resta (genera deuda)' }, { val: 0, label: '0 Neutro' }, { val: 1, label: '+1 Suma (acredita)' }].map(op => (
                          <button key={op.val} type="button" role="radio" aria-checked={form.EvtAfectaSaldo === op.val}
                            onClick={() => setField('EvtAfectaSaldo', op.val)}
                            className={`px-3.5 py-2 rounded-xl border text-xs font-bold transition-colors ${form.EvtAfectaSaldo === op.val ? 'bg-zinc-900 border-zinc-900 text-white' : 'bg-white border-zinc-200 text-zinc-600 hover:border-zinc-400'}`}>
                            {op.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {[
                        { key: 'EvtGeneraDeuda', label: 'Genera documento de deuda a cobrar', desc: 'Aparecerá en «Antigüedad de deuda» y «Estados de cuenta»' },
                        { key: 'EvtAplicaRecurso', label: 'Aplica a recursos (metros/kg)', desc: 'Descuenta del plan físico del cliente en vez de dinero' },
                        { key: 'EvtUsaEntidad', label: 'Requiere cliente/proveedor', desc: 'El asiento necesita un ID de entidad asociada' },
                        { key: 'EvtRequiereDoc', label: 'Requiere comprobante fiscal', desc: 'Se debe emitir e-Factura, e-Ticket o nota de crédito' },
                      ].map(opt => (
                        <label key={opt.key} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${form[opt.key] ? 'border-brand-cyan/40 bg-brand-cyan/5' : 'border-zinc-200 hover:border-zinc-400'}`}>
                          <input type="checkbox" checked={!!form[opt.key]} onChange={e => setField(opt.key, e.target.checked)} className="mt-0.5 w-4 h-4 accent-[#006E97] flex-shrink-0" />
                          <div>
                            <div className="text-xs font-bold text-zinc-800">{opt.label}</div>
                            <div className="text-[11px] text-zinc-500 mt-0.5">{opt.desc}</div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Tab: Asiento */}
              {tab === 'asiento' && (
                <div className="space-y-4">
                  <div className="p-3 bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl text-xs text-zinc-600">
                    Cada fila es una línea del asiento contable que se genera automáticamente.
                    Usá <span className="font-mono font-bold text-brand-cyan">META_CLIENTE</span> para la cuenta del cliente o <span className="font-mono font-bold text-brand-cyan">META_CAJA</span> para la caja activa.
                  </div>

                  <div className="space-y-2">
                    {form.lineas.map((lin, idx) => (
                      <div key={idx} className="flex flex-wrap sm:flex-nowrap gap-2 border border-zinc-200 p-3 rounded-xl items-center">
                        <div className="w-12 text-center text-[11px] font-mono font-bold text-zinc-500 bg-zinc-50 rounded-lg py-2 border border-zinc-200 shrink-0">#{lin.RasOrden}</div>
                        <div className="flex-1 min-w-[84px]">
                          <Selector className="w-full" value={lin.RasNaturaleza} aria-label="Debe o haber" onChange={e => updateLinea(idx, 'RasNaturaleza', e.target.value)}>
                            <option value="DEBE">DEBE</option>
                            <option value="HABER">HABER</option>
                          </Selector>
                        </div>
                        <input type="text" placeholder="Cuenta (ej: 1.1.1.01 o META_CLIENTE)"
                          value={lin.CueCodigo} onChange={e => updateLinea(idx, 'CueCodigo', e.target.value)}
                          className={`${CAMPO} font-mono basis-full sm:basis-auto sm:flex-[2] order-last sm:order-none`} />
                        <div className="flex-1 min-w-[84px]">
                          <Selector className="w-full" value={lin.RasFormula} aria-label="Fórmula" onChange={e => updateLinea(idx, 'RasFormula', e.target.value)}>
                            {FORMULAS.map(f => <option key={f} value={f}>{f}</option>)}
                          </Selector>
                        </div>
                        <button onClick={() => removeLinea(idx)} title="Quitar la línea" aria-label="Quitar la línea"
                          className="p-2 rounded-lg text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 shrink-0"><Trash2 size={15} /></button>
                      </div>
                    ))}
                    <button onClick={addLinea}
                      className="w-full py-3 border-2 border-dashed border-zinc-200 hover:border-brand-cyan/50 hover:bg-brand-cyan/5 rounded-xl text-zinc-500 hover:text-brand-cyan text-sm font-bold flex justify-center items-center gap-2 transition-colors">
                      <PlusCircle size={15} /> Agregar línea de asiento
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 sm:px-6 py-4 border-t border-zinc-100 flex flex-wrap justify-between items-center gap-3">
              <label className="flex items-center gap-2 text-sm font-bold text-zinc-700 cursor-pointer">
                <input type="checkbox" checked={!!form.EvtActivo} onChange={e => setField('EvtActivo', e.target.checked)} className="w-4 h-4 accent-[#006E97]" />
                Activo
              </label>
              <div className="flex gap-2 ml-auto">
                <button onClick={() => setModalVisible(false)} className={BTN_SECUNDARIO}>Cancelar</button>
                <button onClick={handleSave} className={BTN_PRINCIPAL}>
                  <Save size={15} /> Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {ventanaConfirmar}
    </div>
  );
}
