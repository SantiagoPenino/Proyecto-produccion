import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/apiClient';
import { useAuth } from '../../context/AuthContext';
import { toast } from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { Download, Loader2, Search, ChevronDown, ChevronRight, History, QrCode } from 'lucide-react';

const SEV = { ALTA: 'bg-red-500', MEDIA: 'bg-amber-500', BAJA: 'bg-slate-400' };
const SEV_RANK = { ALTA: 0, MEDIA: 1, BAJA: 2 };
const TIPO_COLOR = { FALTANTE: 'bg-red-600', SOBRANTE: 'bg-orange-500', SIN_INGRESO: 'bg-purple-600', NO_REGISTRADA: 'bg-slate-500', SIN_AVISO: 'bg-violet-500', PERMANENCIA: 'bg-amber-600' };
const ESTADO_CLS = { ABIERTO: 'bg-red-50 text-red-700 border-red-200', EN_CURSO: 'bg-indigo-50 text-indigo-700 border-indigo-200', ESPERANDO: 'bg-amber-50 text-amber-700 border-amber-200', RESUELTO: 'bg-green-50 text-green-700 border-green-200', ASUMIDO: 'bg-slate-100 text-slate-600 border-slate-300' };
// Anotaciones: solo lo que NO tiene una acción real (avisar, ingresar, regresar, asignar y resolver son botones)
const ACCIONES_OPERATIVAS = ['Recontado: sigue sin aparecer', 'Consultado al cliente por teléfono', 'Reclamado al área o a la mensajería', 'Otra'];
const TIPOS_DE_ORDEN_EN_DEPOSITO = ['FALTANTE', 'SIN_AVISO', 'PERMANENCIA']; // la orden está activa en depósito
const fmtF = (d) => (d ? new Date(d).toLocaleDateString('es-UY') : '');
const fmtFH = (d) => (d ? new Date(d).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const plata = (v) => '$ ' + new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 }).format(Math.round(Number(v) || 0));
const errorDe = (e) => e?.response?.data?.error || e?.message || 'Error';

/**
 * Pestaña "Registro de Casos": UNA FILA POR ORDEN con todos sus problemas adentro. El motor sigue llevando un caso
 * por orden y tipo (eso es lo que evita duplicados); la pantalla los agrupa. Acciones sobre el depósito a nivel de
 * orden, acciones de seguimiento por cada problema, lote, historial de auditorías y Excel.
 */
