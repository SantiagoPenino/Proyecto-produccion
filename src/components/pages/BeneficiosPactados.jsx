// ─────────────────────────────────────────────────────────────────────────────
// Beneficios pactados — lista de aprobación y seguimiento (specs/40 RN-BEN.12..14).
// Ruta /beneficios/pactos (menú Ventas). El vendedor ve sus pactos; Administración
// ve todos, aprueba con nota, rechaza con motivo, cancela aprobados sin activar,
// carga en caja y pausa / reanuda / cierra los beneficios activos.
// APROBADO NO ES HABILITADO: nada cambia hasta que el cliente carga el saldo.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ListChecks, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { ModalVentaSaldo } from './ContabilidadCuentasView';
import ModalPactarBeneficio from '../beneficios/ModalPactarBeneficio';
import { benApi, sym, fmtN, fmtFecha, vigenciaTexto, EstadoBadge, Cargando } from '../beneficios/beneficiosUi';

const inputCls = 'border border-zinc-200 rounded-lg px-3 py-2 text-sm font-bold text-zinc-800 outline-none focus:border-cyan-500 bg-white';
const lbl = 'text-[10px] font-black text-zinc-400 uppercase tracking-widest';
const hoy = () => new Date().toISOString().slice(0, 10);
const hace = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };

