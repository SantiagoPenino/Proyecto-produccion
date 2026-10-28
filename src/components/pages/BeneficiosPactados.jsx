// ─────────────────────────────────────────────────────────────────────────────
// Beneficios pactados — lista de aprobación y seguimiento (specs/40 RN-BEN.12..14).
// Ruta /beneficios/pactos (menú Ventas). El vendedor ve sus pactos; Administración
// ve todos, aprueba con nota, rechaza con motivo, cancela aprobados sin activar,
// carga en caja y pausa / reanuda / cierra los beneficios activos.
// APROBADO NO ES HABILITADO: nada cambia hasta que el cliente carga el saldo.
// Estética nueva (28/10/2026): encabezado, resumen, filtros con Selector/SelectorFecha, tabla clara (en el celular, una
// tarjeta por pacto), panel de revisión claro y las confirmaciones con la ventana del sistema (antes window.confirm /
// window.prompt). ModalVentaSaldo, ModalPactarBeneficio y EstadoBadge son compartidos: no se tocaron.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ListChecks, RefreshCw, AlertTriangle, CheckCircle2, Search, X } from 'lucide-react';
import { toast } from 'sonner';
import { ModalVentaSaldo } from './cuentasComunes';
import ModalPactarBeneficio from '../beneficios/ModalPactarBeneficio';
import { benApi, sym, fmtN, fmtFecha, vigenciaTexto, EstadoBadge, Cargando } from '../beneficios/beneficiosUi';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import useConfirmar from '../ui/useConfirmar';

