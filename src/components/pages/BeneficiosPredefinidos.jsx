// ─────────────────────────────────────────────────────────────────────────────
// Beneficios predefinidos — catálogo de la EMPRESA (specs/40 RN-BEN.05..08).
// Ruta /beneficios/predefinidos (menú Ventas). Una plantilla nueva o editada pasa
// una vez por aprobación (Administración la publica directo); después cada cliente
// la activa solo, cargando el saldo. No cambia ningún precio por sí sola.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from 'react';
import { BadgePercent, Plus, RefreshCw, Power, AlertTriangle, X, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import EditorReglasBeneficio from '../beneficios/EditorReglasBeneficio';
import { benApi, sym, fmtN, vigenciaTexto, EstadoBadge, Cargando } from '../beneficios/beneficiosUi';

const formVacio = () => ({ id: null, nombre: '', descripcion: '', publico: false, monedaId: 1, carga: '', cargaEsMinimo: false, vigenciaModo: 'DIAS', vigenciaDias: 90, vigenciaHasta: '', reglas: [] });
const inputCls = 'w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm font-bold text-zinc-800 outline-none focus:border-cyan-500 bg-white';
const lbl = 'text-[10px] font-black text-zinc-400 uppercase tracking-widest';

export default function BeneficiosPredefinidos() {
  const [lista, setLista] = useState([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({ activo: false, puedeAprobar: false });
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  // Marcar varias plantillas a la vez para activarlas (publicar) o desactivarlas (pausar)
  // juntas. Solo se pueden marcar las que ya están PUBLICADA o PAUSADA: es lo único
  // donde "activar/desactivar" tiene sentido (un borrador o una pendiente no están
  // corriendo todavía). "Desactivar" = pausar: deja de ofrecerse para activaciones
  // NUEVAS; los clientes que YA la activaron siguen con su bolsa igual, hasta agotarla
  // o vencer. Es distinto del interruptor general de arriba, que apaga TODO el sistema
  // de beneficios (para todos los clientes, incluidos los ya activos) de una sola vez.
  const [marcados, setMarcados] = useState(() => new Set());
  // Aprobadores autorizados a mano, además de los roles Admin/Administracion (specs/40:
  // "no siempre es la Administración quien aprueba"). Panel visible solo para quien ya
  // puede aprobar (por rol o por esta misma lista).
  const [aprobPanel, setAprobPanel] = useState(false);
  const [aprobadores, setAprobadores] = useState([]);
  const [candidatos, setCandidatos] = useState([]);
  const [candidatoSel, setCandidatoSel] = useState('');
  const [aprobBusy, setAprobBusy] = useState(false);
  const [aplicandoLote, setAplicandoLote] = useState(false);
  const f = (patch) => setForm(x => ({ ...x, ...patch }));

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([benApi.get('/plantillas'), benApi.get('/config')]);
      setLista(r.data || []); setMeta({ activo: !!c.activo, puedeAprobar: !!c.puedeAprobar });
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { cargar(); }, [cargar]);

  const marcable = (p) => p.estado === 'PUBLICADA' || p.estado === 'PAUSADA';
  const marcablesVisibles = lista.filter(marcable);
  const toggleMarca = (id) => setMarcados(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleMarcaTodas = () => setMarcados(s => s.size === marcablesVisibles.length && marcablesVisibles.length > 0 ? new Set() : new Set(marcablesVisibles.map(p => p.BenIdBeneficio)));
  const limpiarMarcas = () => setMarcados(new Set());

  // Acción en lote: activar (reanudar) o desactivar (pausar) todas las marcadas de una.
  // Las marcadas que no están en el estado que corresponde (ej: pausar algo ya pausado)
  // se saltean solas, sin avisar con error — no tiene sentido frenar todo el lote por eso.
  const accionLote = async (accLote) => {
    const objetivo = accLote === 'desactivar' ? 'PUBLICADA' : 'PAUSADA';
    const accApi = accLote === 'desactivar' ? 'pausar' : 'reanudar';
    const candidatas = lista.filter(p => marcados.has(p.BenIdBeneficio) && p.estado === objetivo);
    if (!candidatas.length) { toast.error(`Ninguna de las marcadas está ${objetivo === 'PUBLICADA' ? 'publicada' : 'pausada'}: no hay nada para ${accLote}.`); return; }
    const msg = accLote === 'desactivar'
      ? `Desactivar (pausar) ${candidatas.length} beneficio${candidatas.length !== 1 ? 's' : ''}: dejan de ofrecerse para activaciones nuevas. Los clientes que ya los activaron siguen igual, hasta agotar el saldo o vencer. ¿Confirmás?`
      : `Activar (reanudar) ${candidatas.length} beneficio${candidatas.length !== 1 ? 's' : ''}: vuelven a estar disponibles para activarse. ¿Confirmás?`;
    if (!window.confirm(msg)) return;
    setAplicandoLote(true);
    let ok = 0, fallidos = [];
    for (const p of candidatas) {
      try { await benApi.post(`/plantillas/${p.BenIdBeneficio}/${accApi}`, {}); ok++; }
      catch (e) { fallidos.push(`${p.nombre}: ${e.message}`); }
    }
    setAplicandoLote(false);
    limpiarMarcas();
    await cargar();
    if (fallidos.length) toast.error(`${ok} listos, ${fallidos.length} fallaron:\n${fallidos.join('\n')}`, { duration: 12000 });
    else toast.success(`${ok} beneficio${ok !== 1 ? 's' : ''} ${accLote === 'desactivar' ? 'desactivado' : 'activado'}${ok !== 1 ? 's' : ''}.`, { duration: 8000 });
  };

  const editar = (p) => setForm({
    id: p.BenIdBeneficio, nombre: p.nombre, descripcion: p.descripcion || '', publico: p.publico, monedaId: p.monedaId, carga: p.carga, cargaEsMinimo: p.cargaEsMinimo,
    vigenciaModo: p.vigenciaHasta ? 'FECHA' : p.vigenciaDias ? 'DIAS' : 'AGOTAR', vigenciaDias: p.vigenciaDias || 90, vigenciaHasta: p.vigenciaHasta || '',
    reglas: (p.reglas || []).map(r => ({ ...r, codArticulo: r.codArticulo || '', codGrupo: r.codGrupo || '', areaId: r.areaId || '' })),
  });

  const guardar = async () => {
    if (!form.nombre.trim()) return toast.error('Poné un nombre al beneficio.');
    if (!(Number(form.carga) > 0)) return toast.error('La carga que activa el beneficio debe ser mayor a 0.');
    const reglas = form.reglas.filter(r => Number(r.valor) > 0);
    if (!reglas.length) return toast.error('Agregá al menos una regla de precio con valor.');
    setSaving(true);
    try {
      const body = { nombre: form.nombre, descripcion: form.descripcion, publico: form.publico, monedaId: form.monedaId, carga: Number(form.carga), cargaEsMinimo: form.cargaEsMinimo,
        vigenciaDias: form.vigenciaModo === 'DIAS' ? Number(form.vigenciaDias) : null, vigenciaHasta: form.vigenciaModo === 'FECHA' ? form.vigenciaHasta : null, reglas };
      const r = form.id ? await benApi.put(`/plantillas/${form.id}`, body) : await benApi.post('/plantillas', body);
      toast.success(r.message || 'Guardado', { duration: 8000 });
      setForm(null); cargar();
    } catch (e) { toast.error(e.message, { duration: 8000 }); }
    finally { setSaving(false); }
  };

  const accion = async (p, acc) => {
    const textos = {
      aprobar: `Aprobar y PUBLICAR la plantilla "${p.nombre}". Desde ese momento ${p.publico ? 'cualquier cliente la puede activar desde el portal' : 'los vendedores la pueden usar en un pacto'}. ¿Confirmás?`,
      rechazar: `Rechazar la plantilla "${p.nombre}" (vuelve a borrador).`,
      pausar: `Pausar "${p.nombre}": deja de ofrecerse. Los beneficios ya activados con ella siguen hasta agotarse o vencer. ¿Confirmás?`,
      reanudar: `Volver a publicar "${p.nombre}". ¿Confirmás?`,
      enviar: `Enviar "${p.nombre}" a aprobación. ¿Confirmás?`,
    };
    let body = {};
    if (acc === 'rechazar') { const m = window.prompt(`${textos.rechazar}\n\nMotivo (obligatorio):`); if (m == null) return; if (!m.trim()) return toast.error('El motivo es obligatorio.'); body = { motivo: m }; }
    else if (!window.confirm(textos[acc])) return;
    try { const r = await benApi.post(`/plantillas/${p.BenIdBeneficio}/${acc}`, body); toast.success(r.message || 'Listo'); cargar(); }
    catch (e) { toast.error(e.message, { duration: 8000 }); }
  };

  const toggleInterruptor = async () => {
    const msg = meta.activo
      ? 'APAGAR los beneficios en todo el sistema: ningún precio pactado aplica, no se consumen bolsas y no se activan beneficios. Los pactos y plantillas quedan como están. ¿Confirmás?'
      : 'ENCENDER los beneficios en todo el sistema: los precios pactados de los beneficios activos empiezan a aplicar y las bolsas se consumen. ¿Confirmás?';
    if (!window.confirm(msg)) return;
    try { const r = await benApi.post('/config', { activo: !meta.activo }); toast.success(r.message, { duration: 8000 }); cargar(); }
    catch (e) { toast.error(e.message); }
  };

  const cargarAprobadores = useCallback(async () => {
    try { const r = await benApi.get('/aprobadores'); setAprobadores(r.data || []); setCandidatos(r.candidatos || []); }
    catch (e) { toast.error(e.message); }
  }, []);
  const abrirAprobPanel = () => { setAprobPanel(true); cargarAprobadores(); };
  const agregarAprob = async () => {
    if (!candidatoSel) return;
    setAprobBusy(true);
    try { const r = await benApi.post('/aprobadores', { idUsuario: Number(candidatoSel) }); toast.success(r.message, { duration: 8000 }); setCandidatoSel(''); await cargarAprobadores(); }
    catch (e) { toast.error(e.message, { duration: 8000 }); }
    finally { setAprobBusy(false); }
  };
  const quitarAprob = async (a) => {
    if (!window.confirm(`Quitar a ${a.nombre} de la lista de aprobadores autorizados. ${a.rol && ['admin', 'administracion'].includes(String(a.rol).toLowerCase()) ? `Igual va a poder seguir aprobando por su rol (${a.rol}).` : 'Deja de poder aprobar, salvo que tenga rol Admin o Administracion.'} ¿Confirmás?`)) return;
    setAprobBusy(true);
    try { await benApi.post(`/aprobadores/${a.idUsuario}/quitar`, {}); toast.success(`${a.nombre} ya no está en la lista.`); await cargarAprobadores(); }
    catch (e) { toast.error(e.message, { duration: 8000 }); }
    finally { setAprobBusy(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <p className="text-[11px] text-zinc-500 mb-2">Vista 360 · Vendedores › pestaña Beneficios › <strong className="text-zinc-800">Beneficios predefinidos</strong></p>
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-700 rounded-xl flex items-center justify-center shadow-lg"><BadgePercent size={20} className="text-white" /></div>
            <div>
              <h1 className="text-xl font-black text-zinc-900">Beneficios predefinidos</h1>
              <p className="text-xs text-zinc-500">Plantillas de la empresa. Una plantilla nueva pasa una vez por aprobación; después cada cliente la activa solo, cargando el saldo. No cambia ningún precio por sí sola.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {meta.puedeAprobar && (
              <button type="button" onClick={toggleInterruptor} title="Interruptor general de beneficios (ConfiguracionGlobal.BENEFICIOS_ACTIVOS)"
                className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border shadow-sm ${meta.activo ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-amber-50 border-amber-200 text-amber-800'}`}>
                <Power size={13} /> Beneficios {meta.activo ? 'ENCENDIDOS' : 'APAGADOS'} · {meta.activo ? 'apagar' : 'encender'}
              </button>
            )}
            {meta.puedeAprobar && (
              <button type="button" onClick={abrirAprobPanel} title="Quién más, además de Admin y Administración, puede aprobar"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border shadow-sm bg-white border-zinc-200 text-zinc-700 hover:bg-zinc-50">
                <ShieldCheck size={13} /> Quién aprueba
              </button>
            )}
            <button type="button" onClick={cargar} className="inline-flex items-center gap-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-bold text-xs px-4 py-2 rounded-xl shadow-sm"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
            <button type="button" onClick={() => setForm(formVacio())} className="inline-flex items-center gap-2 bg-cyan-700 hover:bg-cyan-800 text-white font-black text-sm px-5 py-2 rounded-xl shadow-md"><Plus size={16} /> Nuevo beneficio predefinido</button>
          </div>
        </div>
        {!meta.activo && !loading && (
          <div className="mb-4 flex items-center gap-2 text-[12px] text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2"><AlertTriangle size={14} /> Beneficios apagados: se pueden crear y aprobar plantillas, pero ningún cliente puede activarlas hasta que Administración encienda el interruptor.</div>
        )}

        {marcados.size > 0 && (
          <div className="mb-3 flex items-center gap-3 flex-wrap bg-cyan-50 border border-cyan-200 rounded-xl px-4 py-2.5">
            <span className="text-xs font-black text-cyan-900">{marcados.size} marcado{marcados.size !== 1 ? 's' : ''}</span>
            <button type="button" disabled={aplicandoLote} onClick={() => accionLote('desactivar')}
              className="px-3 py-1.5 text-[11px] font-bold text-amber-800 bg-white border border-amber-200 rounded-lg disabled:opacity-50">Desactivar (pausar) los marcados</button>
            <button type="button" disabled={aplicandoLote} onClick={() => accionLote('activar')}
              className="px-3 py-1.5 text-[11px] font-bold text-emerald-700 bg-white border border-emerald-200 rounded-lg disabled:opacity-50">Activar (reanudar) los marcados</button>
            <button type="button" disabled={aplicandoLote} onClick={limpiarMarcas} className="ml-auto text-[11px] font-bold text-cyan-700 underline">Quitar marca a todos</button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-5 items-start">
          <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
            {loading ? <Cargando /> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                  <th className="px-4 py-3 text-center w-10">
                    <input type="checkbox" title="Marcar todos los publicados/pausados de esta lista" disabled={marcablesVisibles.length === 0}
                      checked={marcablesVisibles.length > 0 && marcados.size === marcablesVisibles.length}
                      onChange={toggleMarcaTodas} className="w-3.5 h-3.5 accent-cyan-700" />
                  </th>
                  <th className="px-4 py-3 text-left">Beneficio y alcance</th><th className="px-4 py-3 text-left">Precio pactado</th><th className="px-4 py-3 text-left">Carga que lo activa</th><th className="px-4 py-3 text-left">Vigencia</th><th className="px-4 py-3 text-left">Quién lo activa</th><th className="px-4 py-3 text-left">Estado</th><th className="px-4 py-3 text-center">Acciones</th>
                </tr></thead>
                <tbody>
                  {lista.map(p => (
                    <tr key={p.BenIdBeneficio} className={`border-b border-zinc-100 ${form?.id === p.BenIdBeneficio ? 'bg-cyan-50/60' : ''} ${marcados.has(p.BenIdBeneficio) ? 'bg-cyan-50/40' : ''}`}>
                      <td className="px-4 py-3 align-top text-center">
                        {marcable(p) && <input type="checkbox" checked={marcados.has(p.BenIdBeneficio)} onChange={() => toggleMarca(p.BenIdBeneficio)}
                          title={p.estado === 'PUBLICADA' ? 'Marcar para desactivar (pausar) en lote' : 'Marcar para activar (reanudar) en lote'}
                          className="w-3.5 h-3.5 accent-cyan-700" />}
                      </td>
                      <td className="px-4 py-3 align-top"><span className="font-black text-zinc-900">{p.nombre}</span>{p.descripcion && <span className="block text-[11px] text-zinc-500">{p.descripcion}</span>}</td>
                      <td className="px-4 py-3 align-top text-xs text-zinc-700">{(p.reglasTexto || []).map((t, i) => <span key={i} className="block">{t}</span>)}</td>
                      <td className="px-4 py-3 align-top"><span className="font-bold">{sym(p.monedaId)} {fmtN(p.carga)}</span><span className="block text-[11px] text-zinc-500">{p.cargaEsMinimo ? 'monto mínimo' : 'monto fijo'}</span></td>
                      <td className="px-4 py-3 align-top text-xs">{vigenciaTexto(p)}</td>
                      <td className="px-4 py-3 align-top">
                        <span title={p.publico ? 'El cliente lo activa solo, desde el portal, sin aprobación.' : 'El cliente NO lo puede activar solo desde el portal. Caja/Administración sí puede activarlo directo para cualquier cliente, con o sin pacto de por medio.'}
                          className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border cursor-help ${p.publico ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-violet-50 text-violet-700 border-violet-200'}`}>{p.publico ? 'Todos · portal' : 'Solo por pacto'}</span>
                        <span className="block text-[11px] text-zinc-500 mt-1">{p.activaciones ? `${p.activaciones} activación${p.activaciones !== 1 ? 'es' : ''} (${p.activacionesVivas} viva${p.activacionesVivas !== 1 ? 's' : ''})` : 'sin activaciones'}</span>
                      </td>
                      <td className="px-4 py-3 align-top"><EstadoBadge estado={p.estado} />{p.estado === 'BORRADOR' && p.motivoRechazo && <span className="block text-[11px] text-rose-600 mt-1">Rechazada: {p.motivoRechazo}</span>}</td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex flex-wrap gap-1.5 justify-center">
                          <button type="button" onClick={() => editar(p)} className="px-2.5 py-1 text-[11px] font-bold text-zinc-700 bg-white border border-zinc-200 rounded-lg">Editar</button>
                          {p.estado === 'BORRADOR' && <button type="button" onClick={() => accion(p, 'enviar')} className="px-2.5 py-1 text-[11px] font-bold text-white bg-cyan-700 rounded-lg">Enviar a aprobación</button>}
                          {p.estado === 'PENDIENTE' && meta.puedeAprobar && <><button type="button" onClick={() => accion(p, 'aprobar')} className="px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 rounded-lg">Aprobar y publicar</button><button type="button" onClick={() => accion(p, 'rechazar')} className="px-2.5 py-1 text-[11px] font-bold text-rose-700 bg-white border border-rose-200 rounded-lg">Rechazar</button></>}
                          {p.estado === 'PUBLICADA' && <button type="button" onClick={() => accion(p, 'pausar')} className="px-2.5 py-1 text-[11px] font-bold text-amber-800 bg-white border border-amber-200 rounded-lg">Pausar</button>}
                          {p.estado === 'PAUSADA' && <button type="button" onClick={() => accion(p, 'reanudar')} className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-white border border-emerald-200 rounded-lg">Reanudar</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {lista.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-zinc-400">Todavía no hay beneficios predefinidos. Creá el primero con el botón de arriba.</td></tr>}
                </tbody>
              </table></div>
            )}
            <div className="px-4 py-2.5 text-[11px] text-zinc-500 bg-zinc-50 border-t border-zinc-200">Pausar una plantilla no toca los beneficios ya activados: esos siguen hasta agotarse o vencer. Marcá varias con el tilde de la izquierda para activarlas o desactivarlas juntas.</div>
          </div>

          {form && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => e.target === e.currentTarget && setForm(null)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl mx-4 overflow-hidden max-h-[90vh] flex flex-col">
              <div className="px-6 py-4 flex items-center justify-between bg-gradient-to-r from-cyan-700 to-cyan-900 text-white shrink-0">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-80">{form.id ? 'Editar beneficio predefinido' : 'Nuevo beneficio predefinido'}</p>
                  <h2 className="text-lg font-black mt-0.5">{form.nombre || 'Sin nombre'}</h2>
                </div>
                <button type="button" onClick={() => setForm(null)} className="p-1.5 hover:bg-white/20 rounded-lg shrink-0"><X size={18} /></button>
              </div>
              <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className={lbl}>Nombre (así lo ve el cliente)</label><input value={form.nombre} onChange={e => f({ nombre: e.target.value })} className={inputCls} /></div>
                <div><label className={lbl}>Descripción corta (opcional)</label><input value={form.descripcion} onChange={e => f({ descripcion: e.target.value })} className={inputCls} /></div>
              </div>
              <div>
                <label className={lbl}>¿Quién puede activarlo?</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-1">
                  <label className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer ${form.publico ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 bg-white'}`}><input type="radio" checked={form.publico} onChange={() => f({ publico: true })} className="mt-1" /><span><span className="block text-sm font-bold text-slate-800">Todos los clientes, desde el portal</span><span className="block text-[11px] text-slate-500">Aparece en «Beneficios para vos» y cada activación no pasa por aprobación.</span></span></label>
                  <label className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 cursor-pointer ${!form.publico ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 bg-white'}`}><input type="radio" checked={!form.publico} onChange={() => f({ publico: false })} className="mt-1" /><span><span className="block text-sm font-bold text-slate-800">Solo por pacto</span><span className="block text-[11px] text-slate-500">El cliente no lo puede activar solo desde el portal: el vendedor lo usa de base para pactarlo y eso pasa por aprobación. Caja/Administración sí puede activarlo directo para cualquier cliente sin pactarlo, desde Venta de saldo.</span></span></label>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div><label className={lbl}>Moneda</label><div className="grid grid-cols-2 gap-2 mt-1">{[{ v: 1, l: '$ pesos' }, { v: 2, l: 'US$ dólares' }].map(m => <button type="button" key={m.v} onClick={() => f({ monedaId: m.v })} className={`px-3 py-2 rounded-lg text-xs font-semibold border ${form.monedaId === m.v ? 'bg-cyan-700 text-white border-cyan-700' : 'bg-white text-slate-600 border-slate-200'}`}>{m.l}</button>)}</div></div>
                <div><label className={lbl}>Carga que lo activa ({sym(form.monedaId)})</label><input type="number" step="0.01" min="0" value={form.carga} onChange={e => f({ carga: e.target.value })} className={`${inputCls} font-mono`} /></div>
                <div>
                  <label className={lbl}>Tipo de carga</label>
                  <div className="flex flex-col gap-1.5 mt-2 text-xs text-slate-600">
                    <label className="flex items-center gap-1.5"><input type="radio" checked={!form.cargaEsMinimo} onChange={() => f({ cargaEsMinimo: false })} /> Monto fijo</label>
                    <label className="flex items-center gap-1.5"><input type="radio" checked={form.cargaEsMinimo} onChange={() => f({ cargaEsMinimo: true })} /> Monto mínimo (puede cargar más)</label>
                  </div>
                </div>
              </div>
              <div>
                <label className={lbl}>Vigencia</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  <label className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-bold ${form.vigenciaModo === 'DIAS' ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 bg-white text-slate-600'}`}><input type="radio" checked={form.vigenciaModo === 'DIAS'} onChange={() => f({ vigenciaModo: 'DIAS' })} /> Días desde la activación <input type="number" min="1" value={form.vigenciaDias} onChange={e => f({ vigenciaDias: e.target.value, vigenciaModo: 'DIAS' })} className="w-14 border border-slate-200 rounded px-1 py-0.5 text-center" /></label>
                  <label className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-bold ${form.vigenciaModo === 'FECHA' ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 bg-white text-slate-600'}`}><input type="radio" checked={form.vigenciaModo === 'FECHA'} onChange={() => f({ vigenciaModo: 'FECHA' })} /> Hasta una fecha <input type="date" value={form.vigenciaHasta} onChange={e => f({ vigenciaHasta: e.target.value, vigenciaModo: 'FECHA' })} className="border border-slate-200 rounded px-1 py-0.5" /></label>
                  <label className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-bold ${form.vigenciaModo === 'AGOTAR' ? 'border-cyan-400 bg-cyan-50' : 'border-slate-200 bg-white text-slate-600'}`}><input type="radio" checked={form.vigenciaModo === 'AGOTAR'} onChange={() => f({ vigenciaModo: 'AGOTAR' })} /> Hasta agotar el saldo</label>
                </div>
              </div>
              <div>
                <label className={lbl}>Alcance y precio pactado</label>
                <div className="mt-1"><EditorReglasBeneficio value={form.reglas} onChange={reglas => f({ reglas })} monedaId={form.monedaId} /></div>
                <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mt-2">Mientras el beneficio esté vigente y tenga saldo, estos precios pisan la tarifa del cliente, común o especial. Al agotarse o vencer, el cliente vuelve solo a su tarifa.</p>
              </div>
              <div className="flex gap-2 pt-1">
                <button type="button" onClick={() => setForm(null)} className="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest bg-slate-100 text-slate-600 rounded-lg">Cancelar</button>
                <button type="button" onClick={guardar} disabled={saving} className="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest bg-cyan-700 text-white rounded-lg disabled:opacity-50">{saving ? 'Guardando…' : meta.puedeAprobar ? 'Guardar y publicar' : 'Guardar y enviar a aprobación'}</button>
              </div>
              </div>
            </div>
          </div>
          )}
        </div>

        {aprobPanel && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => e.target === e.currentTarget && setAprobPanel(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden max-h-[85vh] flex flex-col">
              <div className="px-6 py-4 flex items-center justify-between bg-gradient-to-r from-cyan-700 to-cyan-900 text-white shrink-0">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-80">Además de Admin y Administración</p>
                  <h2 className="text-lg font-black mt-0.5">Quién más puede aprobar</h2>
                </div>
                <button type="button" onClick={() => setAprobPanel(false)} className="p-1.5 hover:bg-white/20 rounded-lg shrink-0"><X size={18} /></button>
              </div>
              <div className="px-6 py-5 space-y-4 overflow-y-auto">
                <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                  Los roles <strong>Admin</strong> y <strong>Administracion</strong> siempre pueden aprobar/rechazar pactos y plantillas, pausar, cerrar bolsas y prender o apagar el interruptor general. Acá agregás, uno por uno, a cualquier otra persona puntual que también deba poder hacerlo, sin cambiarle el rol.
                </p>
                <div>
                  <label className={lbl}>Agregar a alguien</label>
                  <div className="flex gap-2 mt-1">
                    <select value={candidatoSel} onChange={e => setCandidatoSel(e.target.value)} className="flex-1 border border-zinc-200 rounded-lg px-2 py-2 text-sm bg-white">
                      <option value="">— Elegir una persona —</option>
                      {candidatos.map(c => <option key={c.idUsuario} value={c.idUsuario}>{c.nombre}{c.rol ? ` (${c.rol})` : ''}</option>)}
                    </select>
                    <button type="button" onClick={agregarAprob} disabled={!candidatoSel || aprobBusy} className="px-4 py-2 text-xs font-bold text-white bg-cyan-700 rounded-lg disabled:opacity-50 shrink-0">Agregar</button>
                  </div>
                  {candidatos.length === 0 && <p className="text-[11px] text-zinc-400 mt-1">No quedan usuarios internos activos para agregar (o ya están todos en la lista, o ya aprueban por su rol).</p>}
                </div>
                <div>
                  <label className={lbl}>Autorizados a mano ({aprobadores.length})</label>
                  {aprobadores.length === 0 ? (
                    <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mt-1">Nadie todavía. Solo Admin y Administracion aprueban por ahora.</p>
                  ) : (
                    <div className="mt-1 divide-y divide-zinc-100 border border-zinc-200 rounded-lg overflow-hidden">
                      {aprobadores.map(a => (
                        <div key={a.idUsuario} className="flex items-center justify-between gap-2 px-3 py-2 bg-white">
                          <span className="text-sm"><span className="font-bold text-zinc-800">{a.nombre}</span>{a.rol && <span className="text-[11px] text-zinc-400"> · rol {a.rol}</span>}</span>
                          <button type="button" onClick={() => quitarAprob(a)} disabled={aprobBusy} title="Quitar de la lista" className="text-zinc-400 hover:text-rose-600 disabled:opacity-50"><X size={14} /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