export default function AuditDepositoCasosTab({ estado, refreshKey, onKpis }) {
  const [filtro, setFiltro] = useState('VIVOS');
  const [tipo, setTipo] = useState('');
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [ordenBusca, setOrdenBusca] = useState('');
  const [orden, setOrden] = useState('');
  const [casos, setCasos] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [tipos, setTipos] = useState({});
  const [loading, setLoading] = useState(false);
  const [abierta, setAbierta] = useState(null);       // key de la orden desplegada
  const [detalles, setDetalles] = useState({});       // casoId → { caso, eventos }
  const [marc, setMarc] = useState({});               // casoId → true
  const [lote, setLote] = useState({ accion: 'REGISTRAR', operativa: ACCIONES_OPERATIVAS[0], detalle: '' });
  const [modal, setModal] = useState(null);           // { casoId, accion, titulo, texto }
  const [historial, setHistorial] = useState(null);
  const [verHistorial, setVerHistorial] = useState(false);
  const [bump, setBump] = useState(0);
  const [usuarios, setUsuarios] = useState([]);
  const { user: usuarioActual } = useAuth();

  const auditoriasCerradas = kpis ? kpis.auditoriasCerradas : (estado?.auditoriasCerradas || 0);
  const mostrarCronicos = auditoriasCerradas >= 2;

  useEffect(() => { const t = setTimeout(() => setQ(busca), 300); return () => clearTimeout(t); }, [busca]);
  useEffect(() => { const t = setTimeout(() => setOrden(ordenBusca), 300); return () => clearTimeout(t); }, [ordenBusca]);
  useEffect(() => { api.get('/audit-deposito/usuarios').then(({ data }) => { if (data.success) setUsuarios(data.data || []); }).catch(() => {}); }, []);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    api.get('/audit-deposito/casos', { params: { estado: (q || orden) ? 'TODOS' : filtro, tipo: tipo || undefined, q: q || undefined, orden: orden || undefined } })
      .then(({ data }) => {
        if (!vivo || !data.success) return;
        setCasos(data.casos || []); setKpis(data.kpis || null); setTipos(data.tipos || {});
        onKpis && onKpis(data.kpis || null);
        if (data.sincronizados > 0) toast(`${data.sincronizados} caso${data.sincronizados > 1 ? 's' : ''} se resolvi${data.sincronizados > 1 ? 'eron' : 'ó'} solo${data.sincronizados > 1 ? 's' : ''}: su orden ya se entregó, se canceló, regresó o ingresó al depósito desde otra pantalla.`, { icon: '🔄', duration: 7000 });
      })
      .catch(e => toast.error('No se pudo cargar el registro: ' + errorDe(e)))
      .finally(() => vivo && setLoading(false));
    return () => { vivo = false; };
  }, [filtro, tipo, q, orden, refreshKey, bump]);

  useEffect(() => {
    if (!verHistorial) return;
    api.get('/audit-deposito/auditorias', { params: { limit: 30 } }).then(({ data }) => { if (data.success) setHistorial(data.data || []); }).catch(() => {});
  }, [verHistorial, refreshKey, bump]);

  /* ── Una fila por orden ── */
  const grupos = useMemo(() => {
    const m = new Map();
    for (const c of casos) {
      const k = c.ordIdOrden ? `O${c.ordIdOrden}` : `C${c.ordenCodigo}`;
      if (!m.has(k)) m.set(k, { key: k, ordIdOrden: c.ordIdOrden, ordenCodigo: c.ordenCodigo, cliente: c.cliente, casos: [] });
      m.get(k).casos.push(c);
    }
    const minF = (arr) => arr.reduce((a, d) => (d && (!a || new Date(d) < new Date(a)) ? d : a), null);
    return [...m.values()].map(g => {
      const vivos = g.casos.filter(c => c.vivo);
      const cerrados = g.casos.filter(c => !c.vivo);
      const ultimoCierre = cerrados.slice().sort((a, b) => new Date(b.cerradoEn || 0) - new Date(a.cerradoEn || 0))[0] || null;
      const primero = g.casos.slice().sort((a, b) => new Date(a.primeraDeteccion) - new Date(b.primeraDeteccion))[0];
      const ultimo = g.casos.slice().sort((a, b) => new Date(b.ultimaDeteccion) - new Date(a.ultimaDeteccion))[0];
      return {
        ...g, vivos, cerrados,
        severidad: g.casos.reduce((a, c) => (SEV_RANK[c.severidad] < SEV_RANK[a] ? c.severidad : a), 'BAJA'),
        veces: Math.max(...g.casos.map(c => c.veces || 1)),
        reincidente: g.casos.some(c => c.reincidente),
        primera: primero?.primeraDeteccion, primeraAud: primero?.primeraAud, ultima: ultimo?.ultimaDeteccion, ultimaAud: ultimo?.ultimaAud,
        valor: Math.max(...g.casos.map(c => Number(c.valorPesos) || 0)),
        responsables: [...new Set(g.casos.map(c => c.responsable).filter(Boolean))],
        fechaLimite: minF(vivos.map(c => c.fechaLimite)), vencido: vivos.some(c => c.vencido),
        ultimoCierre,
        estadoOrden: g.casos[0].estadoOrden, retiroId: g.casos[0].retiroId, formaRetiro: g.casos[0].formaRetiro, etiqueta: g.casos.map(c => c.etiqueta).find(Boolean) || null,
      };
    });
  }, [casos]);

  const cargarDetalles = (grupo) => {
    Promise.all(grupo.casos.map(c => api.get(`/audit-deposito/casos/${c.casoId}`).then(({ data }) => [c.casoId, data.success ? data : null]).catch(() => [c.casoId, null])))
      .then(pares => setDetalles(prev => { const n = { ...prev }; pares.forEach(([id, d]) => { n[id] = d; }); return n; }));
  };
  const toggleFila = (grupo) => {
    if (abierta === grupo.key) { setAbierta(null); return; }
    setAbierta(grupo.key); cargarDetalles(grupo);
  };
  const recargarAbierta = () => { const g = grupos.find(x => x.key === abierta); if (g) cargarDetalles(g); };

  const ejecutar = async (casoId, accion, det, extra = {}) => {
    try {
      const { data } = await api.post(`/audit-deposito/casos/${casoId}/accion`, { accion, detalle: det || null, ...extra });
      toast.success(data.message);
      setModal(null); setBump(x => x + 1);
      setTimeout(recargarAbierta, 300);
    } catch (e) { toast.error(errorDe(e)); }
  };
  // Seguimiento a nivel de ORDEN: la misma acción sobre todos sus problemas vivos (REABRIR: sobre los cerrados).
  const ejecutarOrden = async (g, accion, det, extra = {}) => {
    const objetivo = (accion === 'REABRIR' || (accion === 'COMENTAR' && !g.vivos.length)) ? g.cerrados : g.vivos;
    if (!objetivo.length) return toast.error('La orden no tiene problemas a los que aplicar esta acción.');
    try {
      const { data } = await api.post('/audit-deposito/casos/accion-lote', { casoIds: objetivo.map(c => c.casoId), accion, detalle: det || null, ...extra });
      toast.success(`${g.ordenCodigo}: ${data.message}`);
      if (data.data?.errores?.length) toast.error(data.data.errores.map(e => `#${e.casoId}: ${e.error}`).join('\n'), { duration: 8000 });
      setModal(null); setBump(x => x + 1);
      setTimeout(recargarAbierta, 300);
    } catch (e) { toast.error(errorDe(e)); }
  };
  // "Ingresar": el MISMO proceso que la pantalla de Recepción; después el caso queda RESUELTO.
  const ingresarDesdeOrden = async (g) => {
    const c = g.vivos.find(x => x.tipo === 'SIN_INGRESO');
    if (!c) return;
    const etiqueta = g.etiqueta || c.etiqueta;
    if (!etiqueta) return toast.error('Esta orden no tiene bulto con etiqueta: generá la etiqueta desde el área antes de ingresarla.');
    if (!window.confirm(`Ingresar al depósito el bulto ${etiqueta} (orden ${g.ordenCodigo}).\n\nEs el MISMO proceso que la pantalla de Recepción: crea la orden en depósito, aplica el control de pedido completo y dispara los avisos. Después el caso queda RESUELTO.\n\n¿Confirmar?`)) return;
    try {
      await api.post('/logistics/receive', { envioId: null, codigoEtiqueta: etiqueta, usuarioId: usuarioActual?.id, areaReceptora: 'DEPOSITO' });
      await ejecutar(c.casoId, 'RESOLVER', `Ingresada al depósito desde el registro (bulto ${etiqueta}, mismo proceso que Recepción)`);
    } catch (e) { toast.error('No se pudo ingresar: ' + errorDe(e)); }
  };
  // "Cancelar": la orden se CANCELA en depósito (mismo endpoint que Caja: estado 10, retiro, reversión del cargo) y el
  // caso Faltante queda ASUMIDO. Los demás problemas de la orden se resuelven solos en la próxima carga (sincronización).
  const cancelarConMotivo = async (c, motivo) => {
    const cancela = c.tipo === 'FALTANTE' && c.ordIdOrden && c.estadoOrden != null && c.estadoOrden < 9;
    if (cancela) {
      try { await api.post('/apiordenesRetiro/caja/orden/cancelar', { orderId: c.ordIdOrden, OReIdOrdenRetiro: c.retiroId || null, formaRetiro: c.formaRetiro || null }); }
      catch (e) { return toast.error(`${c.codigo}: no se pudo cancelar la orden en depósito: ${errorDe(e)}`); }
    }
    await ejecutar(c.casoId, 'ASUMIR', cancela ? `${motivo} · orden ${c.ordenCodigo} cancelada en depósito (estado 10)` : motivo);
  };

  const ejecutarLote = async () => {
    const ids = Object.keys(marc).filter(k => marc[k]).map(Number);
    if (!ids.length) return;
    const det = lote.accion === 'REGISTRAR' ? `${lote.operativa}${lote.detalle ? ': ' + lote.detalle : ''}` : lote.detalle;
    if (['REGISTRAR', 'RESOLVER', 'ASUMIR', 'ESPERAR', 'COMENTAR'].includes(lote.accion) && !det) return toast.error('Escribí el motivo o detalle.');
    const usuarioLote = usuarios.find(u => String(u.id) === String(lote.responsableId));
    if (lote.accion === 'ASIGNAR' && !usuarioLote) return toast.error('Elegí a quién asignar.');
    if (lote.accion === 'ASUMIR') {
      if (!window.confirm(`Cancelar en depósito ${ids.length} caso${ids.length > 1 ? 's' : ''}.\n\nEn los Faltantes la orden se CANCELA en depósito (mismo proceso que Caja) y el caso queda cerrado como pérdida asumida con tu usuario como responsable.\nMotivo: ${det}\n\n¿Confirmar?`)) return;
      for (const id of ids) { const c = casos.find(x => x.casoId === id); if (c) await cancelarConMotivo(c, det); }
      setMarc({}); setBump(x => x + 1); return;
    }
    const nombres = { REGISTRAR: 'registrar la anotación', TOMAR: 'tomar', RESOLVER: 'marcar RESUELTO', ESPERAR: 'dejar en espera', ASIGNAR: `asignar a ${usuarioLote ? usuarioLote.nombre : ''}${lote.fechaLimite ? ' con fecha límite ' + lote.fechaLimite : ''}`, ENTREGAR: 'marcar la ORDEN como ENTREGADA en depósito (estado 9, retiro, estante, bultos) y resolver', REGRESAR: 'REGRESAR la orden a depósito (estado 7) y resolver', AVISAR: 'AVISAR nuevamente por WhatsApp (estado 12)' };
    if (!window.confirm(`¿${nombres[lote.accion]} en ${ids.length} caso${ids.length > 1 ? 's' : ''}?\n${det ? 'Detalle: ' + det : ''}`)) return;
    const extra = lote.accion === 'ASIGNAR' ? { responsableId: usuarioLote.id, responsableNombre: usuarioLote.nombre, fechaLimite: lote.fechaLimite || null } : {};
    try {
      const { data } = await api.post('/audit-deposito/casos/accion-lote', { casoIds: ids, accion: lote.accion, detalle: det || null, ...extra });
      toast.success(data.message, { duration: 6000 });
      if (data.data?.errores?.length) toast.error(data.data.errores.map(e => `#${e.casoId}: ${e.error}`).join('\n'), { duration: 8000 });
      setMarc({}); setBump(x => x + 1);
    } catch (e) { toast.error(errorDe(e)); }
  };
  const exportar = () => {
    if (!casos.length) return toast.error('No hay casos para exportar con este filtro.');
    const rows = casos.map(c => ({ Orden: c.ordenCodigo, Cliente: c.cliente, Caso: c.codigo, Problema: c.tipoNombre, Estado: c.estado, Severidad: c.severidad, Veces: c.veces, Reincidente: c.reincidente ? 'SI' : '', 'Valor $': c.valorPesos, 'Días en depósito': c.diasEnDeposito, 'Primera detección': fmtF(c.primeraDeteccion), 'Primera auditoría': c.primeraAud, 'Última detección': fmtF(c.ultimaDeteccion), 'Última auditoría': c.ultimaAud, Responsable: c.responsable || '', 'Fecha límite': c.fechaLimite || '', 'Motivo cierre': c.motivoCierre || '', 'Cerrado en': fmtFH(c.cerradoEn), 'Cerrado por': c.cerradoPor || '' }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Casos');
    XLSX.writeFile(wb, `Registro_Casos_Deposito_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const nMarc = Object.keys(marc).filter(k => marc[k]).length;
  const toggleOrden = (g, on) => setMarc(prev => { const n = { ...prev }; g.casos.forEach(c => { if (on) n[c.casoId] = true; else delete n[c.casoId]; }); return n; });
  const ordenMarcada = (g) => g.casos.every(c => marc[c.casoId]);
  const FILTROS = useMemo(() => [
    { k: 'VIVOS', n: 'Abiertos', c: kpis?.vivos },
    ...(mostrarCronicos ? [{ k: 'CRONICOS', n: 'Crónicos (3+ auditorías)', c: kpis?.cronicos }] : []),
    { k: 'REINCIDENTES', n: 'Reincidentes', c: kpis?.reincidentes },
    { k: 'ALTA', n: 'Severidad alta', c: kpis?.alta },
    { k: 'VENCIDOS', n: 'Fecha límite vencida', c: kpis?.vencidos },
    { k: 'RECIENTES', n: 'Cerrados recientes (48 h)', c: kpis?.cerradosRecientes },
    { k: 'CERRADOS', n: 'Cerrados', c: kpis?.cerrados },
    { k: 'TODOS', n: 'Todos', c: kpis?.total },
  ], [kpis, mostrarCronicos]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-bold text-indigo-800">Registro de Casos</h3>
          <p className="text-xs text-indigo-700/80 mt-1 font-medium">Una fila por orden con todos sus problemas. Cada auditoría suma lo nuevo; lo que ya está <b>no se duplica</b>. Ordenadas por severidad y valor.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setVerHistorial(v => !v)} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 text-sm font-bold rounded shadow-sm hover:bg-slate-50"><History size={16} /> Historial de auditorías</button>
          <button onClick={exportar} className="flex items-center gap-2 px-3 py-1.5 bg-green-600 text-white text-sm font-bold rounded shadow-sm hover:bg-green-700"><Download size={16} /> Excel</button>
        </div>
      </div>

      {/* KPIs */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-4">
          {[
            { l: 'Casos abiertos', v: kpis.vivos, p: 'abiertos, en curso y esperando', t: 'Casos en estado ABIERTO, EN CURSO o ESPERANDO', c: 'border-indigo-200' },
            ...(mostrarCronicos ? [{ l: 'Crónicos', v: kpis.cronicos, p: 'abiertos con 3+ detecciones', t: 'Casos abiertos detectados en 3 o más auditorías seguidas', c: 'border-red-200' }] : [{ l: 'Crónicos', v: '—', p: 'desde la 2ª auditoría', t: 'Se muestra cuando hay al menos 2 auditorías cerradas', c: 'border-slate-200' }]),
            { l: 'Severidad alta', v: kpis.alta, p: `3+ detecciones · faltante > ${plata(estado?.config?.umbralValorAlta || 5000)} · más de 90 días`, t: `Casos abiertos de severidad ALTA. Criterio: detectado 3 o más veces, o Faltante con valor mayor a ${plata(estado?.config?.umbralValorAlta || 5000)}, o más de 90 días (del caso o de la orden en depósito). MEDIA: cualquier diferencia física o más de 30 días. BAJA: el resto.`, c: 'border-red-200' },
            { l: 'Reincidentes', v: kpis.reincidentes, p: 'cerrados que volvieron a aparecer', t: 'Casos que se habían cerrado y reaparecieron en una auditoría posterior', c: 'border-amber-200' },
            { l: 'Cerrados', v: kpis.cerrados, p: 'resueltos y asumidos', t: 'Casos en estado RESUELTO o ASUMIDO, histórico acumulado', c: 'border-green-200' },
            { l: 'Auditorías', v: kpis.auditoriasCerradas, p: 'cerradas hasta hoy', t: 'Auditorías cerradas (las anuladas no cuentan)', c: 'border-violet-200' },
          ].map(k => (
            <div key={k.l} className={`rounded-xl border bg-white p-3 ${k.c}`} title={k.t}>
              <div className="text-[10px] font-bold uppercase text-slate-500">{k.l}</div>
              <div className="text-2xl font-extrabold font-mono text-slate-800">{k.v}</div>
              <div className="text-[10px] text-slate-400 leading-tight">{k.p}</div>
            </div>
          ))}
        </div>
      )}

      {/* Historial */}
      {verHistorial && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-bold text-slate-700 mb-2">Historial de auditorías — cada corrida guarda su fotografía. El resultado de la fusión queda registrado.</div>
          {!historial ? <div className="text-xs text-slate-400">Cargando…</div> : !historial.length ? <div className="text-xs text-slate-400">Todavía no hay auditorías.</div> : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {historial.map(a => (
                <div key={a.audId} className={`min-w-[230px] rounded-lg border bg-white p-2.5 text-[11px] ${a.estado === 'ABIERTA' ? 'border-indigo-400' : a.estado === 'ANULADA' ? 'border-slate-200 opacity-60' : 'border-slate-200'}`}>
                  <div className="font-mono font-bold text-indigo-800 flex items-center justify-between">{a.codigo}<span className={`text-[9px] px-1.5 rounded-full ${a.estado === 'CERRADA' ? 'bg-green-100 text-green-700' : a.estado === 'ABIERTA' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500'}`}>{a.estado}</span></div>
                  <div className="text-slate-500">{fmtFH(a.fechaApertura)} · {a.usuarioApertura}</div>
                  <div className="text-slate-500">alcance: {a.alcanceTexto}{a.esLineaBase ? ' · línea base' : ''}</div>
                  <div className="text-slate-500">fotografía {a.snapshotCant ?? '—'} · escaneos {a.escaneosCant ?? '—'}</div>
                  {a.estado === 'CERRADA' && (
                    <div className="mt-1"><b className="text-red-600">{a.nuevos}</b> nuevos · <b className="text-slate-600">{a.existentes}</b> ya estaban<br /><b className="text-amber-600">{a.reincidentes}</b> reincidentes · <b className="text-green-600">{a.resueltos}</b> resueltos · <b>{a.movidas || 0}</b> movidas</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {FILTROS.map(f => (
          <button key={f.k} onClick={() => { setFiltro(f.k); setAbierta(null); }} className={`px-3 py-1 rounded-full text-xs font-bold border ${filtro === f.k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
            {f.n}{f.c != null && <span className="ml-1 opacity-70">{f.c}</span>}
          </button>
        ))}
        <select value={tipo} onChange={e => setTipo(e.target.value)} className="text-xs border-slate-300 rounded py-1">
          <option value="">Todos los problemas</option>
          {Object.entries(tipos).map(([k, t]) => <option key={k} value={k}>{t.nombre}</option>)}
        </select>
        <div className="relative" title="Filtra por orden: código con o sin prefijo, o la etiqueta del bulto. Busca en abiertos y cerrados.">
          <QrCode size={14} className="absolute left-2 top-2 text-indigo-500" />
          <input value={ordenBusca} onChange={e => { setOrdenBusca(e.target.value); setAbierta(null); }} placeholder="Orden (ej. SUB-19301)" className="pl-7 pr-2 py-1 text-xs font-mono border border-indigo-300 rounded w-44" />
        </div>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2 text-slate-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar caso o cliente…" className="pl-7 pr-2 py-1 text-xs border border-slate-300 rounded w-48" />
        </div>
        <span className="text-xs text-slate-500">{grupos.length} orden{grupos.length === 1 ? '' : 'es'} · {casos.length} caso{casos.length === 1 ? '' : 's'}</span>
        {loading && <Loader2 size={16} className="animate-spin text-indigo-500" />}
      </div>

      {/* Lote */}
      {nMarc > 0 && (
        <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 p-2.5 flex flex-wrap items-center gap-2 text-xs">
          <b className="text-indigo-800">{nMarc} caso{nMarc > 1 ? 's' : ''} seleccionado{nMarc > 1 ? 's' : ''}</b>
          <select value={lote.accion} onChange={e => setLote({ ...lote, accion: e.target.value })} className="text-xs border-slate-300 rounded py-1">
            <option value="REGISTRAR">Registrar anotación (pasa a EN CURSO)</option>
            <option value="TOMAR">Tomar (asignarme, EN CURSO)</option>
            <option value="ESPERAR">Dejar en espera de un tercero</option>
            <option value="RESOLVER">Marcar RESUELTO (con motivo)</option>
            <option value="ASIGNAR">Asignar responsable y fecha límite</option>
            <option value="ENTREGAR">Entregar (marcar la orden como entregada) y resolver</option>
            <option value="REGRESAR">Regresar la orden a Depósito y resolver</option>
            <option value="AVISAR">Avisar nuevamente por WhatsApp</option>
            <option value="ASUMIR">Cancelar la orden en depósito (pérdida asumida, con motivo)</option>
          </select>
          {lote.accion === 'ASIGNAR' && (
            <>
              <select value={lote.responsableId || ''} onChange={e => setLote({ ...lote, responsableId: e.target.value })} className="text-xs border-slate-300 rounded py-1">
                <option value="">Asignar a…</option>
                {usuarios.map(u => <option key={u.id} value={String(u.id)}>{u.nombre}</option>)}
              </select>
              <input type="date" value={lote.fechaLimite || ''} onChange={e => setLote({ ...lote, fechaLimite: e.target.value })} className="text-xs border border-slate-300 rounded px-2 py-1" title="Fecha límite (opcional)" />
            </>
          )}
          {lote.accion === 'REGISTRAR' && (
            <select value={lote.operativa} onChange={e => setLote({ ...lote, operativa: e.target.value })} className="text-xs border-slate-300 rounded py-1">
              {ACCIONES_OPERATIVAS.map(a => <option key={a}>{a}</option>)}
            </select>
          )}
          <input value={lote.detalle} onChange={e => setLote({ ...lote, detalle: e.target.value })} placeholder={['REGISTRAR', 'ASIGNAR', 'TOMAR', 'ENTREGAR', 'REGRESAR', 'AVISAR'].includes(lote.accion) ? 'Detalle (opcional)' : 'Motivo (obligatorio)'} className="text-xs border border-slate-300 rounded px-2 py-1 w-64" />
          <button onClick={ejecutarLote} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded">Ejecutar en {nMarc}</button>
          <button onClick={() => setMarc({})} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 rounded">Quitar selección</button>
        </div>
      )}

      {/* Tabla: una fila por orden */}
      <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-sm">
        {!grupos.length ? (
          <div className="py-12 flex flex-col items-center justify-center text-slate-400"><Search size={32} className="mb-3 opacity-50" /><p className="text-sm font-medium">{loading ? 'Cargando…' : 'No hay casos con este filtro.'}</p></div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 text-xs whitespace-nowrap">
              <tr>
                <th className="px-3 py-2 w-8"><input type="checkbox" checked={grupos.length > 0 && grupos.every(ordenMarcada)} onChange={e => { const m = {}; if (e.target.checked) casos.forEach(c => { m[c.casoId] = true; }); setMarc(m); }} /></th>
                <th className="px-3 py-2">Orden</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Problemas</th><th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Veces</th><th className="px-3 py-2">Detectado</th><th className="px-3 py-2">Última vez</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2">Responsable</th><th className="px-3 py-2">Fecha límite</th><th className="px-3 py-2">Cierre</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {grupos.map(g => {
                const esAb = abierta === g.key;
                const sel = ordenMarcada(g);
                return (
                  <React.Fragment key={g.key}>
                    <tr className={`hover:bg-slate-50/70 cursor-pointer ${sel ? 'bg-indigo-50/40' : ''}`} onClick={() => toggleFila(g)}>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}><input type="checkbox" checked={sel} onChange={e => toggleOrden(g, e.target.checked)} /></td>
                      <td className="px-3 py-2 font-mono font-bold text-indigo-800 whitespace-nowrap"><span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${SEV[g.severidad]}`} title={`Severidad ${g.severidad}`} />{esAb ? <ChevronDown size={12} className="inline mr-1" /> : <ChevronRight size={12} className="inline mr-1" />}{g.ordenCodigo}</td>
                      <td className="px-3 py-2 text-slate-700 max-w-[200px] truncate">{g.cliente || <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {g.casos.map(c => (
                            <span key={c.casoId} className={`text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TIPO_COLOR[c.tipo] || 'bg-slate-500'} ${c.vivo ? '' : 'opacity-40 line-through'}`} title={`${c.tipoDescripcion || c.tipoNombre} · ${c.codigo} · ${c.estado}${c.vivo ? '' : ' · ' + (c.motivoCierre || '')}`}>{c.tipoNombre}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {g.vivos.length === 0
                          ? <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ESTADO_CLS[g.casos[0].estado]}`}>{g.casos.every(c => c.estado === 'ASUMIDO') ? 'ASUMIDO' : 'RESUELTO'}</span>
                          : <span className="inline-flex flex-wrap gap-1">{[...new Set(g.vivos.map(c => c.estado))].map(e => <span key={e} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ESTADO_CLS[e]}`}>{e.replace('_', ' ')}</span>)}{g.cerrados.length > 0 && <span className="text-[10px] text-slate-400">+{g.cerrados.length} cerrado{g.cerrados.length > 1 ? 's' : ''}</span>}</span>}
                        {g.reincidente && <span className="ml-1 text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">REINCIDENTE</span>}
                      </td>
                      <td className={`px-3 py-2 text-right font-mono font-bold whitespace-nowrap ${g.veces >= 3 ? 'text-red-600' : 'text-slate-700'}`}>{g.veces >= 3 ? '×' : ''}{g.veces}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap"><b>{fmtF(g.primera)}</b><div className="text-[10px] text-slate-400">{g.primeraAud}</div></td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap"><b>{fmtF(g.ultima)}</b><div className="text-[10px] text-slate-400">{g.ultimaAud}</div></td>
                      <td className="px-3 py-2 text-right font-mono text-xs whitespace-nowrap">{g.valor ? plata(g.valor) : '—'}</td>
                      <td className="px-3 py-2 text-xs">{g.responsables.length ? g.responsables.join(', ') : <span className="text-slate-400 bg-slate-100 px-1.5 rounded">sin asignar</span>}</td>
                      <td className={`px-3 py-2 text-xs font-mono whitespace-nowrap ${g.vencido ? 'text-red-700 font-bold' : 'text-slate-600'}`}>{g.fechaLimite ? g.fechaLimite.split('-').reverse().join('/') : ''}{g.vencido && <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1 rounded">VENCIDA</span>}</td>
                      <td className="px-3 py-2 text-xs max-w-[260px]">{g.vivos.length === 0 && g.ultimoCierre ? (
                        <div title={`${g.ultimoCierre.motivoCierre || ''} · ${fmtFH(g.ultimoCierre.cerradoEn)} · ${g.ultimoCierre.cerradoPor || ''}`}>
                          <div className="truncate text-slate-700">{g.ultimoCierre.motivoCierre || (g.ultimoCierre.estado === 'ASUMIDO' ? 'Pérdida asumida' : 'Resuelto')}</div>
                          <div className="text-[10px] text-slate-400">{fmtFH(g.ultimoCierre.cerradoEn)}{g.ultimoCierre.cerradoPor ? ' · ' + g.ultimoCierre.cerradoPor : ''}</div>
                        </div>
                      ) : <span className="text-slate-300">—</span>}</td>
                    </tr>
                    {esAb && (
                      <tr><td colSpan={12} className="bg-slate-50 px-4 py-3 whitespace-normal">
                        <DetalleOrden grupo={g} detalles={detalles} usuarios={usuarios}
                          onAccionCaso={(casoId, accion, titulo, texto) => setModal({ casoId, accion, titulo, texto })}
                          onAccionOrden={(accion, titulo, texto, sinMotivo) => sinMotivo ? ejecutarOrden(g, accion) : setModal({ grupo: g, accion, titulo, texto })}
                          onAsignar={(payload) => ejecutarOrden(g, 'ASIGNAR', null, payload)}
                          onIngresar={() => ingresarDesdeOrden(g)} />
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">Cada problema es un caso propio: la base garantiza un solo caso vivo por orden y tipo con un índice único filtrado. Si la aplicación falla, la base lo impide igual.</p>

      {modal && <ModalMotivo modal={modal} onClose={() => setModal(null)} onConfirm={(det) => { if (modal.grupo) { ejecutarOrden(modal.grupo, modal.accion, det); return; } const c = casos.find(x => x.casoId === modal.casoId); if (modal.accion === 'ASUMIR' && c) { setModal(null); cancelarConMotivo(c, det); } else ejecutar(modal.casoId, modal.accion, det); }} />}
    </div>
  );
}

/** Detalle de UNA orden: qué problemas tiene, una sola historia y un solo seguimiento para toda la orden. */
function DetalleOrden({ grupo: g, detalles, usuarios = [], onAccionCaso, onAccionOrden, onAsignar, onIngresar }) {
  const [operativa, setOperativa] = useState(ACCIONES_OPERATIVAS[0]);
  const [det, setDet] = useState('');
  const [asignarA, setAsignarA] = useState(g.casos.map(c => c.responsableId).find(Boolean) ? String(g.casos.map(c => c.responsableId).find(Boolean)) : '');
  const [limite, setLimite] = useState(g.fechaLimite || '');
  const vivo = (t) => g.vivos.find(c => c.tipo === t);
  const enDeposito = g.vivos.find(c => TIPOS_DE_ORDEN_EN_DEPOSITO.includes(c.tipo));   // caso a través del cual se ejecuta la acción sobre la orden
  const faltante = vivo('FALTANTE'), sobrante = vivo('SOBRANTE'), sinIngreso = vivo('SIN_INGRESO'), noRegistrada = vivo('NO_REGISTRADA');
  const abierta = g.vivos.length > 0;
  // Historia única: los eventos de todos los problemas, en orden de fecha, cada uno con su chip
  const cargando = g.casos.some(c => detalles[c.casoId] === undefined);
  const eventos = g.casos.flatMap(c => ((detalles[c.casoId] && detalles[c.casoId].eventos) || []).map(e => ({ ...e, tipo_caso: c.tipo, tipoNombre: c.tipoNombre })))
    .sort((a, b) => new Date(a.fecha) - new Date(b.fecha) || a.id - b.id);
  const guardarAsignacion = () => {
    const u = usuarios.find(x => String(x.id) === asignarA);
    if (!u) return toast.error('Elegí un responsable.');
    onAsignar({ responsableId: u.id, responsableNombre: u.nombre, fechaLimite: limite || null, detalle: null });
  };
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <span className="font-mono font-bold text-indigo-800 text-sm">{g.ordenCodigo}</span>
        <span className="text-slate-600">{g.cliente}</span>
        <span className="text-slate-400">{g.valor ? '· ' + plata(g.valor) : ''}</span>
      </div>

      {/* Problemas de la orden */}
      <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3">
        <div className="font-bold text-slate-600 mb-1.5">Problemas ({g.casos.length})</div>
        <div className="flex flex-col gap-1">
          {g.casos.map(c => (
            <div key={c.casoId} className="flex flex-wrap items-center gap-2">
              <span className={`inline-block w-2 h-2 rounded-full ${SEV[c.severidad]}`} title={`Severidad ${c.severidad}`} />
              <span className={`text-white text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${TIPO_COLOR[c.tipo] || 'bg-slate-500'} ${c.vivo ? '' : 'opacity-40 line-through'}`} title={c.tipoDescripcion || ''}>{c.tipoNombre}</span>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ESTADO_CLS[c.estado]}`}>{c.estado.replace('_', ' ')}</span>
              {c.reincidente && <span className="text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">REINCIDENTE</span>}
              <span className="text-slate-500">{c.veces} vez{c.veces > 1 ? 'es' : ''} · desde {fmtF(c.primeraDeteccion)} ({c.primeraAud}) · última {fmtF(c.ultimaDeteccion)} ({c.ultimaAud}){c.diasEnDeposito != null ? ` · ${c.diasEnDeposito} días en depósito` : ''}</span>
              {!c.vivo && <span className="text-slate-500">· cierre: <b>{c.motivoCierre || c.estado}</b> {fmtFH(c.cerradoEn)}{c.cerradoPor ? ' · ' + c.cerradoPor : ''}</span>}
              <span className="font-mono text-slate-300">{c.codigo}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Acciones sobre depósito (cambian la orden real) */}
      {(faltante || enDeposito || sobrante || sinIngreso || noRegistrada) && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-white p-3 flex flex-wrap gap-2 items-center">
          <span className="font-bold text-slate-600">Acciones sobre depósito:</span>
          {faltante && <button onClick={() => onAccionCaso(faltante.casoId, 'ASUMIR', `Cancelar la orden ${g.ordenCodigo} en depósito`, '')} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded" title="Cancela la orden en depósito (estado 10, igual que Caja) y cierra la orden como pérdida asumida">Cancelar</button>}
          {enDeposito && <button onClick={() => onAccionCaso(enDeposito.casoId, 'ENTREGAR', `Entregar ${g.ordenCodigo}: marcarla como ENTREGADA en depósito`, '')} className="px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold rounded" title="Estado 9, retiro entregado, estante liberado, bultos despachados. Cierra todos los problemas de la orden">Entregar</button>}
          {enDeposito && <button onClick={() => onAccionCaso(enDeposito.casoId, 'AVISAR', `Avisar nuevamente a ${g.cliente || 'el cliente'} (${g.ordenCodigo})`, '')} className="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white font-bold rounded" title="Estado 12: el cron reenvía el WhatsApp">Avisar</button>}
          {sobrante && <button onClick={() => onAccionCaso(sobrante.casoId, 'REGRESAR', `Regresar ${g.ordenCodigo} a Depósito`, '')} className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded" title="Estado 7 Pronto para entregar y retiro pendiente">Regresar</button>}
          {sinIngreso && <button onClick={onIngresar} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded" title="Mismo proceso que Recepción">Ingresar</button>}
          {noRegistrada && !sinIngreso && <span className="text-slate-500">No existe en el sistema: si es real, hay que ingresarla escaneando su etiqueta en Recepción.</span>}
          <span className="text-[10px] text-slate-400 ml-auto">Cambian el estado real de la orden y cierran sus problemas.</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
        {/* Historia única de la orden */}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="font-bold text-slate-600 mb-2">Historia de la orden</div>
          {cargando ? <div className="text-slate-400"><Loader2 size={14} className="inline animate-spin" /> Cargando…</div> : (
            <div className="max-h-80 overflow-y-auto pl-3 pr-1">
            <ol className="border-l-2 border-slate-200 pl-3 space-y-1.5">
              {eventos.map(e => (
                <li key={`${e.tipo_caso}-${e.id}`} className="relative">
                  <span className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full ${e.tipo === 'DETECCION' ? 'bg-red-500' : e.tipo === 'CAMBIO_ESTADO' ? 'bg-green-500' : e.tipo === 'COMENTARIO' ? 'bg-slate-400' : 'bg-indigo-500'}`} />
                  <div className="text-[10px] text-slate-400">{fmtFH(e.fecha)} · {e.usuario || 'sistema'}{e.auditoria ? ' · ' + e.auditoria : ''} · <span className={`text-white px-1 rounded whitespace-nowrap ${TIPO_COLOR[e.tipo_caso] || 'bg-slate-500'}`}>{e.tipoNombre}</span></div>
                  <div className="text-slate-700">{e.detalle}</div>
                </li>
              ))}
            </ol>
            </div>
          )}
        </div>

        {/* Seguimiento de la orden: se aplica a todos sus problemas */}
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="font-bold text-slate-600 mb-2">Seguimiento de la orden <span className="font-normal text-slate-400">(se aplica a {abierta ? `sus ${g.vivos.length} problema${g.vivos.length > 1 ? 's' : ''} abierto${g.vivos.length > 1 ? 's' : ''}` : 'sus problemas cerrados'})</span></div>
          {abierta ? (
            <>
              <div className="flex flex-wrap gap-2 items-center">
                <select value={operativa} onChange={e => setOperativa(e.target.value)} className="text-xs border-slate-300 rounded py-1">{ACCIONES_OPERATIVAS.map(a => <option key={a}>{a}</option>)}</select>
                <input value={det} onChange={e => setDet(e.target.value)} placeholder="Detalle (ej: buscado en estante B-2)" className="text-xs border border-slate-300 rounded px-2 py-1 w-52" />
                <button onClick={() => onAccionOrden('REGISTRAR', `Registrar anotación en ${g.ordenCodigo}`, `${operativa}${det ? ': ' + det : ''}`, false)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded">Registrar</button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {g.vivos.some(c => c.estado === 'ABIERTO') && <button onClick={() => onAccionOrden('TOMAR', null, null, true)} className="px-3 py-1.5 bg-white border border-indigo-300 text-indigo-700 font-bold rounded hover:bg-indigo-50">Tomar (asignarme)</button>}
                <button onClick={() => onAccionOrden('ESPERAR', `Dejar ${g.ordenCodigo} en espera`, '', false)} className="px-3 py-1.5 bg-white border border-amber-300 text-amber-700 font-bold rounded hover:bg-amber-50">En espera de un tercero</button>
                <button onClick={() => onAccionOrden('COMENTAR', `Comentar ${g.ordenCodigo}`, '', false)} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 font-bold rounded hover:bg-slate-50">Comentar</button>
                <button onClick={() => onAccionOrden('RESOLVER', `Marcar ${g.ordenCodigo} como RESUELTA`, '', false)} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded">Marcar resuelta</button>
              </div>
              <div className="mt-2 pt-2 border-t border-slate-200 flex flex-wrap gap-2 items-center">
                <span className="font-bold text-slate-600">Responsable:</span>
                <select value={asignarA} onChange={e => setAsignarA(e.target.value)} className="text-xs border-slate-300 rounded py-1">
                  <option value="">Elegir…</option>
                  {usuarios.map(u => <option key={u.id} value={String(u.id)}>{u.nombre}</option>)}
                </select>
                <span className="font-bold text-slate-600">Fecha límite:</span>
                <input type="date" value={limite} onChange={e => setLimite(e.target.value)} className="text-xs border border-slate-300 rounded px-2 py-1" />
                <button onClick={guardarAsignacion} className="px-3 py-1.5 bg-white border border-indigo-300 text-indigo-700 font-bold rounded hover:bg-indigo-50">Guardar</button>
              </div>
            </>
          ) : (
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-slate-500">La orden no tiene problemas abiertos.</span>
              <button onClick={() => onAccionOrden('REABRIR', `Reabrir los problemas de ${g.ordenCodigo}`, '', false)} className="px-3 py-1.5 bg-white border border-red-300 text-red-700 font-bold rounded hover:bg-red-50">Reabrir (con motivo)</button>
              <button onClick={() => onAccionOrden('COMENTAR', `Comentar ${g.ordenCodigo}`, '', false)} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 font-bold rounded hover:bg-slate-50">Comentar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
function ModalMotivo({ modal, onClose, onConfirm }) {
  const [det, setDet] = useState(modal.texto || '');
  const obligatorio = ['RESOLVER', 'ASUMIR', 'ESPERAR', 'COMENTAR', 'REABRIR', 'REGISTRAR'].includes(modal.accion);
  const textos = {
    RESOLVER: 'Todos los problemas abiertos de la orden pasan a RESUELTO con este motivo. Si alguno vuelve a aparecer en una auditoría, se reabre como reincidente.',
    ASUMIR: 'Cancela la orden en depósito con el mismo proceso que Caja: estado 10, retiro ajustado y reversión del cargo en cuenta si lo tenía. El caso se cierra como pérdida ASUMIDA con vos como responsable. El motivo queda en la historia.',
    ESPERAR: 'La orden queda ESPERANDO (depende de un tercero: cliente, mensajería, otra área).',
    COMENTAR: 'Se agrega el comentario a la historia de la orden. No cambia el estado.',
    REABRIR: 'Los problemas cerrados de la orden vuelven a ABIERTO.',
    REGISTRAR: 'Se registra la anotación en la historia de la orden (en todos sus problemas abiertos). Los que estaban ABIERTO pasan a EN CURSO y quedás como responsable.',
    ENTREGAR: 'La orden pasa a ENTREGADA en depósito: estado 9, retiro entregado, estante liberado, bultos despachados. Se usa cuando salió sin pasar por el sistema. Los problemas de la orden quedan resueltos.',
    REGRESAR: 'La orden vuelve a "Pronto para entregar" y su retiro queda pendiente otra vez (si el cliente tiene saldo, se aplica solo). El caso queda RESUELTO.',
    AVISAR: 'La orden pasa a estado 12 y el cron reenvía el WhatsApp. El caso pasa a EN CURSO con vos como responsable.',
  };
  return (
    <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-800 mb-2">{modal.titulo}</h3>
        <p className="text-xs text-slate-600 mb-3">{textos[modal.accion]}</p>
        <label className="block text-xs font-bold text-slate-700 mb-1">{modal.accion === 'COMENTAR' ? 'Comentario' : modal.accion === 'REGISTRAR' ? 'Anotación' : ['ENTREGAR', 'REGRESAR', 'AVISAR'].includes(modal.accion) ? 'Detalle' : 'Motivo'}{obligatorio ? ' (obligatorio)' : ' (opcional)'}</label>
        <textarea value={det} onChange={e => setDet(e.target.value)} rows={3} maxLength={500} className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2" autoFocus />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Cancelar</button>
          <button onClick={() => { if (obligatorio && !det.trim()) return toast.error('Escribí el motivo.'); onConfirm(det.trim()); }} className="px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Confirmar</button>
        </div>
      </div>
    </div>
  );
}
