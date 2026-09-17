// ─────────────────────────────────────────────────────────────────────────────
// Pactar beneficio con el cliente (specs/40 RN-BEN.09/10/11). Es una PROPUESTA:
// va a la lista de aprobación y no cambia ningún precio hasta que se apruebe y el
// cliente cargue el saldo. Muestra por artículo lista / especial / beneficios
// activos / pactado, y marca cada precio peor que el actual del cliente.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import EditorReglasBeneficio from './EditorReglasBeneficio';
import { benApi, sym, fmtN, vigenciaTexto } from './beneficiosUi';

export default function ModalPactarBeneficio({ cliente, plantillaBaseId = null, pactoExistente = null, onClose, onSuccess }) {
  const [plantillas, setPlantillas] = useState([]);
  const [baseId, setBaseId] = useState(plantillaBaseId ? String(plantillaBaseId) : '');
  const [form, setForm] = useState(pactoExistente ? {
    nombre: pactoExistente.nombre, descripcion: pactoExistente.descripcion || '', monedaId: pactoExistente.monedaId,
    carga: pactoExistente.carga, cargaEsMinimo: pactoExistente.cargaEsMinimo,
    vigenciaModo: pactoExistente.vigenciaHasta ? 'FECHA' : pactoExistente.vigenciaDias ? 'DIAS' : 'AGOTAR',
    vigenciaDias: pactoExistente.vigenciaDias || 90, vigenciaHasta: pactoExistente.vigenciaHasta || '', nota: pactoExistente.nota || '',
  } : { nombre: '', descripcion: '', monedaId: 1, carga: '', cargaEsMinimo: false, vigenciaModo: 'DIAS', vigenciaDias: 90, vigenciaHasta: '', nota: '' });
  const [reglas, setReglas] = useState(pactoExistente ? (pactoExistente.reglas || []).map(r => ({ ...r, codArticulo: r.codArticulo || '', codGrupo: r.codGrupo || '', areaId: r.areaId || '' })) : []);
  const [evalu, setEvalu] = useState(null);
  const [evaluando, setEvaluando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const timer = useRef(null);
  const f = (patch) => setForm(x => ({ ...x, ...patch }));

  // Editando un pacto RECHAZADO no se elige base de nuevo: se corrige ESTE pacto puntual.
  useEffect(() => { if (!pactoExistente) benApi.get('/plantillas?estado=PUBLICADA').then(r => setPlantillas(r.data || [])).catch(() => {}); }, [pactoExistente]);
  useEffect(() => {
    if (pactoExistente || !baseId) return;
    const p = plantillas.find(x => String(x.BenIdBeneficio) === String(baseId));
    if (!p) return;
    // El nombre se completa con el del cliente para que se vea, desde el arranque, que esto
    // es un pacto NUEVO y propio de este cliente — no la plantilla en sí (esa no se toca).
    const nombreCliCorto = String(cliente?.Nombre || '').trim().split(' ').slice(0, 2).join(' ');
    f({ nombre: nombreCliCorto ? `${p.nombre} · ${nombreCliCorto}` : p.nombre, descripcion: p.descripcion || '', monedaId: p.monedaId, carga: p.carga, cargaEsMinimo: p.cargaEsMinimo,
        vigenciaModo: p.vigenciaHasta ? 'FECHA' : p.vigenciaDias ? 'DIAS' : 'AGOTAR', vigenciaDias: p.vigenciaDias || 90, vigenciaHasta: p.vigenciaHasta || '' });
    setReglas((p.reglas || []).map(r => ({ ...r, valor: r.valor, codArticulo: r.codArticulo || '', codGrupo: r.codGrupo || '', areaId: r.areaId || '' })));
  }, [baseId, plantillas]);

  // Evaluación de precios: lista / especial / activos / pactado, con alertas (con debounce)
  const reglasCompletas = useMemo(() => reglas.filter(r => Number(r.valor) > 0 && ((r.alcance === 'ARTICULO' && (r.proIdProducto || r.codArticulo)) || (r.alcance === 'GRUPO' && r.codGrupo) || (r.alcance === 'AREA' && r.areaId))), [reglas]);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!reglasCompletas.length) { setEvalu(null); return; }
    timer.current = setTimeout(async () => {
      setEvaluando(true);
      try { const r = await benApi.post('/evaluar', { cliId: cliente.CliIdCliente, monedaId: form.monedaId, reglas: reglasCompletas }); setEvalu(r.data); }
      catch (e) { toast.error(e.message); }
      finally { setEvaluando(false); }
    }, 600);
    return () => timer.current && clearTimeout(timer.current);
  }, [reglasCompletas, form.monedaId, cliente?.CliIdCliente]);

  const aprox = useMemo(() => {
    const fija = reglasCompletas.find(r => r.tipo === 'fixed');
    return fija && Number(form.carga) > 0 ? Math.floor(Number(form.carga) / Number(fija.valor)) : null;
  }, [reglasCompletas, form.carga]);

  const enviar = async () => {
    if (!form.nombre.trim()) return toast.error('Poné un nombre al beneficio.');
    if (!(Number(form.carga) > 0)) return toast.error('La carga pactada debe ser mayor a 0.');
    if (!reglasCompletas.length) return toast.error('Agregá al menos una regla de precio completa.');
    setEnviando(true);
    try {
      const body = {
        cliId: cliente.CliIdCliente, plantillaBaseId: baseId ? Number(baseId) : null,
        nombre: form.nombre, descripcion: form.descripcion, monedaId: form.monedaId, carga: Number(form.carga), cargaEsMinimo: form.cargaEsMinimo,
        vigenciaDias: form.vigenciaModo === 'DIAS' ? Number(form.vigenciaDias) : null,
        vigenciaHasta: form.vigenciaModo === 'FECHA' ? form.vigenciaHasta : null,
        nota: form.nota, reglas: reglasCompletas,
      };
      const r = pactoExistente ? await benApi.put(`/pactos/${pactoExistente.BenIdBeneficio}`, body) : await benApi.post('/pactos', body);
      toast.success(r.message || (pactoExistente ? 'Pacto corregido y reenviado a aprobación.' : 'Pacto enviado a aprobación.'), { duration: 8000 });
      onSuccess?.(r.data); onClose();
    } catch (e) { toast.error(e.message, { duration: 8000 }); }
    finally { setEnviando(false); }
  };

  const peores = evalu?.peores || 0;
  const s = sym(form.monedaId);
  const inputCls = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-cyan-400/30';

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 overflow-y-auto" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-[#f1f5f9] rounded-2xl shadow-2xl w-full max-w-4xl overflow-hidden my-6">
        <div className="px-6 py-4 flex items-center justify-between bg-gradient-to-r from-cyan-700 to-cyan-900 text-white">
          <div>
            <p className="text-xs uppercase tracking-widest opacity-80">{cliente?.Nombre} · #{cliente?.IDCliente || cliente?.CodCliente || cliente?.CliIdCliente}</p>
            <h2 className="text-lg font-black mt-0.5">{pactoExistente ? 'Corregir pacto rechazado' : 'Pactar beneficio con el cliente'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg"><X size={16} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {pactoExistente ? (
            <div className="bg-rose-50 border border-rose-200 rounded-lg px-3 py-2 space-y-1">
              <p className="text-[11px] text-rose-800"><strong>Rechazado</strong> el {pactoExistente.fechaAprobacion ? new Date(pactoExistente.fechaAprobacion).toLocaleDateString('es-UY') : ''} por {pactoExistente.aprobadorNombre || 'quien aprueba'}: <strong>{pactoExistente.motivoRechazo || 'sin motivo detallado'}</strong></p>
              <p className="text-[11px] text-slate-600">Corregí lo que haga falta y volvé a enviarlo. No hace falta empezar de cero: se reenvía este mismo pacto, a la lista de aprobación de nuevo.</p>
            </div>
          ) : (
            <p className="text-[11px] text-slate-600 bg-cyan-50 border border-cyan-200 rounded-lg px-3 py-2">
              Esto es una <strong>propuesta</strong>: pasa por la lista de aprobación y, una vez aprobada, el cliente la activa cargando el saldo pactado. <strong>Hasta ese momento no cambia ningún precio.</strong>
            </p>
          )}

          {!pactoExistente && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Base del pacto</label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setBaseId('')} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${!baseId ? 'bg-cyan-700 text-white border-cyan-700' : 'bg-white text-slate-600 border-slate-200'}`}>A medida</button>
              {plantillas.map(p => (
                <button type="button" key={p.BenIdBeneficio} onClick={() => setBaseId(String(p.BenIdBeneficio))} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${String(baseId) === String(p.BenIdBeneficio) ? 'bg-cyan-700 text-white border-cyan-700' : 'bg-white text-slate-600 border-slate-200'}`}>{p.nombre}</button>
              ))}
            </div>
            <span className="block text-[11px] text-slate-500 mt-1">Elegir una plantilla precarga precios, carga y vigencia como punto de partida. <strong>Esto NO edita la plantilla</strong>: crea un pacto nuevo y separado, exclusivo para {cliente?.Nombre ? String(cliente.Nombre).trim().split(' ').slice(0, 2).join(' ') : 'este cliente'}. Cambiá lo que necesites sin miedo: la plantilla original sigue intacta para todos los demás. Las plantillas se crean y editan en la página Beneficios predefinidos, no acá.</span>
          </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Nombre del beneficio</label>
              <input value={form.nombre} onChange={e => f({ nombre: e.target.value })} placeholder='Ej: "Sublimación a $ 180/m"' className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Moneda</label>
              <div className="grid grid-cols-2 gap-2">
                {[{ v: 1, l: '$ pesos' }, { v: 2, l: 'US$ dólares' }].map(m => (
                  <button type="button" key={m.v} onClick={() => f({ monedaId: m.v })} className={`px-3 py-2 rounded-lg text-xs font-semibold border ${form.monedaId === m.v ? 'bg-cyan-700 text-white border-cyan-700' : 'bg-white text-slate-600 border-slate-200'}`}>{m.l}</button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Carga pactada ({s})</label>
              <input type="number" step="0.01" min="0" value={form.carga} onChange={e => f({ carga: e.target.value })} className={`${inputCls} font-mono`} />
              {aprox != null && <span className="block text-[11px] text-slate-500 mt-1">≈ {aprox} unidades al precio pactado</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-slate-600">
            <label className="flex items-center gap-2"><input type="radio" checked={!form.cargaEsMinimo} onChange={() => f({ cargaEsMinimo: false })} /> Monto fijo: el cliente carga exactamente eso</label>
            <label className="flex items-center gap-2"><input type="radio" checked={form.cargaEsMinimo} onChange={() => f({ cargaEsMinimo: true })} /> Monto mínimo: puede cargar más</label>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Vigencia</label>
            <div className="flex flex-wrap gap-2">
              <label className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold ${form.vigenciaModo === 'DIAS' ? 'border-cyan-400 bg-cyan-50 text-slate-800' : 'border-slate-200 bg-white text-slate-600'}`}>
                <input type="radio" checked={form.vigenciaModo === 'DIAS'} onChange={() => f({ vigenciaModo: 'DIAS' })} />
                <input type="number" min="1" value={form.vigenciaDias} onChange={e => f({ vigenciaDias: e.target.value, vigenciaModo: 'DIAS' })} className="w-14 border border-slate-200 rounded px-1 py-0.5 text-center" /> días desde que se acredite la carga
              </label>
              <label className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold ${form.vigenciaModo === 'FECHA' ? 'border-cyan-400 bg-cyan-50 text-slate-800' : 'border-slate-200 bg-white text-slate-600'}`}>
                <input type="radio" checked={form.vigenciaModo === 'FECHA'} onChange={() => f({ vigenciaModo: 'FECHA' })} /> Hasta una fecha
                <input type="date" value={form.vigenciaHasta} onChange={e => f({ vigenciaHasta: e.target.value, vigenciaModo: 'FECHA' })} className="border border-slate-200 rounded px-1 py-0.5" />
              </label>
              <label className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold ${form.vigenciaModo === 'AGOTAR' ? 'border-cyan-400 bg-cyan-50 text-slate-800' : 'border-slate-200 bg-white text-slate-600'}`}>
                <input type="radio" checked={form.vigenciaModo === 'AGOTAR'} onChange={() => f({ vigenciaModo: 'AGOTAR' })} /> Hasta agotar el saldo
              </label>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Productos y precios pactados</label>
            <EditorReglasBeneficio value={reglas} onChange={setReglas} monedaId={form.monedaId} />
          </div>

          {/* Comparación: lista / especial / beneficios activos / pactado — y alertas de precio peor */}
          {(evalu || evaluando) && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                <span className="text-[10px] font-black text-slate-500 uppercase tracking-widest">Qué paga hoy el cliente vs. lo pactado{evaluando ? ' · calculando…' : ''}</span>
                {peores > 0 && <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700"><AlertTriangle size={12} /> {peores} precio{peores > 1 ? 's' : ''} peor{peores > 1 ? 'es' : ''} que los actuales</span>}
              </div>
              <table className="w-full text-xs">
                <thead><tr className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                  <th className="px-3 py-2 text-left">Aplica a</th><th className="px-3 py-2 text-right">Lista</th><th className="px-3 py-2 text-right">Especial del cliente</th><th className="px-3 py-2 text-left">Beneficio activo</th><th className="px-3 py-2 text-right">Pactado</th><th className="px-3 py-2 text-right">Dif. vs lista</th>
                </tr></thead>
                <tbody>
                  {(evalu?.reglas || []).map((r, i) => (
                    <React.Fragment key={i}>
                      <tr className={`border-t border-slate-100 ${r.peor ? 'bg-rose-50/60' : ''}`}>
                        <td className="px-3 py-2 font-bold text-slate-800">{r.texto}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.lista != null ? `${s} ${fmtN(r.lista)}` : <span className="text-slate-400">según artículo</span>}</td>
                        <td className="px-3 py-2 text-right font-mono">{r.actual != null ? (r.actual !== r.lista ? `${s} ${fmtN(r.actual)}` : <span className="text-slate-400">no tiene</span>) : <span className="text-slate-400">varía</span>}</td>
                        <td className="px-3 py-2 text-violet-700 font-semibold">{r.activosQueAlcanzan?.length ? r.activosQueAlcanzan.map(a => `«${a.nombre}»${a.masEspecifico ? ' (más específico, sigue con ese)' : ''}`).join(', ') : <span className="text-slate-400 font-normal">ninguno</span>}</td>
                        <td className="px-3 py-2 text-right font-mono font-black">{r.pactado != null ? `${s} ${fmtN(r.pactado)}` : (r.tipo === 'percentage' ? `−${r.valor} % sobre lista` : '—')}</td>
                        <td className={`px-3 py-2 text-right font-black ${r.peor ? 'text-rose-700' : 'text-emerald-700'}`}>{r.difPct != null ? `${r.difPct > 0 ? '+' : ''}${fmtN(r.difPct, 0)} %` : (r.peor ? 'peor' : '—')}</td>
                      </tr>
                      {r.detalle.filter(d => d.peor).map((d, k) => (
                        <tr key={`${i}-${k}`} className="bg-rose-50"><td colSpan={6} className="px-3 py-1.5 text-[11px] text-rose-700 font-semibold flex items-center gap-2"><AlertTriangle size={12} className="shrink-0" /> {d.descripcion || d.cod}: el precio pactado ({s} {fmtN(d.pactado)}) es PEOR que lo que el cliente paga hoy ({s} {fmtN(d.actual)}). Si lo dejás, quien aprueba lo va a ver marcado así.</td></tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Nota para quien aprueba</label>
            <textarea rows={2} value={form.nota} onChange={e => f({ nota: e.target.value })} className={inputCls} placeholder="Por qué conviene este pacto (volumen comprometido, contexto del cliente…)" />
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200">Cancelar</button>
            <button type="button" onClick={enviar} disabled={enviando} className="flex-1 px-4 py-2.5 text-xs font-bold uppercase tracking-widest bg-cyan-700 text-white rounded-lg hover:bg-cyan-800 disabled:opacity-50">
              {enviando ? 'Enviando…' : pactoExistente ? 'Corregir y reenviar a aprobación →' : 'Enviar a aprobación →'}
            </button>
          </div>
          <p className="text-[10px] text-slate-500 text-center">Vigencia elegida: {vigenciaTexto({ vigenciaDias: form.vigenciaModo === 'DIAS' ? form.vigenciaDias : null, vigenciaHasta: form.vigenciaModo === 'FECHA' ? form.vigenciaHasta : null })}.</p>
        </div>
      </div>
    </div>
  );
}
