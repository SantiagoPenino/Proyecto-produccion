// ─────────────────────────────────────────────────────────────────────────────
// Beneficios predefinidos — catálogo de la EMPRESA (specs/40 RN-BEN.05..08).
// Ruta /beneficios/predefinidos (menú Ventas). Una plantilla nueva o editada pasa
// una vez por aprobación (Administración la publica directo); después cada cliente
// la activa solo, cargando el saldo. No cambia ningún precio por sí sola.
// Estética nueva (28/10/2026): encabezado, tabla clara (en el celular, una tarjeta por plantilla), ventanas claras en
// z-[6000], radios → opciones/pastillas, fechas y selects del sistema, y las confirmaciones con la ventana del sistema
// (antes window.confirm / window.prompt). EditorReglasBeneficio y EstadoBadge son compartidos: no se tocaron.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from 'react';
import { BadgePercent, Plus, RefreshCw, Power, AlertTriangle, X, ShieldCheck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import EditorReglasBeneficio from '../beneficios/EditorReglasBeneficio';
import { benApi, sym, fmtN, vigenciaTexto, EstadoBadge, Cargando } from '../beneficios/beneficiosUi';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import useConfirmar from '../ui/useConfirmar';

const formVacio = () => ({ id: null, nombre: '', descripcion: '', publico: false, monedaId: 1, carga: '', cargaEsMinimo: false, vigenciaModo: 'DIAS', vigenciaDias: 90, vigenciaHasta: '', reglas: [] });
const inputCls = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-semibold text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const lbl = 'block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5';
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const TH = 'px-4 py-3 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const ACCION = 'px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 transition-colors whitespace-nowrap';
const ACCION_PRINCIPAL = 'px-2.5 py-1.5 rounded-lg bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors whitespace-nowrap';
const CHECK = 'w-4 h-4 rounded border-zinc-300 accent-[#006E97] cursor-pointer';

// En el celular, tarjetas en vez de la tabla de 8 columnas (una vista sola: no se dibujan las dos ocultando una)
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
  const [confirmar, ventanaConfirmar] = useConfirmar();
  const conTabla = useConTabla();
  const [rechazo, setRechazo] = useState(null); // { p, motivo }: rechazar una plantilla pide el motivo

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
    if (!(await confirmar({ titulo: accLote === 'desactivar' ? 'Desactivar los marcados' : 'Activar los marcados', texto: msg, confirmar: accLote === 'desactivar' ? 'Desactivar' : 'Activar' }))) return;
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
    if (acc === 'rechazar') { setRechazo({ p, motivo: '' }); return; }
    const titulos = { aprobar: 'Aprobar y publicar', pausar: 'Pausar', reanudar: 'Volver a publicar', enviar: 'Enviar a aprobación' };
    if (!(await confirmar({ titulo: titulos[acc], texto: textos[acc], confirmar: titulos[acc] }))) return;
    try { const r = await benApi.post(`/plantillas/${p.BenIdBeneficio}/${acc}`, body); toast.success(r.message || 'Listo'); cargar(); }
    catch (e) { toast.error(e.message, { duration: 8000 }); }
  };
  // Rechazar: el motivo se pide en una ventana propia (antes, window.prompt). Mismo pedido a la API.
  const confirmarRechazo = async () => {
    const { p, motivo: m } = rechazo;
    if (!m.trim()) return toast.error('El motivo es obligatorio.');
    try { const r = await benApi.post(`/plantillas/${p.BenIdBeneficio}/rechazar`, { motivo: m }); toast.success(r.message || 'Listo'); setRechazo(null); cargar(); }
    catch (e) { toast.error(e.message, { duration: 8000 }); }
  };

  const toggleInterruptor = async () => {
    const msg = meta.activo
      ? 'APAGAR los beneficios en todo el sistema: ningún precio pactado aplica, no se consumen bolsas y no se activan beneficios. Los pactos y plantillas quedan como están. ¿Confirmás?'
      : 'ENCENDER los beneficios en todo el sistema: los precios pactados de los beneficios activos empiezan a aplicar y las bolsas se consumen. ¿Confirmás?';
    if (!(await confirmar({ titulo: meta.activo ? 'Apagar los beneficios' : 'Encender los beneficios', texto: msg, confirmar: meta.activo ? 'Apagar' : 'Encender', peligro: meta.activo }))) return;
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
    if (!(await confirmar({ titulo: 'Quitar aprobador', texto: `Quitar a ${a.nombre} de la lista de aprobadores autorizados. ${a.rol && ['admin', 'administracion'].includes(String(a.rol).toLowerCase()) ? `Igual va a poder seguir aprobando por su rol (${a.rol}).` : 'Deja de poder aprobar, salvo que tenga rol Admin o Administracion.'} ¿Confirmás?`, confirmar: 'Quitar', peligro: true }))) return;
    setAprobBusy(true);
    try { await benApi.post(`/aprobadores/${a.idUsuario}/quitar`, {}); toast.success(`${a.nombre} ya no está en la lista.`); await cargarAprobadores(); }
    catch (e) { toast.error(e.message, { duration: 8000 }); }
    finally { setAprobBusy(false); }
  };


  // ── Piezas del render ───────────────────────────────────────────────────────
  const chipQuien = (p) => (
    <>
      <span title={p.publico ? 'El cliente lo activa solo, desde el portal, sin aprobación.' : 'El cliente NO lo puede activar solo desde el portal. Caja/Administración sí puede activarlo directo para cualquier cliente, con o sin pacto de por medio.'}
        className={`inline-flex px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide border cursor-help whitespace-nowrap ${p.publico ? 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20' : 'bg-zinc-50 text-zinc-600 border-zinc-200'}`}>{p.publico ? 'Todos · portal' : 'Solo por pacto'}</span>
      <span className="block text-[11px] text-zinc-400 mt-1">{p.activaciones ? `${p.activaciones} activación${p.activaciones !== 1 ? 'es' : ''} (${p.activacionesVivas} viva${p.activacionesVivas !== 1 ? 's' : ''})` : 'sin activaciones'}</span>
    </>
  );
  const estadoCelda = (p) => (
    <>
      <EstadoBadge estado={p.estado} />
      {p.estado === 'BORRADOR' && p.motivoRechazo && <span className="block text-[11px] text-brand-magenta mt-1">Rechazada: {p.motivoRechazo}</span>}
    </>
  );
  const acciones = (p, alinear = 'justify-center') => (
    <div className={`flex flex-wrap gap-1.5 ${alinear}`}>
      <button type="button" onClick={() => editar(p)} className={ACCION}>Editar</button>
      {p.estado === 'BORRADOR' && <button type="button" onClick={() => accion(p, 'enviar')} className={ACCION_PRINCIPAL}>Enviar a aprobación</button>}
      {p.estado === 'PENDIENTE' && meta.puedeAprobar && <>
        <button type="button" onClick={() => accion(p, 'aprobar')} className={ACCION_PRINCIPAL}>Aprobar y publicar</button>
        <button type="button" onClick={() => accion(p, 'rechazar')} className={`${ACCION} hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5`}>Rechazar</button>
      </>}
      {p.estado === 'PUBLICADA' && <button type="button" onClick={() => accion(p, 'pausar')} className={`${ACCION} hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50`}>Pausar</button>}
      {p.estado === 'PAUSADA' && <button type="button" onClick={() => accion(p, 'reanudar')} className={`${ACCION} hover:text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50`}>Reanudar</button>}
    </div>
  );
  const checkFila = (p) => marcable(p) && (
    <input type="checkbox" checked={marcados.has(p.BenIdBeneficio)} onChange={() => toggleMarca(p.BenIdBeneficio)}
      aria-label={`Marcar ${p.nombre}`}
      title={p.estado === 'PUBLICADA' ? 'Marcar para desactivar (pausar) en lote' : 'Marcar para activar (reanudar) en lote'}
      className={CHECK} />
  );
  // Opción elegible (reemplaza a los radios del navegador): llama al mismo f(...) que antes
  const Opcion = ({ elegida, onElegir, children, className = '' }) => (
    <button type="button" role="radio" aria-checked={elegida} onClick={onElegir}
      className={`flex items-start gap-2.5 text-left rounded-xl border px-3 py-2.5 transition-colors ${elegida ? 'border-brand-cyan/50 bg-brand-cyan/5' : 'border-zinc-200 bg-white hover:bg-zinc-50'} ${className}`}>
      <span className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${elegida ? 'border-brand-cyan' : 'border-zinc-300'}`}>
        {elegida && <span className="w-2 h-2 rounded-full bg-brand-cyan" />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );

  return (
    <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
      <p className="text-[11px] text-zinc-400 -mb-2">Vista 360 · Vendedores › pestaña Beneficios › <strong className="text-zinc-700">Beneficios predefinidos</strong></p>

      {/* Encabezado */}
      <div className="flex flex-wrap items-center gap-3">
        <BadgePercent size={30} className="text-brand-cyan shrink-0" />
        <div className="min-w-[240px] flex-1">
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Beneficios predefinidos</h1>
          <p className="text-sm text-zinc-500 mt-1">Plantillas de la empresa. Una plantilla nueva pasa una vez por aprobación; después cada cliente la activa solo, cargando el saldo. No cambia ningún precio por sí sola.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full lg:w-auto lg:ml-auto">
          {meta.puedeAprobar && (
            <button type="button" onClick={toggleInterruptor} title="Interruptor general de beneficios (ConfiguracionGlobal.BENEFICIOS_ACTIVOS)"
              className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-bold border transition-colors ${meta.activo ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' : 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100'}`}>
              <Power size={15} /> Beneficios {meta.activo ? 'ENCENDIDOS' : 'APAGADOS'} · {meta.activo ? 'apagar' : 'encender'}
            </button>
          )}
          {meta.puedeAprobar && (
            <button type="button" onClick={abrirAprobPanel} title="Quién más, además de Admin y Administración, puede aprobar" className={BTN_SECUNDARIO}>
              <ShieldCheck size={15} className="text-brand-cyan" /> Quién aprueba
            </button>
          )}
          <button type="button" onClick={cargar} className={BTN_SECUNDARIO}><RefreshCw size={15} className={`text-brand-cyan ${loading ? 'animate-spin' : ''}`} /> Actualizar</button>
          <button type="button" onClick={() => setForm(formVacio())} className={BTN_PRINCIPAL}><Plus size={16} /> Nuevo beneficio predefinido</button>
        </div>
      </div>

      {!meta.activo && !loading && (
        <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5"><AlertTriangle size={15} className="shrink-0 mt-px" /> Beneficios apagados: se pueden crear y aprobar plantillas, pero ningún cliente puede activarlas hasta que Administración encienda el interruptor.</div>
      )}

      {marcados.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap bg-brand-cyan/5 border border-brand-cyan/20 rounded-xl px-4 py-2.5">
          <span className="text-xs font-black text-brand-cyan mr-1">{marcados.size} marcado{marcados.size !== 1 ? 's' : ''}</span>
          <button type="button" disabled={aplicandoLote} onClick={() => accionLote('desactivar')}
            className={`${ACCION} hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50 disabled:opacity-50`}>Desactivar (pausar) los marcados</button>
          <button type="button" disabled={aplicandoLote} onClick={() => accionLote('activar')}
            className={`${ACCION} hover:text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-50`}>Activar (reanudar) los marcados</button>
          <button type="button" disabled={aplicandoLote} onClick={limpiarMarcas} className="ml-auto text-xs font-bold text-brand-cyan hover:underline">Quitar marca a todos</button>
        </div>
      )}

      {!conTabla ? (
        <div className="flex flex-col gap-2.5">
          {loading ? <div className={CARD}><Cargando /></div> : lista.length === 0 ? (
            <div className={`${CARD} px-4 py-12 flex flex-col items-center text-center`}>
              <BadgePercent size={40} className="mb-3 text-brand-cyan" />
              <span className="text-sm font-bold text-zinc-700">Todavía no hay beneficios predefinidos.</span>
              <span className="text-xs text-zinc-400 mt-1">Creá el primero con el botón de arriba.</span>
            </div>
          ) : lista.map(p => (
            <div key={p.BenIdBeneficio} className={`${CARD} p-3.5 flex flex-col gap-2.5 ${marcados.has(p.BenIdBeneficio) ? 'ring-2 ring-brand-cyan/20' : ''}`}>
              <div className="flex items-start gap-2.5">
                {checkFila(p) && <div className="pt-0.5">{checkFila(p)}</div>}
                <div className="min-w-0 flex-1">
                  <div className="font-black text-zinc-900">{p.nombre}</div>
                  {p.descripcion && <div className="text-[11px] text-zinc-500">{p.descripcion}</div>}
                </div>
                <div className="shrink-0">{estadoCelda(p)}</div>
              </div>
              <div className="text-xs text-zinc-700 bg-zinc-50 rounded-xl px-3 py-2">{(p.reglasTexto || []).map((t, i) => <span key={i} className="block">{t}</span>)}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400">Carga</span><span className="font-bold tabular-nums">{sym(p.monedaId)} {fmtN(p.carga)}</span> <span className="text-zinc-400">{p.cargaEsMinimo ? 'mínimo' : 'fijo'}</span></div>
                <div><span className="block text-[10px] font-black uppercase tracking-widest text-zinc-400">Vigencia</span>{vigenciaTexto(p)}</div>
              </div>
              <div>{chipQuien(p)}</div>
              <div className="pt-2.5 border-t border-zinc-100">{acciones(p, 'justify-start')}</div>
            </div>
          ))}
          <p className="text-[11px] text-zinc-400 px-1">Pausar una plantilla no toca los beneficios ya activados: esos siguen hasta agotarse o vencer. Marcá varias con el tilde para activarlas o desactivarlas juntas.</p>
        </div>
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          {loading ? <Cargando /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200"><tr>
                <th className={`${TH} text-center w-10`}>
                  <input type="checkbox" title="Marcar todos los publicados/pausados de esta lista" aria-label="Marcar todos" disabled={marcablesVisibles.length === 0}
                    checked={marcablesVisibles.length > 0 && marcados.size === marcablesVisibles.length}
                    onChange={toggleMarcaTodas} className={CHECK} />
                </th>
                <th className={TH}>Beneficio y alcance</th><th className={TH}>Precio pactado</th><th className={TH}>Carga que lo activa</th><th className={TH}>Vigencia</th><th className={TH}>Quién lo activa</th><th className={TH}>Estado</th><th className={`${TH} text-center`}>Acciones</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {lista.map(p => (
                  <tr key={p.BenIdBeneficio} className={`transition-colors ${form?.id === p.BenIdBeneficio || marcados.has(p.BenIdBeneficio) ? 'bg-brand-cyan/5' : 'hover:bg-zinc-50'}`}>
                    <td className="px-4 py-3 align-top text-center">{checkFila(p)}</td>
                    <td className="px-4 py-3 align-top"><span className="font-black text-zinc-900">{p.nombre}</span>{p.descripcion && <span className="block text-[11px] text-zinc-500">{p.descripcion}</span>}</td>
                    <td className="px-4 py-3 align-top text-xs text-zinc-700">{(p.reglasTexto || []).map((t, i) => <span key={i} className="block">{t}</span>)}</td>
                    <td className="px-4 py-3 align-top whitespace-nowrap"><span className="font-bold text-zinc-900 tabular-nums">{sym(p.monedaId)} {fmtN(p.carga)}</span><span className="block text-[11px] text-zinc-400">{p.cargaEsMinimo ? 'monto mínimo' : 'monto fijo'}</span></td>
                    <td className="px-4 py-3 align-top text-xs">{vigenciaTexto(p)}</td>
                    <td className="px-4 py-3 align-top">{chipQuien(p)}</td>
                    <td className="px-4 py-3 align-top">{estadoCelda(p)}</td>
                    <td className="px-4 py-3 align-top">{acciones(p)}</td>
                  </tr>
                ))}
                {lista.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-14">
                    <div className="flex flex-col items-center text-center">
                      <BadgePercent size={40} className="mb-3 text-brand-cyan" />
                      <span className="text-sm font-bold text-zinc-700">Todavía no hay beneficios predefinidos.</span>
                      <span className="text-xs text-zinc-400 mt-1">Creá el primero con el botón de arriba.</span>
                    </div>
                  </td></tr>
                )}
              </tbody>
            </table></div>
          )}
          <div className="px-4 py-2.5 text-[11px] text-zinc-400 border-t border-zinc-100">Pausar una plantilla no toca los beneficios ya activados: esos siguen hasta agotarse o vencer. Marcá varias con el tilde de la izquierda para activarlas o desactivarlas juntas.</div>
        </div>
      )}

      {/* Nuevo / editar beneficio predefinido */}
      {form && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/40 p-4" onClick={e => e.target === e.currentTarget && setForm(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="px-6 py-4 flex items-start justify-between gap-3 border-b border-zinc-100 shrink-0">
              <div className="flex items-start gap-3 min-w-0">
                <BadgePercent size={24} className="text-brand-cyan shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">{form.id ? 'Editar beneficio predefinido' : 'Nuevo beneficio predefinido'}</p>
                  <h2 className="text-lg font-black text-zinc-900 truncate">{form.nombre || 'Sin nombre'}</h2>
                </div>
              </div>
              <button type="button" onClick={() => setForm(null)} aria-label="Cerrar"
                className="shrink-0 text-zinc-400 hover:text-brand-magenta w-9 h-9 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-5 overflow-y-auto">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><label className={lbl}>Nombre (así lo ve el cliente)</label><input value={form.nombre} onChange={e => f({ nombre: e.target.value })} className={inputCls} /></div>
                <div><label className={lbl}>Descripción corta (opcional)</label><input value={form.descripcion} onChange={e => f({ descripcion: e.target.value })} className={inputCls} /></div>
              </div>
              <div>
                <label className={lbl}>¿Quién puede activarlo?</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2" role="radiogroup">
                  <Opcion elegida={form.publico} onElegir={() => f({ publico: true })}>
                    <span className="block text-sm font-bold text-zinc-800">Todos los clientes, desde el portal</span>
                    <span className="block text-[11px] text-zinc-500">Aparece en «Beneficios para vos» y cada activación no pasa por aprobación.</span>
                  </Opcion>
                  <Opcion elegida={!form.publico} onElegir={() => f({ publico: false })}>
                    <span className="block text-sm font-bold text-zinc-800">Solo por pacto</span>
                    <span className="block text-[11px] text-zinc-500">El cliente no lo puede activar solo desde el portal: el vendedor lo usa de base para pactarlo y eso pasa por aprobación. Caja/Administración sí puede activarlo directo para cualquier cliente sin pactarlo, desde Venta de saldo.</span>
                  </Opcion>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className={lbl}>Moneda</label>
                  <div className="grid grid-cols-2 rounded-xl border border-zinc-200 bg-white p-1 gap-1" role="radiogroup">
                    {[{ v: 1, l: '$ pesos' }, { v: 2, l: 'US$ dólares' }].map(m => (
                      <button type="button" key={m.v} role="radio" aria-checked={form.monedaId === m.v} onClick={() => f({ monedaId: m.v })}
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${form.monedaId === m.v ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>{m.l}</button>
                    ))}
                  </div>
                </div>
                <div><label className={lbl}>Carga que lo activa ({sym(form.monedaId)})</label><input type="number" step="0.01" min="0" value={form.carga} onChange={e => f({ carga: e.target.value })} className={`${inputCls} tabular-nums`} /></div>
                <div>
                  <label className={lbl}>Tipo de carga</label>
                  <div className="grid grid-cols-2 rounded-xl border border-zinc-200 bg-white p-1 gap-1" role="radiogroup">
                    {[{ v: false, l: 'Monto fijo' }, { v: true, l: 'Monto mínimo' }].map(o => (
                      <button type="button" key={String(o.v)} role="radio" aria-checked={form.cargaEsMinimo === o.v} onClick={() => f({ cargaEsMinimo: o.v })}
                        title={o.v ? 'Puede cargar más' : ''}
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold transition-colors ${form.cargaEsMinimo === o.v ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>{o.l}</button>
                    ))}
                  </div>
                  {form.cargaEsMinimo && <p className="text-[11px] text-zinc-400 mt-1">El cliente puede cargar más.</p>}
                </div>
              </div>
              <div>
                <label className={lbl}>Vigencia</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2" role="radiogroup">
                  <Opcion elegida={form.vigenciaModo === 'DIAS'} onElegir={() => f({ vigenciaModo: 'DIAS' })}>
                    <span className="block text-sm font-bold text-zinc-800">Días desde la activación</span>
                  </Opcion>
                  <Opcion elegida={form.vigenciaModo === 'FECHA'} onElegir={() => f({ vigenciaModo: 'FECHA' })}>
                    <span className="block text-sm font-bold text-zinc-800">Hasta una fecha</span>
                  </Opcion>
                  <Opcion elegida={form.vigenciaModo === 'AGOTAR'} onElegir={() => f({ vigenciaModo: 'AGOTAR' })}>
                    <span className="block text-sm font-bold text-zinc-800">Hasta agotar el saldo</span>
                  </Opcion>
                </div>
                {form.vigenciaModo === 'DIAS' && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-zinc-600">
                    <input type="number" min="1" value={form.vigenciaDias} onChange={e => f({ vigenciaDias: e.target.value, vigenciaModo: 'DIAS' })} aria-label="Días de vigencia" className={`${inputCls.replace('w-full ', '')} w-24 text-center tabular-nums`} /> días desde que el cliente lo activa
                  </div>
                )}
                {form.vigenciaModo === 'FECHA' && (
                  <div className="mt-2 w-56">
                    <SelectorFecha className="w-full" value={form.vigenciaHasta} onChange={e => f({ vigenciaHasta: e.target.value, vigenciaModo: 'FECHA' })} aria-label="Vigente hasta" />
                  </div>
                )}
              </div>
              <div>
                <label className={lbl}>Alcance y precio pactado</label>
                <div><EditorReglasBeneficio value={form.reglas} onChange={reglas => f({ reglas })} monedaId={form.monedaId} /></div>
                <p className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2 mt-2">Mientras el beneficio esté vigente y tenga saldo, estos precios pisan la tarifa del cliente, común o especial. Al agotarse o vencer, el cliente vuelve solo a su tarifa.</p>
              </div>
            </div>
            <div className="px-6 py-3 border-t border-zinc-100 flex justify-end gap-2 shrink-0">
              <button type="button" onClick={() => setForm(null)} className={BTN_SECUNDARIO}>Cancelar</button>
              <button type="button" onClick={guardar} disabled={saving} className={BTN_PRINCIPAL}>
                {saving ? <><Loader2 size={15} className="animate-spin" /> Guardando…</> : meta.puedeAprobar ? 'Guardar y publicar' : 'Guardar y enviar a aprobación'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rechazar una plantilla: pide el motivo (antes, la ventana del navegador) */}
      {rechazo && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/40 p-4" onClick={e => e.target === e.currentTarget && setRechazo(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100">
              <h2 className="text-lg font-black text-zinc-900">Rechazar «{rechazo.p.nombre}»</h2>
              <p className="text-sm text-zinc-500 mt-0.5">La plantilla vuelve a borrador.</p>
            </div>
            <div className="px-6 py-5">
              <label htmlFor="motivo-rechazo" className={lbl}>Motivo (obligatorio)</label>
              <textarea id="motivo-rechazo" autoFocus rows={3} value={rechazo.motivo} onChange={e => setRechazo(r => ({ ...r, motivo: e.target.value }))}
                className={`${inputCls} resize-none`} />
            </div>
            <div className="px-6 py-3 border-t border-zinc-100 flex justify-end gap-2">
              <button type="button" onClick={() => setRechazo(null)} className={BTN_SECUNDARIO}>Cancelar</button>
              <button type="button" onClick={confirmarRechazo}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-magenta text-white text-sm font-bold hover:bg-brand-magenta/90 transition-colors">Rechazar</button>
            </div>
          </div>
        </div>
      )}

      {/* Quién más puede aprobar */}
      {aprobPanel && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/40 p-4" onClick={e => e.target === e.currentTarget && setAprobPanel(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden max-h-[88vh] flex flex-col">
            <div className="px-6 py-4 flex items-start justify-between gap-3 border-b border-zinc-100 shrink-0">
              <div className="flex items-start gap-3">
                <ShieldCheck size={22} className="text-brand-cyan shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Además de Admin y Administración</p>
                  <h2 className="text-lg font-black text-zinc-900">Quién más puede aprobar</h2>
                </div>
              </div>
              <button type="button" onClick={() => setAprobPanel(false)} aria-label="Cerrar"
                className="shrink-0 text-zinc-400 hover:text-brand-magenta w-9 h-9 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors"><X size={18} /></button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto">
              <p className="text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                Los roles <strong>Admin</strong> y <strong>Administracion</strong> siempre pueden aprobar/rechazar pactos y plantillas, pausar, cerrar bolsas y prender o apagar el interruptor general. Acá agregás, uno por uno, a cualquier otra persona puntual que también deba poder hacerlo, sin cambiarle el rol.
              </p>
              <div>
                <label className={lbl}>Agregar a alguien</label>
                <div className="flex gap-2">
                  <div className="flex-1 min-w-0">
                    <Selector className="w-full" value={String(candidatoSel)} onChange={e => setCandidatoSel(e.target.value)} aria-label="Persona" anchoLista={280}>
                      <option value="">— Elegir una persona —</option>
                      {candidatos.map(c => <option key={c.idUsuario} value={String(c.idUsuario)}>{c.nombre}{c.rol ? ` (${c.rol})` : ''}</option>)}
                    </Selector>
                  </div>
                  <button type="button" onClick={agregarAprob} disabled={!candidatoSel || aprobBusy} className={`${BTN_PRINCIPAL} shrink-0 py-2.5`}>Agregar</button>
                </div>
                {candidatos.length === 0 && <p className="text-[11px] text-zinc-400 mt-1">No quedan usuarios internos activos para agregar (o ya están todos en la lista, o ya aprueban por su rol).</p>}
              </div>
              <div>
                <label className={lbl}>Autorizados a mano ({aprobadores.length})</label>
                {aprobadores.length === 0 ? (
                  <p className="text-sm text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">Nadie todavía. Solo Admin y Administracion aprueban por ahora.</p>
                ) : (
                  <div className="divide-y divide-zinc-100 border border-zinc-200 rounded-xl overflow-hidden">
                    {aprobadores.map(a => (
                      <div key={a.idUsuario} className="flex items-center justify-between gap-2 px-3 py-2 bg-white">
                        <span className="text-sm"><span className="font-bold text-zinc-800">{a.nombre}</span>{a.rol && <span className="text-[11px] text-zinc-400"> · rol {a.rol}</span>}</span>
                        <button type="button" onClick={() => quitarAprob(a)} disabled={aprobBusy} title="Quitar de la lista" aria-label={`Quitar a ${a.nombre}`}
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 disabled:opacity-50 transition-colors"><X size={14} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {ventanaConfirmar}
    </div>
  );
}