export default function BeneficiosPactados() {
  const [rows, setRows] = useState([]);
  const [resumen, setResumen] = useState(null);
  const [puedeAprobar, setPuedeAprobar] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState({ cliente: '', estado: '', desde: hace(90), hasta: hoy() });
  const [sel, setSel] = useState(null);
  const [nota, setNota] = useState('');
  const [motivo, setMotivo] = useState('');
  const [ventaSaldo, setVentaSaldo] = useState(null); // { cliente, beneficio }
  const [pactoEditar, setPactoEditar] = useState(null); // pacto RECHAZADO a corregir

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (filtro.estado) q.set('estado', filtro.estado);
      if (filtro.desde) q.set('desde', filtro.desde);
      if (filtro.hasta) q.set('hasta', filtro.hasta);
      const r = await benApi.get(`/pactos?${q.toString()}`);
      setRows(r.data || []); setResumen(r.resumen || null); setPuedeAprobar(!!r.puedeAprobar);
      if (sel) setSel((r.data || []).find(x => x.BenIdBeneficio === sel.BenIdBeneficio) || null);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [filtro.estado, filtro.desde, filtro.hasta]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { cargar(); }, [cargar]);

  const visibles = useMemo(() => {
    const t = filtro.cliente.trim().toLowerCase();
    return t ? rows.filter(r => String(r.clienteNombre || '').toLowerCase().includes(t) || String(r.idCliente || '').toLowerCase().includes(t) || String(r.codCliente || '').includes(t)) : rows;
  }, [rows, filtro.cliente]);

  const decidir = async (p, acc) => {
    const esPlantilla = p.tipo === 'PLANTILLA';
    let body = {};
    if (acc === 'aprobar') {
      const peores = p.alertas?.peores || 0;
      if (peores > 0 && !nota.trim()) return toast.error(`Este pacto tiene ${peores} precio${peores > 1 ? 's' : ''} peor${peores > 1 ? 'es' : ''} que los actuales del cliente: escribí la nota para aprobarlo igual.`);
      if (!window.confirm(esPlantilla ? `Aprobar y publicar la plantilla "${p.nombre}". ¿Confirmás?` : `Aprobar el pacto "${p.nombre}" de ${p.clienteNombre}.\n\nQueda disponible para que el cliente lo active cargando ${sym(p.monedaId)} ${fmtN(p.carga)}. NINGÚN precio cambia hasta que esa carga se acredite. ¿Confirmás?`)) return;
      body = { nota };
    } else if (acc === 'rechazar') {
      if (!motivo.trim()) return toast.error('El motivo del rechazo es obligatorio.');
      if (!window.confirm(`Rechazar "${p.nombre}". El vendedor verá el motivo. ¿Confirmás?`)) return;
      body = { motivo };
    } else if (acc === 'cancelar') {
      const m = window.prompt(`Cancelar el pacto "${p.nombre}" (${p.estado === 'APROBADO' ? 'aprobado pero nunca cargado' : 'pendiente'}). No hay plata que devolver.\n\nMotivo (opcional):`);
      if (m == null) return;
      body = { motivo: m };
    }
    try {
      const r = await benApi.post(esPlantilla ? `/plantillas/${p.BenIdBeneficio}/${acc}` : `/pactos/${p.BenIdBeneficio}/${acc}`, body);
      toast.success(r.message || 'Listo', { duration: 9000 }); setNota(''); setMotivo(''); cargar();
    } catch (e) { toast.error(e.message, { duration: 9000 }); }
  };

  const bolsa = async (p, acc) => {
    const a = p.activacion; if (!a) return;
    const textos = {
      pausar: `Pausar el beneficio "${p.nombre}" de ${p.clienteNombre}: sus pedidos salen a la tarifa normal y el saldo (${sym(p.monedaId)} ${fmtN(a.Saldo)}) queda guardado hasta reanudar o cerrar. ¿Confirmás?`,
      reanudar: `Reanudar el beneficio "${p.nombre}": los precios pactados vuelven a aplicar. ¿Confirmás?`,
      cerrar: `Cerrar el beneficio "${p.nombre}" de ${p.clienteNombre}.\n\nEl saldo remanente (${sym(p.monedaId)} ${fmtN(a.Saldo)}) pasa a la billetera común del cliente, donde vale a tarifa normal y NUNCA sirve para activar otro beneficio. ¿Confirmás?`,
    };
    if (!window.confirm(textos[acc])) return;
    try { const r = await benApi.post(`/bolsas/${a.BclIdBeneficioCliente}/${acc}`); toast.success(r.message || 'Listo', { duration: 9000 }); cargar(); }
    catch (e) { toast.error(e.message, { duration: 9000 }); }
  };

  const kpi = (titulo, valor, sub, cls = 'bg-white border-zinc-200', numCls = 'text-zinc-800') => (
    <div className={`border rounded-2xl p-4 shadow-sm ${cls}`}><div className={lbl}>{titulo}</div><div className={`text-2xl font-black ${numCls}`}>{valor}</div><div className="text-[11px] text-zinc-500">{sub}</div></div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="max-w-7xl mx-auto px-4 py-8">
        <p className="text-[11px] text-zinc-500 mb-2">Vista 360 · Vendedores › pestaña Beneficios › <strong className="text-zinc-800">{puedeAprobar ? 'Beneficios pactados (lista de aprobación)' : 'Mis pactos'}</strong></p>
        <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-cyan-700 rounded-xl flex items-center justify-center shadow-lg"><ListChecks size={20} className="text-white" /></div>
            <div><h1 className="text-xl font-black text-zinc-900">Beneficios pactados</h1><p className="text-xs text-zinc-500">Pactos de vendedores con clientes: aprobación, activación y seguimiento del saldo. Aprobado no es habilitado: nada cambia hasta que el cliente carga.</p></div>
          </div>
          <button type="button" onClick={cargar} className="inline-flex items-center gap-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 font-bold text-xs px-4 py-2 rounded-xl shadow-sm"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualizar</button>
        </div>

        {resumen && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            {kpi('Pendientes de aprobación', resumen.pendientes, 'Esperan decisión', 'bg-amber-50 border-amber-300', 'text-amber-800')}
            {kpi('Aprobados sin activar', resumen.aprobadosSinActivar, 'El cliente aún no cargó el saldo', 'bg-white border-zinc-200', 'text-indigo-700')}
            {kpi('Activos', resumen.activos, `$ ${fmtN(resumen.saldoVivoUYU)} · US$ ${fmtN(resumen.saldoVivoUSD)} de saldo vivo`, 'bg-white border-zinc-200', 'text-emerald-700')}
            {kpi('Historial', resumen.historial, 'Agotados, vencidos, rechazados, cancelados')}
          </div>
        )}

        <div className="bg-white border border-zinc-200 rounded-2xl p-4 shadow-sm mb-5 flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1 flex-1 min-w-[180px]"><label className={lbl}>Cliente</label><input value={filtro.cliente} onChange={e => setFiltro(x => ({ ...x, cliente: e.target.value }))} placeholder="Nombre o código" className={inputCls} /></div>
          <div className="flex flex-col gap-1"><label className={lbl}>Estado</label><select value={filtro.estado} onChange={e => setFiltro(x => ({ ...x, estado: e.target.value }))} className={`${inputCls} min-w-[170px]`}><option value="">Todos</option><option value="PENDIENTE">Pendientes</option><option value="APROBADO">Aprobados sin activar</option><option value="ACTIVADO">Activados</option><option value="RECHAZADO">Rechazados</option><option value="CANCELADO">Cancelados</option></select></div>
          <div className="flex flex-col gap-1"><label className={lbl}>Desde</label><input type="date" value={filtro.desde} onChange={e => setFiltro(x => ({ ...x, desde: e.target.value }))} className={inputCls} /></div>
          <div className="flex flex-col gap-1"><label className={lbl}>Hasta</label><input type="date" value={filtro.hasta} onChange={e => setFiltro(x => ({ ...x, hasta: e.target.value }))} className={inputCls} /></div>
        </div>

        <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden mb-5">
          {loading && !rows.length ? <Cargando /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-black text-zinc-400 uppercase tracking-widest">
                <th className="px-3 py-3 text-left">Fecha</th><th className="px-3 py-3 text-left">Cliente / vendedor</th><th className="px-3 py-3 text-left">Beneficio</th><th className="px-3 py-3 text-left">Precios pactados</th><th className="px-3 py-3 text-right">Carga</th><th className="px-3 py-3 text-left">Vigencia</th><th className="px-3 py-3 text-left">Estado</th><th className="px-3 py-3 text-center">Acciones</th>
              </tr></thead>
              <tbody>
                {visibles.map(p => {
                  const a = p.activacion; const peores = p.alertas?.peores || 0;
                  const estadoBolsa = a?.BclEstado;
                  return (
                    <tr key={p.BenIdBeneficio} onClick={() => { setSel(p); setNota(''); setMotivo(''); }} className={`border-b border-zinc-100 cursor-pointer ${sel?.BenIdBeneficio === p.BenIdBeneficio ? 'bg-cyan-50/60' : p.estado === 'PENDIENTE' ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-3 py-3 align-top whitespace-nowrap text-xs">{fmtFecha(p.fechaAlta)}</td>
                      <td className="px-3 py-3 align-top"><span className="font-black text-zinc-900">{p.tipo === 'PLANTILLA' ? 'Plantilla para todos' : p.clienteNombre}</span><span className="block text-[11px] text-zinc-500">{p.vendedorNombre || '—'}</span></td>
                      <td className="px-3 py-3 align-top"><span className="font-bold">{p.nombre}</span><span className="block text-[11px] text-zinc-500">{p.tipo === 'PLANTILLA' ? `plantilla nueva${p.publico ? ' · pública' : ' · solo por pacto'}` : p.plantillaBaseNombre ? `base «${p.plantillaBaseNombre}»` : 'a medida'}{a ? ` · cuenta #${a.CueIdCuenta}` : ''}</span></td>
                      <td className="px-3 py-3 align-top text-xs">{(p.reglasTexto || []).map((t, i) => <span key={i} className="block">{t}</span>)}{peores > 0 && <span className="block text-rose-700 font-bold mt-0.5">{peores} precio{peores > 1 ? 's' : ''} peor{peores > 1 ? 'es' : ''} que los de hoy</span>}</td>
                      <td className="px-3 py-3 align-top text-right whitespace-nowrap"><span className="font-bold">{sym(p.monedaId)} {fmtN(p.carga)}</span><span className="block text-[11px] text-zinc-500">{p.cargaEsMinimo ? 'mínimo' : 'fijo'}{a ? ` · cargado ${fmtFecha(a.BclFechaActivacion)}` : ''}</span></td>
                      <td className="px-3 py-3 align-top text-xs">{a?.BclFechaVencimiento ? `Vence ${fmtFecha(a.BclFechaVencimiento)}` : vigenciaTexto(p)}</td>
                      <td className="px-3 py-3 align-top">
                        <EstadoBadge estado={estadoBolsa || p.estado} />
                        {p.estado === 'APROBADO' && !a && <span className="block text-[11px] text-amber-700 font-bold mt-1">No habilitado: el cliente no cargó el saldo todavía</span>}
                        {a && <span className="block text-[11px] text-zinc-600 mt-1">Saldo {sym(p.monedaId)} {fmtN(a.Saldo)} · {a.Consumos} pedido{a.Consumos !== 1 ? 's' : ''}</span>}
                      </td>
                      <td className="px-3 py-3 align-top" onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col gap-1.5 items-center">
                          {p.estado === 'PENDIENTE' && puedeAprobar && <button type="button" onClick={() => { setSel(p); setNota(''); }} className="px-2.5 py-1 text-[11px] font-bold text-white bg-emerald-600 rounded-lg">Revisar y aprobar</button>}
                          {p.estado === 'PENDIENTE' && !puedeAprobar && p.tipo === 'PACTO' && <button type="button" onClick={() => decidir(p, 'cancelar')} className="px-2.5 py-1 text-[11px] font-bold text-zinc-700 bg-white border border-zinc-200 rounded-lg">Cancelar</button>}
                          {p.estado === 'RECHAZADO' && p.tipo === 'PACTO' && <button type="button" onClick={() => setPactoEditar(p)} title="Corregir este pacto y reenviarlo a aprobación" className="px-2.5 py-1 text-[11px] font-bold text-white bg-amber-600 hover:bg-amber-700 rounded-lg whitespace-nowrap">Editar y reenviar</button>}
                          {p.estado === 'APROBADO' && puedeAprobar && <button type="button" onClick={() => setVentaSaldo({ cliente: { CliIdCliente: p.cliId, Nombre: p.clienteNombre }, beneficio: p })} className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-white border border-emerald-200 rounded-lg whitespace-nowrap">Cargar en caja</button>}
                          {p.estado === 'APROBADO' && <button type="button" onClick={() => decidir(p, 'cancelar')} className="px-2.5 py-1 text-[11px] font-bold text-zinc-700 bg-white border border-zinc-200 rounded-lg">Cancelar</button>}
                          {a && estadoBolsa === 'ACTIVO' && puedeAprobar && <button type="button" onClick={() => bolsa(p, 'pausar')} className="px-2.5 py-1 text-[11px] font-bold text-amber-800 bg-white border border-amber-200 rounded-lg">Pausar</button>}
                          {a && estadoBolsa === 'PAUSADO' && puedeAprobar && <button type="button" onClick={() => bolsa(p, 'reanudar')} className="px-2.5 py-1 text-[11px] font-bold text-emerald-700 bg-white border border-emerald-200 rounded-lg">Reanudar</button>}
                          {a && ['ACTIVO', 'PAUSADO', 'VENCIDO', 'AGOTADO'].includes(estadoBolsa) && puedeAprobar && <button type="button" onClick={() => bolsa(p, 'cerrar')} className="px-2.5 py-1 text-[11px] font-bold text-amber-800 bg-white border border-amber-200 rounded-lg whitespace-nowrap">Cerrar{a.Saldo > 0.009 ? ` · pasar ${sym(p.monedaId)} ${fmtN(a.Saldo)} a la billetera` : ''}</button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visibles.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-zinc-400">No hay pactos con estos filtros.</td></tr>}
              </tbody>
            </table></div>
          )}
        </div>

        {sel && (
          <div className="bg-white border-2 border-amber-300 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-4 flex-wrap">
              <div><div className="text-[10px] font-black text-amber-700 uppercase tracking-widest">Revisar {sel.tipo === 'PLANTILLA' ? 'plantilla' : 'pacto'} #{sel.BenIdBeneficio}</div><div className="text-base font-black text-zinc-900">{sel.tipo === 'PLANTILLA' ? sel.nombre : `${sel.clienteNombre} · «${sel.nombre}»`} · propuesto por {sel.vendedorNombre || '—'} el {fmtFecha(sel.fechaAlta)}</div></div>
              {sel.nota && <span className="text-[11px] text-amber-900 max-w-xl">Nota del vendedor: «{sel.nota}»</span>}
              <button type="button" onClick={() => setSel(null)} className="text-xs font-bold text-zinc-500 underline">Cerrar</button>
            </div>
            <div className="p-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
              <div className="space-y-3">
                {(sel.alertas?.peores || 0) > 0 && (
                  <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 text-xs text-rose-800"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span><strong>{sel.alertas.peores} precio{sel.alertas.peores > 1 ? 's' : ''} peor{sel.alertas.peores > 1 ? 'es' : ''} que los que el cliente paga hoy.</strong> Se puede aprobar igual, pero la nota es obligatoria y queda en el pacto.</span></div>
                )}
                <table className="w-full text-xs border border-zinc-200 rounded-lg overflow-hidden">
                  <thead><tr className="bg-zinc-50 text-[10px] font-black text-zinc-400 uppercase tracking-widest"><th className="px-3 py-2 text-left">Aplica a</th><th className="px-3 py-2 text-right">Lista</th><th className="px-3 py-2 text-right">Precio actual</th><th className="px-3 py-2 text-right">Pactado</th><th className="px-3 py-2 text-right">Dif. vs lista</th></tr></thead>
                  <tbody>
                    {(sel.alertas?.reglas || sel.reglasTexto?.map(t => ({ texto: t })) || []).map((r, i) => (
                      <React.Fragment key={i}>
                        <tr className={`border-t border-zinc-100 ${r.peor ? 'bg-rose-50/60' : ''}`}>
                          <td className="px-3 py-2 font-bold text-zinc-800">{r.texto}</td>
                          <td className="px-3 py-2 text-right font-mono">{r.lista != null ? `${sym(sel.monedaId)} ${fmtN(r.lista)}` : <span className="text-zinc-400">según artículo</span>}</td>
                          <td className="px-3 py-2 text-right font-mono">{r.actual != null ? `${sym(sel.monedaId)} ${fmtN(r.actual)}` : <span className="text-zinc-400">varía</span>}</td>
                          <td className="px-3 py-2 text-right font-mono font-black">{r.pactado != null ? `${sym(sel.monedaId)} ${fmtN(r.pactado)}` : '—'}</td>
                          <td className={`px-3 py-2 text-right font-black ${r.peor ? 'text-rose-700' : 'text-emerald-700'}`}>{r.difPct != null ? `${r.difPct > 0 ? '+' : ''}${fmtN(r.difPct, 0)} %${r.peor ? ' · peor' : ''}` : (r.peor ? 'peor' : '—')}</td>
                        </tr>
                        {(r.detalle || []).filter(d => d.peor).map((d, k) => <tr key={`${i}-${k}`} className="bg-rose-50"><td colSpan={5} className="px-3 py-1.5 text-[11px] text-rose-700">{d.descripcion || d.cod}: paga hoy {sym(sel.monedaId)} {fmtN(d.actual)} y el pacto le da {sym(sel.monedaId)} {fmtN(d.pactado)}.</td></tr>)}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
                <div className="grid grid-cols-3 gap-3 text-xs">
                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"><div className={lbl}>Carga que lo activa</div><div className="font-black">{sym(sel.monedaId)} {fmtN(sel.carga)} · {sel.cargaEsMinimo ? 'mínimo' : 'fijo'}</div></div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"><div className={lbl}>Vigencia</div><div className="font-black">{vigenciaTexto(sel)}</div></div>
                  <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2"><div className={lbl}>Estado</div><div><EstadoBadge estado={sel.activacion?.BclEstado || sel.estado} /></div></div>
                </div>
                <p className="text-xs text-slate-600 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-2"><strong>Qué pasa al aprobar:</strong> {sel.tipo === 'PLANTILLA' ? 'la plantilla queda publicada y cada cliente la activa cargando el saldo; esas activaciones no pasan por acá.' : `el pacto queda disponible para que el cliente lo active cargando ${sym(sel.monedaId)} ${fmtN(sel.carga)}, desde el portal o en caja. Ningún precio cambia hasta que esa carga se acredite. Si nunca la hace, se cancela desde esta lista.`}</p>
                {sel.notaAprobador && <p className="text-xs text-emerald-800"><CheckCircle2 size={12} className="inline mr-1" />Nota de quien aprobó ({sel.aprobadorNombre || '—'}, {fmtFecha(sel.fechaAprobacion)}): «{sel.notaAprobador}»</p>}
                {sel.motivoRechazo && <p className="text-xs text-rose-700">Motivo del rechazo / cancelación: «{sel.motivoRechazo}»</p>}
              </div>
              {sel.estado === 'PENDIENTE' && puedeAprobar && (
                <div className="space-y-2.5">
                  <label className={lbl}>Nota de quien aprueba (queda en el pacto{(sel.alertas?.peores || 0) > 0 ? ' · obligatoria por los precios peores' : ''})</label>
                  <textarea rows={3} value={nota} onChange={e => setNota(e.target.value)} className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white" />
                  <button type="button" onClick={() => decidir(sel, 'aprobar')} className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold uppercase tracking-widest bg-emerald-600 text-white rounded-lg"><CheckCircle2 size={14} /> Aprobar {sel.tipo === 'PLANTILLA' ? 'y publicar' : 'pacto'}</button>
                  <label className={lbl}>Motivo del rechazo (obligatorio para rechazar)</label>
                  <textarea rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm bg-white" />
                  <button type="button" onClick={() => decidir(sel, 'rechazar')} className="w-full px-4 py-2.5 text-xs font-bold uppercase tracking-widest bg-white text-rose-700 border border-rose-200 rounded-lg">Rechazar</button>
                  <p className="text-[11px] text-zinc-500 text-center">Un vendedor no puede aprobar su propio pacto.</p>
                </div>
              )}
              {sel.estado === 'PENDIENTE' && !puedeAprobar && <p className="text-xs text-zinc-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">Solo Administración aprueba o rechaza. Podés cancelarlo desde la lista si ya no corresponde.</p>}
            </div>
          </div>
        )}
      </div>
      {ventaSaldo && <ModalVentaSaldo cliente={ventaSaldo.cliente} beneficioPreset={ventaSaldo.beneficio} onClose={() => setVentaSaldo(null)} onSuccess={cargar} />}
      {pactoEditar && <ModalPactarBeneficio cliente={{ CliIdCliente: pactoEditar.cliId, Nombre: pactoEditar.clienteNombre }} pactoExistente={pactoEditar} onClose={() => setPactoEditar(null)} onSuccess={cargar} />}
    </div>
  );
}