const lbl = 'block text-[10px] font-black text-zinc-400 uppercase tracking-widest mb-1.5';
const hoy = () => new Date().toISOString().slice(0, 10);
const hace = (d) => { const x = new Date(); x.setDate(x.getDate() - d); return x.toISOString().slice(0, 10); };
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-4 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CAMPO_TEXTO = 'w-full px-3 py-2 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const TH = 'px-4 py-3 text-left text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const ACCION = 'px-2.5 py-1.5 rounded-lg border border-zinc-200 bg-white text-xs font-bold text-zinc-700 transition-colors whitespace-nowrap';
const ACCION_PRINCIPAL = 'px-2.5 py-1.5 rounded-lg bg-brand-cyan text-white text-xs font-bold hover:bg-brand-cyan/90 transition-colors whitespace-nowrap';

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
  const [confirmar, ventanaConfirmar] = useConfirmar();
  const conTabla = useConTabla();
  const [cancelacion, setCancelacion] = useState(null); // { p, motivo }: cancelar un pacto pide el motivo (opcional)

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
      if (!(await confirmar({ titulo: esPlantilla ? 'Aprobar y publicar' : 'Aprobar el pacto', texto: esPlantilla ? `Aprobar y publicar la plantilla "${p.nombre}". ¿Confirmás?` : `Aprobar el pacto "${p.nombre}" de ${p.clienteNombre}.\n\nQueda disponible para que el cliente lo active cargando ${sym(p.monedaId)} ${fmtN(p.carga)}. NINGÚN precio cambia hasta que esa carga se acredite. ¿Confirmás?`, confirmar: 'Aprobar' }))) return;
      body = { nota };
    } else if (acc === 'rechazar') {
      if (!motivo.trim()) return toast.error('El motivo del rechazo es obligatorio.');
      if (!(await confirmar({ titulo: 'Rechazar', texto: `Rechazar "${p.nombre}". El vendedor verá el motivo. ¿Confirmás?`, confirmar: 'Rechazar', peligro: true }))) return;
      body = { motivo };
    } else if (acc === 'cancelar') {
      setCancelacion({ p, motivo: '' }); return;
    }
    try {
      const r = await benApi.post(esPlantilla ? `/plantillas/${p.BenIdBeneficio}/${acc}` : `/pactos/${p.BenIdBeneficio}/${acc}`, body);
      toast.success(r.message || 'Listo', { duration: 9000 }); setNota(''); setMotivo(''); cargar();
    } catch (e) { toast.error(e.message, { duration: 9000 }); }
  };
  // Cancelar: el motivo (opcional) se pide en una ventana propia (antes, window.prompt). Mismo pedido a la API.
  const confirmarCancelacion = async () => {
    const { p, motivo: m } = cancelacion;
    const esPlantilla = p.tipo === 'PLANTILLA';
    try {
      const r = await benApi.post(esPlantilla ? `/plantillas/${p.BenIdBeneficio}/cancelar` : `/pactos/${p.BenIdBeneficio}/cancelar`, { motivo: m });
      toast.success(r.message || 'Listo', { duration: 9000 }); setNota(''); setMotivo(''); setCancelacion(null); cargar();
    } catch (e) { toast.error(e.message, { duration: 9000 }); }
  };

  const bolsa = async (p, acc) => {
    const a = p.activacion; if (!a) return;
    const textos = {
      pausar: `Pausar el beneficio "${p.nombre}" de ${p.clienteNombre}: sus pedidos salen a la tarifa normal y el saldo (${sym(p.monedaId)} ${fmtN(a.Saldo)}) queda guardado hasta reanudar o cerrar. ¿Confirmás?`,
      reanudar: `Reanudar el beneficio "${p.nombre}": los precios pactados vuelven a aplicar. ¿Confirmás?`,
      cerrar: `Cerrar el beneficio "${p.nombre}" de ${p.clienteNombre}.\n\nEl saldo remanente (${sym(p.monedaId)} ${fmtN(a.Saldo)}) pasa a la billetera común del cliente, donde vale a tarifa normal y NUNCA sirve para activar otro beneficio. ¿Confirmás?`,
    };
    const titulos = { pausar: 'Pausar el beneficio', reanudar: 'Reanudar el beneficio', cerrar: 'Cerrar el beneficio' };
    const botones = { pausar: 'Pausar', reanudar: 'Reanudar', cerrar: 'Cerrar' };
    if (!(await confirmar({ titulo: titulos[acc], texto: textos[acc], confirmar: botones[acc], peligro: acc === 'cerrar' }))) return;
    try { const r = await benApi.post(`/bolsas/${a.BclIdBeneficioCliente}/${acc}`); toast.success(r.message || 'Listo', { duration: 9000 }); cargar(); }
    catch (e) { toast.error(e.message, { duration: 9000 }); }
  };


  // ── Piezas del render ───────────────────────────────────────────────────────
  const kpi = (titulo, valor, sub, colorNum = 'text-zinc-900', destacar = false) => (
    <div className={`${CARD} px-4 py-3.5 min-w-0 ${destacar ? 'border-amber-300 bg-amber-50/40' : ''}`}>
      <div className={lbl}>{titulo}</div>
      <div className={`text-2xl font-black tabular-nums ${Number(valor) > 0 ? colorNum : 'text-zinc-300'}`}>{valor}</div>
      <div className="text-[11px] text-zinc-500">{sub}</div>
    </div>
  );
  const quien = (p) => (
    <>
      <span className="font-black text-zinc-900">{p.tipo === 'PLANTILLA' ? 'Plantilla para todos' : p.clienteNombre}</span>
      <span className="block text-[11px] text-zinc-500">{p.vendedorNombre || '—'}</span>
    </>
  );
  const beneficio = (p) => {
    const a = p.activacion;
    return (
      <>
        <span className="font-bold text-zinc-800">{p.nombre}</span>
        <span className="block text-[11px] text-zinc-500">{p.tipo === 'PLANTILLA' ? `plantilla nueva${p.publico ? ' · pública' : ' · solo por pacto'}` : p.plantillaBaseNombre ? `base «${p.plantillaBaseNombre}»` : 'a medida'}{a ? ` · cuenta #${a.CueIdCuenta}` : ''}</span>
      </>
    );
  };
  const precios = (p) => {
    const peores = p.alertas?.peores || 0;
    return (
      <>
        {(p.reglasTexto || []).map((t, i) => <span key={i} className="block">{t}</span>)}
        {peores > 0 && <span className="block text-brand-magenta font-bold mt-0.5">{peores} precio{peores > 1 ? 's' : ''} peor{peores > 1 ? 'es' : ''} que los de hoy</span>}
      </>
    );
  };
  const carga = (p) => {
    const a = p.activacion;
    return (
      <>
        <span className="font-bold text-zinc-900 tabular-nums">{sym(p.monedaId)} {fmtN(p.carga)}</span>
        <span className="block text-[11px] text-zinc-500">{p.cargaEsMinimo ? 'mínimo' : 'fijo'}{a ? ` · cargado ${fmtFecha(a.BclFechaActivacion)}` : ''}</span>
      </>
    );
  };
  const estado = (p) => {
    const a = p.activacion;
    return (
      <>
        <EstadoBadge estado={a?.BclEstado || p.estado} />
        {p.estado === 'APROBADO' && !a && <span className="block text-[11px] text-amber-700 font-bold mt-1">No habilitado: el cliente no cargó el saldo todavía</span>}
        {a && <span className="block text-[11px] text-zinc-600 mt-1">Saldo {sym(p.monedaId)} {fmtN(a.Saldo)} · {a.Consumos} pedido{a.Consumos !== 1 ? 's' : ''}</span>}
      </>
    );
  };
  const acciones = (p, columna = true) => {
    const a = p.activacion; const estadoBolsa = a?.BclEstado;
    return (
      <div className={`flex gap-1.5 ${columna ? 'flex-col items-center' : 'flex-wrap'}`}>
        {p.estado === 'PENDIENTE' && puedeAprobar && <button type="button" onClick={() => { setSel(p); setNota(''); }} className={ACCION_PRINCIPAL}>Revisar y aprobar</button>}
        {p.estado === 'PENDIENTE' && !puedeAprobar && p.tipo === 'PACTO' && <button type="button" onClick={() => decidir(p, 'cancelar')} className={`${ACCION} hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5`}>Cancelar</button>}
        {p.estado === 'RECHAZADO' && p.tipo === 'PACTO' && <button type="button" onClick={() => setPactoEditar(p)} title="Corregir este pacto y reenviarlo a aprobación" className={`${ACCION} hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50`}>Editar y reenviar</button>}
        {p.estado === 'APROBADO' && puedeAprobar && <button type="button" onClick={() => setVentaSaldo({ cliente: { CliIdCliente: p.cliId, Nombre: p.clienteNombre }, beneficio: p })} className={`${ACCION} hover:text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50`}>Cargar en caja</button>}
        {p.estado === 'APROBADO' && <button type="button" onClick={() => decidir(p, 'cancelar')} className={`${ACCION} hover:text-brand-magenta hover:border-brand-magenta/30 hover:bg-brand-magenta/5`}>Cancelar</button>}
        {a && estadoBolsa === 'ACTIVO' && puedeAprobar && <button type="button" onClick={() => bolsa(p, 'pausar')} className={`${ACCION} hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50`}>Pausar</button>}
        {a && estadoBolsa === 'PAUSADO' && puedeAprobar && <button type="button" onClick={() => bolsa(p, 'reanudar')} className={`${ACCION} hover:text-emerald-700 hover:border-emerald-300 hover:bg-emerald-50`}>Reanudar</button>}
        {a && ['ACTIVO', 'PAUSADO', 'VENCIDO', 'AGOTADO'].includes(estadoBolsa) && puedeAprobar && <button type="button" onClick={() => bolsa(p, 'cerrar')} className={`${ACCION} hover:text-amber-700 hover:border-amber-300 hover:bg-amber-50`}>Cerrar{a.Saldo > 0.009 ? ` · pasar ${sym(p.monedaId)} ${fmtN(a.Saldo)} a la billetera` : ''}</button>}
      </div>
    );
  };
  const elegir = (p) => { setSel(p); setNota(''); setMotivo(''); };
  const vacio = (
    <div className="flex flex-col items-center text-center">
      <ListChecks size={40} className="mb-3 text-brand-cyan" />
      <span className="text-sm font-bold text-zinc-700">No hay pactos con estos filtros.</span>
      <span className="text-xs text-zinc-400 mt-1">Probá con otro estado u otras fechas.</span>
    </div>
  );

  return (
    <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">
      <p className="text-[11px] text-zinc-400 -mb-2">Vista 360 · Vendedores › pestaña Beneficios › <strong className="text-zinc-700">{puedeAprobar ? 'Beneficios pactados (lista de aprobación)' : 'Mis pactos'}</strong></p>

      {/* Encabezado */}
      <div className="flex flex-wrap items-center gap-3">
        <ListChecks size={30} className="text-brand-cyan shrink-0" />
        <div className="min-w-[240px] flex-1">
          <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Beneficios pactados</h1>
          <p className="text-sm text-zinc-500 mt-1">Pactos de vendedores con clientes: aprobación, activación y seguimiento del saldo. Aprobado no es habilitado: nada cambia hasta que el cliente carga.</p>
        </div>
        <button type="button" onClick={cargar} className={`${BTN_SECUNDARIO} sm:ml-auto`}><RefreshCw size={15} className={`text-brand-cyan ${loading ? 'animate-spin' : ''}`} /> Actualizar</button>
      </div>

      {resumen && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpi('Pendientes de aprobación', resumen.pendientes, 'Esperan decisión', 'text-amber-700', Number(resumen.pendientes) > 0)}
          {kpi('Aprobados sin activar', resumen.aprobadosSinActivar, 'El cliente aún no cargó el saldo', 'text-brand-cyan')}
          {kpi('Activos', resumen.activos, `$ ${fmtN(resumen.saldoVivoUYU)} · US$ ${fmtN(resumen.saldoVivoUSD)} de saldo vivo`, 'text-emerald-700')}
          {kpi('Historial', resumen.historial, 'Agotados, vencidos, rechazados, cancelados')}
        </div>
      )}

      {/* Filtros */}
      <div className={`${CARD} p-4 grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end`}>
        <div className="col-span-2 md:flex-1 min-w-0 md:min-w-[200px]">
          <span className={lbl}>Cliente</span>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
            <input value={filtro.cliente} onChange={e => setFiltro(x => ({ ...x, cliente: e.target.value }))} placeholder="Nombre o código" aria-label="Cliente" className={CAMPO} />
          </div>
        </div>
        <div className="col-span-2 md:col-span-1 min-w-0 md:w-56">
          <span className={lbl}>Estado</span>
          <Selector filtro className="w-full" value={filtro.estado} onChange={e => setFiltro(x => ({ ...x, estado: e.target.value }))} aria-label="Estado" anchoLista={240}>
            <option value="">Todos</option><option value="PENDIENTE">Pendientes</option><option value="APROBADO">Aprobados sin activar</option><option value="ACTIVADO">Activados</option><option value="RECHAZADO">Rechazados</option><option value="CANCELADO">Cancelados</option>
          </Selector>
        </div>
        <div className="min-w-0 md:w-40">
          <span className={lbl}>Desde</span>
          <SelectorFecha filtro className="w-full" value={filtro.desde} onChange={e => setFiltro(x => ({ ...x, desde: e.target.value }))} placeholder="Desde" aria-label="Desde" />
        </div>
        <div className="min-w-0 md:w-40">
          <span className={lbl}>Hasta</span>
          <SelectorFecha filtro className="w-full" value={filtro.hasta} onChange={e => setFiltro(x => ({ ...x, hasta: e.target.value }))} placeholder="Hasta" aria-label="Hasta" />
        </div>
      </div>

      {/* Lista: tabla en escritorio, tarjetas en el celular */}
      {!conTabla ? (
        <div className="flex flex-col gap-2.5">
          {loading && !rows.length ? <div className={CARD}><Cargando /></div> : visibles.length === 0 ? <div className={`${CARD} px-4 py-12`}>{vacio}</div> : visibles.map(p => (
            <div key={p.BenIdBeneficio} onClick={() => elegir(p)}
              className={`${CARD} p-3.5 flex flex-col gap-2.5 cursor-pointer ${sel?.BenIdBeneficio === p.BenIdBeneficio ? 'ring-2 ring-brand-cyan/25' : p.estado === 'PENDIENTE' ? 'border-amber-200 bg-amber-50/30' : ''}`}>
              <div className="min-w-0">{quien(p)}</div>
              <div>{estado(p)}</div>
              <div className="text-sm">{beneficio(p)}</div>
              <div className="text-xs bg-zinc-50 rounded-xl px-3 py-2">{precios(p)}</div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className={lbl}>Carga</span>{carga(p)}</div>
                <div><span className={lbl}>Vigencia</span>{p.activacion?.BclFechaVencimiento ? `Vence ${fmtFecha(p.activacion.BclFechaVencimiento)}` : vigenciaTexto(p)}</div>
              </div>
              <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-zinc-100" onClick={e => e.stopPropagation()}>
                <span className="text-[11px] text-zinc-400 tabular-nums">{fmtFecha(p.fechaAlta)}</span>
                {acciones(p, false)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          {loading && !rows.length ? <Cargando /> : (
            <div className="overflow-x-auto"><table className="w-full text-sm text-left">
              <thead className="bg-zinc-50 border-b border-zinc-200"><tr>
                <th className={TH}>Fecha</th><th className={TH}>Cliente / vendedor</th><th className={TH}>Beneficio</th><th className={TH}>Precios pactados</th><th className={`${TH} text-right`}>Carga</th><th className={TH}>Vigencia</th><th className={TH}>Estado</th><th className={`${TH} text-center`}>Acciones</th>
              </tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {visibles.map(p => (
                  <tr key={p.BenIdBeneficio} onClick={() => elegir(p)}
                    className={`cursor-pointer transition-colors ${sel?.BenIdBeneficio === p.BenIdBeneficio ? 'bg-brand-cyan/5' : p.estado === 'PENDIENTE' ? 'bg-amber-50/40 hover:bg-amber-50' : 'hover:bg-zinc-50'}`}>
                    <td className="px-4 py-3 align-top whitespace-nowrap text-xs text-zinc-500 tabular-nums">{fmtFecha(p.fechaAlta)}</td>
                    <td className="px-4 py-3 align-top">{quien(p)}</td>
                    <td className="px-4 py-3 align-top">{beneficio(p)}</td>
                    <td className="px-4 py-3 align-top text-xs text-zinc-700">{precios(p)}</td>
                    <td className="px-4 py-3 align-top text-right whitespace-nowrap">{carga(p)}</td>
                    <td className="px-4 py-3 align-top text-xs">{p.activacion?.BclFechaVencimiento ? `Vence ${fmtFecha(p.activacion.BclFechaVencimiento)}` : vigenciaTexto(p)}</td>
                    <td className="px-4 py-3 align-top">{estado(p)}</td>
                    <td className="px-4 py-3 align-top" onClick={e => e.stopPropagation()}>{acciones(p)}</td>
                  </tr>
                ))}
                {visibles.length === 0 && <tr><td colSpan={8} className="px-4 py-14">{vacio}</td></tr>}
              </tbody>
            </table></div>
          )}
        </div>
      )}

      {/* Revisión del pacto o plantilla elegido */}
      {sel && (
        <div className={`${CARD} overflow-hidden ${sel.estado === 'PENDIENTE' ? 'border-amber-300' : ''}`}>
          <div className={`px-5 py-3 border-b flex items-start justify-between gap-4 flex-wrap ${sel.estado === 'PENDIENTE' ? 'bg-amber-50/60 border-amber-200' : 'border-zinc-100'}`}>
            <div className="min-w-0">
              <div className={`text-[10px] font-black uppercase tracking-widest ${sel.estado === 'PENDIENTE' ? 'text-amber-700' : 'text-zinc-400'}`}>Revisar {sel.tipo === 'PLANTILLA' ? 'plantilla' : 'pacto'} #{sel.BenIdBeneficio}</div>
              <div className="text-base font-black text-zinc-900">{sel.tipo === 'PLANTILLA' ? sel.nombre : `${sel.clienteNombre} · «${sel.nombre}»`} · propuesto por {sel.vendedorNombre || '—'} el {fmtFecha(sel.fechaAlta)}</div>
              {sel.nota && <div className="text-[11px] text-zinc-600 mt-0.5">Nota del vendedor: «{sel.nota}»</div>}
            </div>
            <button type="button" onClick={() => setSel(null)} aria-label="Cerrar"
              className="shrink-0 text-zinc-400 hover:text-brand-magenta w-9 h-9 rounded-full hover:bg-brand-magenta/5 flex items-center justify-center transition-colors"><X size={18} /></button>
          </div>
          <div className="p-5 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
            <div className="space-y-3 min-w-0">
              {(sel.alertas?.peores || 0) > 0 && (
                <div className="flex items-start gap-2 bg-brand-magenta/10 border border-brand-magenta/20 rounded-xl px-3 py-2 text-xs text-brand-magenta"><AlertTriangle size={14} className="shrink-0 mt-0.5" /><span><strong>{sel.alertas.peores} precio{sel.alertas.peores > 1 ? 's' : ''} peor{sel.alertas.peores > 1 ? 'es' : ''} que los que el cliente paga hoy.</strong> Se puede aprobar igual, pero la nota es obligatoria y queda en el pacto.</span></div>
              )}
              <div className="overflow-x-auto rounded-xl border border-zinc-200">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 border-b border-zinc-200"><tr><th className={TH}>Aplica a</th><th className={`${TH} text-right`}>Lista</th><th className={`${TH} text-right`}>Precio actual</th><th className={`${TH} text-right`}>Pactado</th><th className={`${TH} text-right`}>Dif. vs lista</th></tr></thead>
                  <tbody className="divide-y divide-zinc-100">
                    {(sel.alertas?.reglas || sel.reglasTexto?.map(t => ({ texto: t })) || []).map((r, i) => (
                      <React.Fragment key={i}>
                        <tr className={r.peor ? 'bg-brand-magenta/5' : ''}>
                          <td className="px-4 py-2 font-bold text-zinc-800">{r.texto}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.lista != null ? `${sym(sel.monedaId)} ${fmtN(r.lista)}` : <span className="text-zinc-400">según artículo</span>}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.actual != null ? `${sym(sel.monedaId)} ${fmtN(r.actual)}` : <span className="text-zinc-400">varía</span>}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-black text-zinc-900">{r.pactado != null ? `${sym(sel.monedaId)} ${fmtN(r.pactado)}` : '—'}</td>
                          <td className={`px-4 py-2 text-right font-black tabular-nums ${r.peor ? 'text-brand-magenta' : 'text-emerald-700'}`}>{r.difPct != null ? `${r.difPct > 0 ? '+' : ''}${fmtN(r.difPct, 0)} %${r.peor ? ' · peor' : ''}` : (r.peor ? 'peor' : '—')}</td>
                        </tr>
                        {(r.detalle || []).filter(d => d.peor).map((d, k) => <tr key={`${i}-${k}`} className="bg-brand-magenta/5"><td colSpan={5} className="px-4 py-1.5 text-[11px] text-brand-magenta">{d.descripcion || d.cod}: paga hoy {sym(sel.monedaId)} {fmtN(d.actual)} y el pacto le da {sym(sel.monedaId)} {fmtN(d.pactado)}.</td></tr>)}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2"><div className={lbl}>Carga que lo activa</div><div className="font-black text-zinc-900 tabular-nums">{sym(sel.monedaId)} {fmtN(sel.carga)} · {sel.cargaEsMinimo ? 'mínimo' : 'fijo'}</div></div>
                <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2"><div className={lbl}>Vigencia</div><div className="font-black text-zinc-900">{vigenciaTexto(sel)}</div></div>
                <div className="bg-zinc-50 border border-zinc-100 rounded-xl px-3 py-2"><div className={lbl}>Estado</div><div><EstadoBadge estado={sel.activacion?.BclEstado || sel.estado} /></div></div>
              </div>
              <p className="text-xs text-zinc-600 bg-brand-cyan/5 border border-brand-cyan/15 rounded-xl px-3 py-2"><strong className="text-brand-cyan">Qué pasa al aprobar:</strong> {sel.tipo === 'PLANTILLA' ? 'la plantilla queda publicada y cada cliente la activa cargando el saldo; esas activaciones no pasan por acá.' : `el pacto queda disponible para que el cliente lo active cargando ${sym(sel.monedaId)} ${fmtN(sel.carga)}, desde el portal o en caja. Ningún precio cambia hasta que esa carga se acredite. Si nunca la hace, se cancela desde esta lista.`}</p>
              {sel.notaAprobador && <p className="text-xs text-emerald-800 flex items-start gap-1.5"><CheckCircle2 size={13} className="shrink-0 mt-px" /><span>Nota de quien aprobó ({sel.aprobadorNombre || '—'}, {fmtFecha(sel.fechaAprobacion)}): «{sel.notaAprobador}»</span></p>}
              {sel.motivoRechazo && <p className="text-xs text-brand-magenta">Motivo del rechazo / cancelación: «{sel.motivoRechazo}»</p>}
            </div>
            {sel.estado === 'PENDIENTE' && puedeAprobar && (
              <div className="space-y-3">
                <div>
                  <label htmlFor="nota-aprueba" className={lbl}>Nota de quien aprueba (queda en el pacto{(sel.alertas?.peores || 0) > 0 ? ' · obligatoria por los precios peores' : ''})</label>
                  <textarea id="nota-aprueba" rows={3} value={nota} onChange={e => setNota(e.target.value)} className={`${CAMPO_TEXTO} resize-none`} />
                </div>
                <button type="button" onClick={() => decidir(sel, 'aprobar')} className={`${BTN_PRINCIPAL} w-full`}><CheckCircle2 size={15} /> Aprobar {sel.tipo === 'PLANTILLA' ? 'y publicar' : 'pacto'}</button>
                <div className="pt-1">
                  <label htmlFor="motivo-rechazo" className={lbl}>Motivo del rechazo (obligatorio para rechazar)</label>
                  <textarea id="motivo-rechazo" rows={2} value={motivo} onChange={e => setMotivo(e.target.value)} className={`${CAMPO_TEXTO} resize-none`} />
                </div>
                <button type="button" onClick={() => decidir(sel, 'rechazar')} className={`${BTN_SECUNDARIO} w-full text-brand-magenta border-brand-magenta/30 hover:bg-brand-magenta/5`}>Rechazar</button>
                <p className="text-[11px] text-zinc-400 text-center">Un vendedor no puede aprobar su propio pacto.</p>
              </div>
            )}
            {sel.estado === 'PENDIENTE' && !puedeAprobar && <p className="text-xs text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">Solo Administración aprueba o rechaza. Podés cancelarlo desde la lista si ya no corresponde.</p>}
          </div>
        </div>
      )}

      {/* Cancelar un pacto: motivo opcional (antes, la ventana del navegador) */}
      {cancelacion && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/40 p-4" onClick={e => e.target === e.currentTarget && setCancelacion(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100">
              <h2 className="text-lg font-black text-zinc-900">Cancelar el pacto «{cancelacion.p.nombre}»</h2>
              <p className="text-sm text-zinc-500 mt-0.5">{cancelacion.p.estado === 'APROBADO' ? 'Aprobado pero nunca cargado' : 'Pendiente'}. No hay plata que devolver.</p>
            </div>
            <div className="px-6 py-5">
              <label htmlFor="motivo-cancelacion" className={lbl}>Motivo (opcional)</label>
              <textarea id="motivo-cancelacion" autoFocus rows={3} value={cancelacion.motivo} onChange={e => setCancelacion(c => ({ ...c, motivo: e.target.value }))} className={`${CAMPO_TEXTO} resize-none`} />
            </div>
            <div className="px-6 py-3 border-t border-zinc-100 flex justify-end gap-2">
              <button type="button" onClick={() => setCancelacion(null)} className={BTN_SECUNDARIO}>Volver</button>
              <button type="button" onClick={confirmarCancelacion}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-magenta text-white text-sm font-bold hover:bg-brand-magenta/90 transition-colors">Cancelar el pacto</button>
            </div>
          </div>
        </div>
      )}

      {ventaSaldo && <ModalVentaSaldo cliente={ventaSaldo.cliente} beneficioPreset={ventaSaldo.beneficio} onClose={() => setVentaSaldo(null)} onSuccess={cargar} />}
      {pactoEditar && <ModalPactarBeneficio cliente={{ CliIdCliente: pactoEditar.cliId, Nombre: pactoEditar.clienteNombre }} pactoExistente={pactoEditar} onClose={() => setPactoEditar(null)} onSuccess={cargar} />}
      {ventanaConfirmar}
    </div>
  );
}
