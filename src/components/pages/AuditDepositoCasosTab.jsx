import React, { useEffect, useMemo, useState } from 'react';
import api from '../../services/apiClient';
import { toast } from 'react-hot-toast';
import * as XLSX from 'xlsx';
import { Download, Loader2, Search, ChevronDown, ChevronRight, History } from 'lucide-react';

const SEV = { ALTA: 'bg-red-500', MEDIA: 'bg-amber-500', BAJA: 'bg-slate-400' };
const TIPO_COLOR = { FALTANTE: 'bg-red-600', SOBRANTE: 'bg-orange-500', SIN_INGRESO: 'bg-purple-600', NO_REGISTRADA: 'bg-slate-500', SIN_AVISO: 'bg-violet-500', PERMANENCIA: 'bg-amber-600' };
const ESTADO_CLS = { ABIERTO: 'bg-red-50 text-red-700 border-red-200', EN_CURSO: 'bg-indigo-50 text-indigo-700 border-indigo-200', ESPERANDO: 'bg-amber-50 text-amber-700 border-amber-200', RESUELTO: 'bg-green-50 text-green-700 border-green-200', ASUMIDO: 'bg-slate-100 text-slate-600 border-slate-300' };
const ACCIONES_OPERATIVAS = ['Recontado', 'Avisado al cliente', 'Revertido a depósito', 'Alta manual en el sistema', 'Derivado a responsable', 'Otra'];
const fmtF = (d) => (d ? new Date(d).toLocaleDateString('es-UY') : '');
const fmtFH = (d) => (d ? new Date(d).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const plata = (v) => '$ ' + new Intl.NumberFormat('es-UY', { maximumFractionDigits: 0 }).format(Math.round(Number(v) || 0));
const errorDe = (e) => e?.response?.data?.error || e?.message || 'Error';

/**
 * Pestaña "Registro de Casos": lista única y permanente. Cada auditoría suma los casos nuevos;
 * los que ya están no se duplican. Acciones individuales y en lote; historial de auditorías.
 */
export default function AuditDepositoCasosTab({ estado, refreshKey, onKpis }) {
  const [filtro, setFiltro] = useState('VIVOS');
  const [tipo, setTipo] = useState('');
  const [busca, setBusca] = useState('');
  const [q, setQ] = useState('');
  const [casos, setCasos] = useState([]);
  const [kpis, setKpis] = useState(null);
  const [tipos, setTipos] = useState({});
  const [loading, setLoading] = useState(false);
  const [abierto, setAbierto] = useState(null);      // casoId desplegado
  const [detalle, setDetalle] = useState(null);      // { caso, eventos }
  const [marc, setMarc] = useState({});
  const [lote, setLote] = useState({ accion: 'REGISTRAR', operativa: ACCIONES_OPERATIVAS[0], detalle: '' });
  const [modal, setModal] = useState(null);          // { casoId, accion, titulo, texto }
  const [historial, setHistorial] = useState(null);
  const [verHistorial, setVerHistorial] = useState(false);
  const [bump, setBump] = useState(0);
  const [usuarios, setUsuarios] = useState([]);        // internos activos, para asignar
  const [responsables, setResponsables] = useState([]); // responsables con casos vivos (del listado)
  const [responsable, setResponsable] = useState('');   // '' todos | 'SIN_ASIGNAR' | id

  const auditoriasCerradas = kpis ? kpis.auditoriasCerradas : (estado?.auditoriasCerradas || 0);
  const mostrarCronicos = auditoriasCerradas >= 2;

  useEffect(() => { const t = setTimeout(() => setQ(busca), 300); return () => clearTimeout(t); }, [busca]);
  useEffect(() => { api.get('/audit-deposito/usuarios').then(({ data }) => { if (data.success) setUsuarios(data.data || []); }).catch(() => {}); }, []);

  useEffect(() => {
    let vivo = true;
    setLoading(true);
    api.get('/audit-deposito/casos', { params: { estado: filtro, tipo: tipo || undefined, q: q || undefined, responsableId: responsable || undefined } })
      .then(({ data }) => {
        if (!vivo || !data.success) return;
        setCasos(data.casos || []); setKpis(data.kpis || null); setTipos(data.tipos || {}); setResponsables(data.responsables || []);
        onKpis && onKpis(data.kpis || null);
      })
      .catch(e => toast.error('No se pudo cargar el registro: ' + errorDe(e)))
      .finally(() => vivo && setLoading(false));
    return () => { vivo = false; };
  }, [filtro, tipo, q, responsable, refreshKey, bump]);

  useEffect(() => {
    if (!verHistorial) return;
    api.get('/audit-deposito/auditorias', { params: { limit: 30 } }).then(({ data }) => { if (data.success) setHistorial(data.data || []); }).catch(() => {});
  }, [verHistorial, refreshKey, bump]);

  const cargarDetalle = (casoId) => {
    setDetalle(null);
    api.get(`/audit-deposito/casos/${casoId}`).then(({ data }) => { if (data.success) setDetalle(data); }).catch(e => toast.error(errorDe(e)));
  };
  const toggleFila = (casoId) => {
    if (abierto === casoId) { setAbierto(null); setDetalle(null); return; }
    setAbierto(casoId); cargarDetalle(casoId);
  };
  const ejecutar = async (casoId, accion, det, extra = {}) => {
    try {
      const { data } = await api.post(`/audit-deposito/casos/${casoId}/accion`, { accion, detalle: det || null, ...extra });
      toast.success(data.message);
      setModal(null); setBump(x => x + 1);
      if (abierto === casoId) cargarDetalle(casoId);
    } catch (e) { toast.error(errorDe(e)); }
  };
  const ejecutarLote = async () => {
    const ids = Object.keys(marc).filter(k => marc[k]).map(Number);
    if (!ids.length) return;
    const det = lote.accion === 'REGISTRAR' ? `${lote.operativa}${lote.detalle ? ': ' + lote.detalle : ''}` : lote.detalle;
    if (['REGISTRAR', 'RESOLVER', 'ASUMIR', 'ESPERAR', 'COMENTAR'].includes(lote.accion) && !det) return toast.error('Escribí el motivo o detalle.');
    const usuarioLote = usuarios.find(u => String(u.id) === String(lote.responsableId));
    if (lote.accion === 'ASIGNAR' && !usuarioLote) return toast.error('Elegí a quién asignar.');
    const nombres = { REGISTRAR: 'registrar la acción', TOMAR: 'tomar', RESOLVER: 'marcar RESUELTO', ASUMIR: 'cerrar como pérdida ASUMIDA', ESPERAR: 'dejar en espera', ASIGNAR: `asignar a ${usuarioLote ? usuarioLote.nombre : ''}${lote.fechaLimite ? ' con fecha límite ' + lote.fechaLimite : ''}` };
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
    const rows = casos.map(c => ({ Caso: c.codigo, Orden: c.ordenCodigo, Cliente: c.cliente, Tipo: c.tipoNombre, Estado: c.estado, Severidad: c.severidad, Veces: c.veces, Reincidente: c.reincidente ? 'SI' : '', 'Valor $': c.valorPesos, 'Días en depósito': c.diasEnDeposito, 'Primera detección': fmtF(c.primeraDeteccion), 'Primera auditoría': c.primeraAud, 'Última detección': fmtF(c.ultimaDeteccion), 'Última auditoría': c.ultimaAud, Responsable: c.responsable || '', 'Motivo cierre': c.motivoCierre || '', 'Cerrado en': fmtF(c.cerradoEn) }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Casos');
    XLSX.writeFile(wb, `Registro_Casos_Deposito_${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const nMarc = Object.keys(marc).filter(k => marc[k]).length;
  const FILTROS = useMemo(() => [
    { k: 'VIVOS', n: 'Abiertos', c: kpis?.vivos },
    ...(mostrarCronicos ? [{ k: 'CRONICOS', n: 'Crónicos (3+ auditorías)', c: kpis?.cronicos }] : []),
    { k: 'REINCIDENTES', n: 'Reincidentes', c: kpis?.reincidentes },
    { k: 'ALTA', n: 'Severidad alta', c: kpis?.alta },
    { k: 'VENCIDOS', n: 'Fecha límite vencida', c: kpis?.vencidos },
    { k: 'CERRADOS', n: 'Cerrados', c: kpis?.cerrados },
    { k: 'TODOS', n: 'Todos', c: kpis?.total },
  ], [kpis, mostrarCronicos]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-bold text-indigo-800">Registro de Casos</h3>
          <p className="text-xs text-indigo-700/80 mt-1 font-medium">Lista única y permanente. Cada auditoría suma los casos nuevos; los que ya están acá <b>no se duplican</b>. Ordenados por severidad y valor.</p>
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
            { l: 'Casos abiertos', v: kpis.vivos, p: 'en seguimiento', c: 'border-indigo-200' },
            ...(mostrarCronicos ? [{ l: 'Crónicos', v: kpis.cronicos, p: '3+ auditorías seguidas', c: 'border-red-200' }] : [{ l: 'Crónicos', v: '—', p: 'desde la 2ª auditoría', c: 'border-slate-200' }]),
            { l: 'Severidad alta', v: kpis.alta, p: 'atacar primero', c: 'border-red-200' },
            { l: 'Reincidentes', v: kpis.reincidentes, p: 'volvieron tras cerrarse', c: 'border-amber-200' },
            { l: 'Cerrados', v: kpis.cerrados, p: 'histórico acumulado', c: 'border-green-200' },
            { l: 'Auditorías', v: kpis.auditoriasCerradas, p: 'cerradas hasta hoy', c: 'border-violet-200' },
          ].map(k => (
            <div key={k.l} className={`rounded-xl border bg-white p-3 ${k.c}`}>
              <div className="text-[10px] font-bold uppercase text-slate-500">{k.l}</div>
              <div className="text-2xl font-extrabold font-mono text-slate-800">{k.v}</div>
              <div className="text-[10px] text-slate-400">{k.p}</div>
            </div>
          ))}
        </div>
      )}

      {/* Historial */}
      {verHistorial && (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="text-xs font-bold text-slate-700 mb-2">Historial de auditorías — cada corrida guarda su fotografía y el resultado de la fusión</div>
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
          <button key={f.k} onClick={() => { setFiltro(f.k); setAbierto(null); }} className={`px-3 py-1 rounded-full text-xs font-bold border ${filtro === f.k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
            {f.n}{f.c != null && <span className="ml-1 opacity-70">{f.c}</span>}
          </button>
        ))}
        <select value={tipo} onChange={e => setTipo(e.target.value)} className="text-xs border-slate-300 rounded py-1">
          <option value="">Todos los tipos</option>
          {Object.entries(tipos).map(([k, t]) => <option key={k} value={k}>{t.nombre}</option>)}
        </select>
        <select value={responsable} onChange={e => { setResponsable(e.target.value); setAbierto(null); }} className="text-xs border-slate-300 rounded py-1" title="Filtrar por responsable">
          <option value="">Todos los responsables</option>
          <option value="SIN_ASIGNAR">Sin asignar</option>
          {responsables.map(r => <option key={r.id} value={String(r.id)}>{r.nombre} ({r.n})</option>)}
        </select>
        <div className="relative">
          <Search size={14} className="absolute left-2 top-2 text-slate-400" />
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar caso, orden o cliente…" className="pl-7 pr-2 py-1 text-xs border border-slate-300 rounded w-56" />
        </div>
        {loading && <Loader2 size={16} className="animate-spin text-indigo-500" />}
      </div>

      {/* Lote */}
      {nMarc > 0 && (
        <div className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50 p-2.5 flex flex-wrap items-center gap-2 text-xs">
          <b className="text-indigo-800">{nMarc} caso{nMarc > 1 ? 's' : ''} seleccionado{nMarc > 1 ? 's' : ''}</b>
          <select value={lote.accion} onChange={e => setLote({ ...lote, accion: e.target.value })} className="text-xs border-slate-300 rounded py-1">
            <option value="REGISTRAR">Registrar acción (pasa a EN CURSO)</option>
            <option value="TOMAR">Tomar (asignarme, EN CURSO)</option>
            <option value="ESPERAR">Dejar en espera de un tercero</option>
            <option value="RESOLVER">Marcar RESUELTO (con motivo)</option>
            <option value="ASUMIR">Asumir la pérdida (cierra con motivo)</option>
            <option value="ASIGNAR">Asignar responsable y fecha límite</option>
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
          <input value={lote.detalle} onChange={e => setLote({ ...lote, detalle: e.target.value })} placeholder={['REGISTRAR', 'ASIGNAR', 'TOMAR'].includes(lote.accion) ? 'Detalle (opcional)' : 'Motivo (obligatorio)'} className="text-xs border border-slate-300 rounded px-2 py-1 w-64" />
          <button onClick={ejecutarLote} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded">Ejecutar en {nMarc}</button>
          <button onClick={() => setMarc({})} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 rounded">Quitar selección</button>
        </div>
      )}

      {/* Tabla */}
      <div className="overflow-x-auto bg-white rounded-lg border border-slate-200 shadow-sm">
        {!casos.length ? (
          <div className="py-12 flex flex-col items-center justify-center text-slate-400"><Search size={32} className="mb-3 opacity-50" /><p className="text-sm font-medium">{loading ? 'Cargando…' : 'No hay casos con este filtro.'}</p></div>
        ) : (
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200 text-xs">
              <tr>
                <th className="px-3 py-2 w-8"><input type="checkbox" checked={casos.length > 0 && casos.every(c => marc[c.casoId])} onChange={e => { const m = {}; if (e.target.checked) casos.forEach(c => { m[c.casoId] = true; }); setMarc(m); }} /></th>
                <th className="px-3 py-2">Caso</th><th className="px-3 py-2">Orden</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2 text-right">Veces</th><th className="px-3 py-2">Detectado</th><th className="px-3 py-2">Última vez</th><th className="px-3 py-2 text-right">Valor</th><th className="px-3 py-2">Responsable</th><th className="px-3 py-2">Fecha límite</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {casos.map(c => {
                const esAb = abierto === c.casoId;
                return (
                  <React.Fragment key={c.casoId}>
                    <tr className={`hover:bg-slate-50/70 cursor-pointer ${marc[c.casoId] ? 'bg-indigo-50/40' : ''}`} onClick={() => toggleFila(c.casoId)}>
                      <td className="px-3 py-2" onClick={e => e.stopPropagation()}><input type="checkbox" checked={!!marc[c.casoId]} onChange={e => setMarc({ ...marc, [c.casoId]: e.target.checked })} /></td>
                      <td className="px-3 py-2 font-mono font-bold text-slate-800"><span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${SEV[c.severidad]}`} title={`Severidad ${c.severidad}`} />{esAb ? <ChevronDown size={12} className="inline mr-1" /> : <ChevronRight size={12} className="inline mr-1" />}{c.codigo}</td>
                      <td className="px-3 py-2 font-mono font-bold text-indigo-800">{c.ordenCodigo}</td>
                      <td className="px-3 py-2 text-slate-700 max-w-[220px] truncate">{c.cliente || <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2"><span className={`text-white text-[10px] font-bold px-2 py-0.5 rounded-full ${TIPO_COLOR[c.tipo] || 'bg-slate-500'}`}>{c.tipoNombre}</span></td>
                      <td className="px-3 py-2"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ESTADO_CLS[c.estado]}`}>{c.estado.replace('_', ' ')}</span>{c.reincidente && <span className="ml-1 text-[9px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">REINCIDENTE</span>}</td>
                      <td className={`px-3 py-2 text-right font-mono font-bold ${c.veces >= 3 ? 'text-red-600' : 'text-slate-700'}`}>{c.veces >= 3 ? '×' : ''}{c.veces}</td>
                      <td className="px-3 py-2 text-xs"><b>{fmtF(c.primeraDeteccion)}</b><div className="text-[10px] text-slate-400">{c.primeraAud}</div></td>
                      <td className="px-3 py-2 text-xs"><b>{fmtF(c.ultimaDeteccion)}</b><div className="text-[10px] text-slate-400">{c.ultimaAud}</div></td>
                      <td className="px-3 py-2 text-right font-mono text-xs">{c.valorPesos ? plata(c.valorPesos) : '—'}</td>
                      <td className="px-3 py-2 text-xs">{c.responsable || <span className="text-slate-400 bg-slate-100 px-1.5 rounded">sin asignar</span>}</td>
                      <td className={`px-3 py-2 text-xs font-mono ${c.vencido ? 'text-red-700 font-bold' : 'text-slate-600'}`}>{c.fechaLimite ? c.fechaLimite.split('-').reverse().join('/') : ''}{c.vencido && <span className="ml-1 text-[9px] bg-red-100 text-red-700 px-1 rounded">VENCIDA</span>}</td>
                    </tr>
                    {esAb && (
                      <tr><td colSpan={12} className="bg-slate-50 px-4 py-3">
                        <DetalleCaso caso={c} detalle={detalle} usuarios={usuarios}
                          onAccion={(accion, titulo, texto, sinMotivo) => sinMotivo ? ejecutar(c.casoId, accion) : setModal({ casoId: c.casoId, accion, titulo, texto })}
                          onAsignar={(payload) => ejecutar(c.casoId, 'ASIGNAR', payload.detalle, payload)} />
                      </td></tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-2 text-[11px] text-slate-400">La deduplicación se garantiza en la base con un índice único filtrado: <code>UNIQUE (OrdIdOrden, Tipo) WHERE Estado IN ('ABIERTO','EN_CURSO','ESPERANDO')</code>. Si la aplicación falla, la base lo impide igual.</p>

      {modal && <ModalMotivo modal={modal} onClose={() => setModal(null)} onConfirm={(det) => ejecutar(modal.casoId, modal.accion, det)} />}
    </div>
  );
}

function DetalleCaso({ caso, detalle, onAccion, onAsignar, usuarios = [] }) {
  const [operativa, setOperativa] = useState(ACCIONES_OPERATIVAS[0]);
  const [det, setDet] = useState('');
  const [asignarA, setAsignarA] = useState(caso.responsableId ? String(caso.responsableId) : '');
  const [limite, setLimite] = useState(caso.fechaLimite || '');
  const vivo = caso.vivo;
  const guardarAsignacion = () => {
    const u = usuarios.find(x => String(x.id) === asignarA);
    if (!u) return toast.error('Elegí un responsable.');
    onAsignar({ responsableId: u.id, responsableNombre: u.nombre, fechaLimite: limite || null, detalle: null });
  };
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
      <div>
        <h4 className="font-bold text-slate-700 mb-2">Historia del caso {caso.codigo} · orden {caso.ordenCodigo}{caso.diasEnDeposito != null ? ` · ${caso.diasEnDeposito} días en depósito` : ''}</h4>
        {!detalle ? <div className="text-slate-400"><Loader2 size={14} className="inline animate-spin" /> Cargando…</div> : (
          <ol className="border-l-2 border-slate-200 pl-3 space-y-2">
            {detalle.eventos.map(e => (
              <li key={e.id} className="relative">
                <span className={`absolute -left-[19px] top-1 w-2.5 h-2.5 rounded-full ${e.tipo === 'DETECCION' ? 'bg-red-500' : e.tipo === 'CAMBIO_ESTADO' ? 'bg-green-500' : e.tipo === 'COMENTARIO' ? 'bg-slate-400' : 'bg-indigo-500'}`} />
                <div className="text-[10px] text-slate-400">{fmtFH(e.fecha)} · {e.usuario || 'sistema'}{e.auditoria ? ' · ' + e.auditoria : ''}</div>
                <div className="text-slate-700">{e.detalle}</div>
              </li>
            ))}
          </ol>
        )}
        {caso.motivoCierre && <div className="mt-2 text-slate-600">Cierre: <b>{caso.motivoCierre}</b> ({fmtF(caso.cerradoEn)} · {caso.cerradoPor})</div>}
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <h4 className="font-bold text-slate-700 mb-2">Acciones</h4>
        {vivo ? (
          <>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={operativa} onChange={e => setOperativa(e.target.value)} className="text-xs border-slate-300 rounded py-1">{ACCIONES_OPERATIVAS.map(a => <option key={a}>{a}</option>)}</select>
              <input value={det} onChange={e => setDet(e.target.value)} placeholder="Detalle (ej: hallado en estante B-2)" className="text-xs border border-slate-300 rounded px-2 py-1 w-56" />
              <button onClick={() => onAccion('REGISTRAR', `Registrar acción en ${caso.codigo}`, `${operativa}${det ? ': ' + det : ''}`, false)} className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded">Registrar acción</button>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {caso.estado === 'ABIERTO' && <button onClick={() => onAccion('TOMAR', null, null, true)} className="px-3 py-1.5 bg-white border border-indigo-300 text-indigo-700 font-bold rounded hover:bg-indigo-50">Tomar (asignarme)</button>}
              <button onClick={() => onAccion('ESPERAR', `Dejar ${caso.codigo} en espera`, '', false)} className="px-3 py-1.5 bg-white border border-amber-300 text-amber-700 font-bold rounded hover:bg-amber-50">En espera de un tercero</button>
              <button onClick={() => onAccion('COMENTAR', `Comentar ${caso.codigo}`, '', false)} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 font-bold rounded hover:bg-slate-50">Comentar</button>
              <button onClick={() => onAccion('RESOLVER', `Marcar ${caso.codigo} como RESUELTO`, '', false)} className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded">Marcar resuelto</button>
              <button onClick={() => onAccion('ASUMIR', `Asumir la pérdida en ${caso.codigo}`, '', false)} className="px-3 py-1.5 bg-slate-700 hover:bg-slate-800 text-white font-bold rounded">Asumir pérdida</button>
            </div>
            <div className="mt-3 pt-3 border-t border-slate-200 flex flex-wrap gap-2 items-center">
              <span className="font-bold text-slate-600">Responsable:</span>
              <select value={asignarA} onChange={e => setAsignarA(e.target.value)} className="text-xs border-slate-300 rounded py-1">
                <option value="">Elegir…</option>
                {usuarios.map(u => <option key={u.id} value={String(u.id)}>{u.nombre}</option>)}
              </select>
              <span className="font-bold text-slate-600">Fecha límite:</span>
              <input type="date" value={limite} onChange={e => setLimite(e.target.value)} className="text-xs border border-slate-300 rounded px-2 py-1" />
              <button onClick={guardarAsignacion} className="px-3 py-1.5 bg-white border border-indigo-300 text-indigo-700 font-bold rounded hover:bg-indigo-50">Guardar responsable y fecha límite</button>
              {caso.vencido && <span className="text-[10px] font-bold text-red-700">Fecha límite vencida</span>}
            </div>
            <p className="mt-2 text-[10px] text-slate-400">Resolver y asumir exigen motivo. Asumir además deja al usuario como responsable. Un caso cerrado que reaparece en una auditoría se reabre solo como reincidente.</p>
          </>
        ) : (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-slate-500">El caso está cerrado ({caso.estado}).</span>
            <button onClick={() => onAccion('REABRIR', `Reabrir ${caso.codigo}`, '', false)} className="px-3 py-1.5 bg-white border border-red-300 text-red-700 font-bold rounded hover:bg-red-50">Reabrir a mano (con motivo)</button>
            <button onClick={() => onAccion('COMENTAR', `Comentar ${caso.codigo}`, '', false)} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-700 font-bold rounded hover:bg-slate-50">Comentar</button>
          </div>
        )}
      </div>
    </div>
  );
}

function ModalMotivo({ modal, onClose, onConfirm }) {
  const [det, setDet] = useState(modal.texto || '');
  const obligatorio = ['RESOLVER', 'ASUMIR', 'ESPERAR', 'COMENTAR', 'REABRIR', 'REGISTRAR'].includes(modal.accion);
  const textos = {
    RESOLVER: 'El caso pasa a RESUELTO con este motivo. Si vuelve a aparecer en una auditoría, se reabre como reincidente.',
    ASUMIR: 'El caso se cierra como pérdida ASUMIDA. Queda registrado el motivo y vos como responsable. Un ajuste sin causa registrada reaparece en el próximo control.',
    ESPERAR: 'El caso queda ESPERANDO (depende de un tercero: cliente, mensajería, otra área).',
    COMENTAR: 'Se agrega un comentario a la historia del caso. No cambia el estado.',
    REABRIR: 'El caso vuelve a ABIERTO.',
    REGISTRAR: 'Se registra la acción en la historia del caso. Si estaba ABIERTO pasa a EN CURSO y quedás como responsable.',
  };
  return (
    <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-800 mb-2">{modal.titulo}</h3>
        <p className="text-xs text-slate-600 mb-3">{textos[modal.accion]}</p>
        <label className="block text-xs font-bold text-slate-700 mb-1">{modal.accion === 'COMENTAR' ? 'Comentario' : modal.accion === 'REGISTRAR' ? 'Acción realizada' : 'Motivo'}{obligatorio ? ' (obligatorio)' : ''}</label>
        <textarea value={det} onChange={e => setDet(e.target.value)} rows={3} maxLength={500} className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2" autoFocus />
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Cancelar</button>
          <button onClick={() => { if (obligatorio && !det.trim()) return toast.error('Escribí el motivo.'); onConfirm(det.trim()); }} className="px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Confirmar</button>
        </div>
      </div>
    </div>
  );
}
