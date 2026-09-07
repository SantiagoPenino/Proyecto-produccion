import React, { useEffect, useState } from 'react';
import api from '../../services/apiClient';
import { toast } from 'react-hot-toast';
import { Camera, Lock, Unlock, XCircle, Loader2, Info } from 'lucide-react';

const fmtFecha = (d) => (d ? new Date(d).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const errorDe = (e) => e?.response?.data?.error || e?.message || 'Error';

/**
 * Barra de sesión de la Auditoría de Depósito: abrir (toma la fotografía), cerrar (motor de fusión) o anular.
 * props: estado = respuesta de GET /audit-deposito/sesion | null (cargando) | { sinSoporte: true }
 *        onChange() = recargar todo después de abrir/cerrar/anular
 */
export default function AuditDepositoSesionBar({ estado, onChange, loading }) {
  const [modal, setModal] = useState(null); // 'ABRIR' | 'CERRAR' | 'ANULAR' | { resumen }
  const [busy, setBusy] = useState(false);

  if (!estado) {
    return <div className="mb-4 px-4 lg:px-0 text-xs text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Consultando si hay una auditoría abierta…</div>;
  }
  if (estado.sinSoporte) {
    return (
      <div className="mb-4 mx-4 lg:mx-0 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 flex items-start gap-2">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div><b>El servidor todavía no tiene el módulo de sesiones de auditoría</b> (falta desplegar el backend y correr <code>scripts/add_auditoria_deposito.sql</code>). Mientras tanto la pantalla funciona como antes: los escaneos van a la lista temporal.</div>
      </div>
    );
  }

  const ses = estado.sesion;
  const ult = estado.ultimaCerrada;

  const cerrar = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/audit-deposito/sesion/cerrar');
      toast.success(data.message, { duration: 8000 });
      setModal({ resumen: data.data });
      onChange && onChange();
    } catch (e) { toast.error('No se pudo cerrar: ' + errorDe(e)); setModal(null); }
    finally { setBusy(false); }
  };
  const anular = async (motivo) => {
    setBusy(true);
    try {
      const { data } = await api.post('/audit-deposito/sesion/anular', { motivo });
      toast.success(data.message, { duration: 6000 });
      setModal(null);
      onChange && onChange();
    } catch (e) { toast.error('No se pudo anular: ' + errorDe(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="mb-4 mx-4 lg:mx-0">
      {ses ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 font-bold text-indigo-800"><Unlock size={15} /> Auditoría {ses.codigo} ABIERTA</span>
              <span className="text-xs text-indigo-700">desde {fmtFecha(ses.fechaApertura)} · {ses.usuarioApertura} · alcance: <b>{ses.alcanceTexto}</b></span>
              {ses.esLineaBase && <span className="text-[10px] font-bold uppercase bg-violet-600 text-white px-2 py-0.5 rounded-full">línea base</span>}
            </div>
            {ses.contadores && (
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
                <span>Fotografía: <b>{ses.contadores.snapshotCant}</b> órdenes</span>
                <span className="text-green-700">Escaneadas: <b>{ses.contadores.escaneadas}</b></span>
                <span className="text-red-700">Sin escanear: <b>{ses.contadores.sinEscanear}</b></span>
                <span className="text-orange-700">Figuran entregadas: <b>{ses.contadores.sobrantes}</b></span>
                <span className="text-purple-700">Sin ingreso: <b>{ses.contadores.sinIngreso}</b></span>
                <span className="text-slate-600">Desconocidos: <b>{ses.contadores.desconocidos}</b></span>
                {ses.contadores.fueraAlcance > 0 && <span className="text-slate-500">Fuera de alcance: <b>{ses.contadores.fueraAlcance}</b></span>}
                {ses.contadores.ingresoPosterior > 0 && <span className="text-slate-500">Ingresaron después: <b>{ses.contadores.ingresoPosterior}</b></span>}
                {ses.contadores.duplicados > 0 && <span className="text-amber-700">Lecturas repetidas: <b>{ses.contadores.duplicados}</b></span>}
              </div>
            )}
            <p className="mt-1 text-[11px] text-indigo-700/80">Lo que no se escaneó todavía es <b>pendiente de escaneo</b>, no extraviado. Los casos se generan recién al cerrar.</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setModal('CERRAR')} disabled={busy || loading} className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-900 disabled:bg-slate-400 text-white text-xs font-bold rounded-lg shadow-sm">
              <Lock size={14} /> Cerrar auditoría y generar casos
            </button>
            <button onClick={() => setModal('ANULAR')} disabled={busy || loading} className="inline-flex items-center gap-1.5 px-3 py-2 bg-white border border-red-200 text-red-700 hover:bg-red-50 text-xs font-bold rounded-lg">
              <XCircle size={14} /> Anular (sin generar casos)
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex-1 text-xs text-slate-600">
            <div className="text-sm font-bold text-slate-800 flex items-center gap-1.5"><Lock size={15} className="text-slate-400" /> No hay ninguna auditoría abierta</div>
            <div className="mt-0.5">Abrir una auditoría toma la <b>fotografía</b> de las órdenes activas y guarda cada lectura de la pistola contra esa sesión. Sin auditoría abierta, los escaneos van a la lista temporal de siempre.</div>
            {ult && (
              <div className="mt-1 text-[11px] text-slate-500">
                Última cerrada: <b>{ult.codigo}</b> el {fmtFecha(ult.fechaCierre)} por {ult.usuarioCierre} · nuevos <b>{ult.nuevos}</b> · ya existentes <b>{ult.existentes}</b> · reincidentes <b>{ult.reincidentes}</b> · resueltos <b>{ult.resueltos}</b> · abiertos en el registro <b>{ult.abiertosTotal}</b>
              </div>
            )}
            {estado.escaneosSueltos > 0 && <div className="mt-1 text-[11px] text-amber-700">Hay <b>{estado.escaneosSueltos}</b> escaneos sueltos en la lista temporal (se pueden importar al abrir).</div>}
          </div>
          <button onClick={() => setModal('ABRIR')} disabled={busy || loading} className="inline-flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-violet-300 text-white text-xs font-bold rounded-lg shadow-sm shrink-0">
            <Camera size={14} /> Abrir auditoría (tomar fotografía)
          </button>
        </div>
      )}

      {modal === 'ABRIR' && <ModalAbrir estado={estado} busy={busy} setBusy={setBusy} onClose={() => setModal(null)} onDone={() => { setModal(null); onChange && onChange(); }} />}
      {modal === 'CERRAR' && ses && (
        <Modal title={`Cerrar la auditoría ${ses.codigo}`} onClose={() => !busy && setModal(null)}>
          <p className="text-sm text-slate-700">Se calculan los hallazgos <b>contra la fotografía</b> ({ses.contadores?.snapshotCant} órdenes) y se actualiza el Registro de Casos:</p>
          <ul className="mt-2 text-xs text-slate-600 list-disc pl-5 space-y-1">
            <li><b>{ses.contadores?.sinEscanear}</b> órdenes sin escanear pasan a casos <b>FALTANTE</b> (salvo las que salieron del depósito durante la auditoría).</li>
            <li>Lo que ya estaba en el registro <b>no se duplica</b>: suma una detección.</li>
            <li>Los casos abiertos que no reaparecieron se <b>cierran solos</b>, únicamente dentro del alcance ({ses.alcanceTexto}).</li>
            <li>Los casos cerrados que reaparecen se <b>reabren como reincidentes</b>.</li>
            {ses.esLineaBase && <li>Es la <b>línea base</b>: solo diferencias físicas. Sin aviso y permanencia se activan desde la segunda auditoría.</li>}
          </ul>
          <p className="mt-3 text-xs text-red-700 font-semibold">Esta acción no se puede deshacer. La fotografía y los escaneos quedan guardados en el historial.</p>
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => setModal(null)} disabled={busy} className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Volver</button>
            <button onClick={cerrar} disabled={busy} className="px-3 py-2 text-xs font-bold rounded-lg bg-slate-800 text-white hover:bg-slate-900 disabled:bg-slate-400 inline-flex items-center gap-1">
              {busy && <Loader2 size={14} className="animate-spin" />} Cerrar y generar casos
            </button>
          </div>
        </Modal>
      )}
      {modal === 'ANULAR' && ses && <ModalAnular codigo={ses.codigo} busy={busy} onClose={() => setModal(null)} onConfirm={anular} />}
      {modal && modal.resumen && <ModalResumen r={modal.resumen} onClose={() => setModal(null)} />}
    </div>
  );
}

function Modal({ title, children, onClose, wide }) {
  return (
    <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} p-5 max-h-[90vh] overflow-y-auto`} onClick={e => e.stopPropagation()}>
        <h3 className="text-base font-bold text-slate-800 mb-3">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function ModalAbrir({ estado, busy, setBusy, onClose, onDone }) {
  const [alcanceTipo, setAlcanceTipo] = useState('TOTAL');
  const [prefijos, setPrefijos] = useState([]);
  const [elegidos, setElegidos] = useState([]);
  const [importar, setImportar] = useState(estado.escaneosSueltos > 0);
  const [obs, setObs] = useState('');
  const esPrimera = !estado.auditoriasCerradas;

  useEffect(() => {
    api.get('/audit-deposito/prefijos').then(({ data }) => { if (data.success) setPrefijos(data.data || []); }).catch(() => {});
  }, []);

  const total = prefijos.reduce((a, p) => a + p.n, 0);
  const seleccionadas = alcanceTipo === 'TOTAL' ? total : prefijos.filter(p => elegidos.includes(p.prefijo)).reduce((a, p) => a + p.n, 0);

  const abrir = async () => {
    if (alcanceTipo === 'PREFIJO' && !elegidos.length) return toast.error('Elegí al menos un prefijo de área.');
    setBusy(true);
    try {
      const { data } = await api.post('/audit-deposito/sesion/abrir', { alcanceTipo, alcanceValor: elegidos.join(','), importarPrevios: importar, observaciones: obs || null });
      toast.success(data.message, { duration: 7000 });
      onDone();
    } catch (e) { toast.error('No se pudo abrir: ' + errorDe(e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Abrir una auditoría de depósito" onClose={() => !busy && onClose()}>
      <p className="text-xs text-slate-600">Al abrir se toma la <b>fotografía</b> de las órdenes activas ({total} en total) y desde ese momento cada lectura de la pistola se guarda en esta auditoría. Lo que entre o salga del depósito después <b>no cuenta</b> como diferencia.</p>
      {esPrimera && <p className="mt-2 text-xs bg-violet-50 border border-violet-200 text-violet-800 rounded-lg px-3 py-2">Es la <b>primera auditoría</b> (línea base): solo detecta diferencias físicas (faltantes, sobrantes, sin ingreso, sin registro). Los casos <b>Sin aviso</b> y <b>Excede plazo</b> se activan desde la segunda.</p>}
      <div className="mt-3">
        <label className="block text-xs font-bold text-slate-700 mb-1">Alcance</label>
        <div className="flex gap-2">
          <button onClick={() => setAlcanceTipo('TOTAL')} className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${alcanceTipo === 'TOTAL' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 text-slate-700'}`}>Depósito completo ({total})</button>
          <button onClick={() => setAlcanceTipo('PREFIJO')} className={`px-3 py-1.5 text-xs font-bold rounded-lg border ${alcanceTipo === 'PREFIJO' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 text-slate-700'}`}>Solo algunas áreas (prefijo)</button>
        </div>
        {alcanceTipo === 'PREFIJO' && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {prefijos.map(p => {
              const on = elegidos.includes(p.prefijo);
              return (
                <button key={p.prefijo} onClick={() => setElegidos(on ? elegidos.filter(x => x !== p.prefijo) : [...elegidos, p.prefijo])}
                  className={`px-2 py-1 text-[11px] font-mono font-bold rounded border ${on ? 'bg-indigo-100 border-indigo-400 text-indigo-800' : 'border-slate-200 text-slate-600'}`}>
                  {p.prefijo} <span className="opacity-60">({p.n})</span>
                </button>
              );
            })}
            <p className="w-full text-[11px] text-slate-500 mt-1">Con alcance parcial, los casos de las otras áreas <b>no se tocan</b>: ni se crean ni se cierran solos.</p>
          </div>
        )}
      </div>
      {estado.escaneosSueltos > 0 && (
        <label className="mt-3 flex items-start gap-2 text-xs text-slate-700">
          <input type="checkbox" checked={importar} onChange={e => setImportar(e.target.checked)} className="mt-0.5" />
          <span>Importar los <b>{estado.escaneosSueltos}</b> escaneos sueltos de la lista temporal a esta auditoría (y vaciar la lista temporal). Si son de otro día, dejalo sin marcar.</span>
        </label>
      )}
      <div className="mt-3">
        <label className="block text-xs font-bold text-slate-700 mb-1">Observaciones (opcional)</label>
        <input value={obs} onChange={e => setObs(e.target.value)} maxLength={500} className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2" placeholder="Ej: conteo mensual, estantería A y B" />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Cancelar</button>
        <button onClick={abrir} disabled={busy} className="px-3 py-2 text-xs font-bold rounded-lg bg-violet-600 text-white hover:bg-violet-700 disabled:bg-violet-300 inline-flex items-center gap-1">
          {busy && <Loader2 size={14} className="animate-spin" />} Tomar fotografía de {seleccionadas} órdenes y abrir
        </button>
      </div>
    </Modal>
  );
}

function ModalAnular({ codigo, busy, onClose, onConfirm }) {
  const [motivo, setMotivo] = useState('');
  return (
    <Modal title={`Anular la auditoría ${codigo}`} onClose={() => !busy && onClose()}>
      <p className="text-xs text-slate-700">Se descarta la sesión: <b>no se genera ni se cierra ningún caso</b>. La fotografía y los escaneos quedan guardados como rastro en el historial, marcados como anulados.</p>
      <label className="block text-xs font-bold text-slate-700 mt-3 mb-1">Motivo (opcional)</label>
      <input value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={400} className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2" placeholder="Ej: se abrió por error" />
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} disabled={busy} className="px-3 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50">Volver</button>
        <button onClick={() => onConfirm(motivo)} disabled={busy} className="px-3 py-2 text-xs font-bold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300 inline-flex items-center gap-1">
          {busy && <Loader2 size={14} className="animate-spin" />} Anular sin generar casos
        </button>
      </div>
    </Modal>
  );
}

function ModalResumen({ r, onClose }) {
  const tipos = r.hallazgosPorTipo || {};
  return (
    <Modal title={`Auditoría ${r.codigo} cerrada`} onClose={onClose} wide>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {[
          { l: 'Casos nuevos', v: r.nuevos, h: 'se crearon', c: 'text-red-700 bg-red-50 border-red-200' },
          { l: 'Ya estaban', v: r.existentes, h: 'NO se duplicaron', c: 'text-slate-700 bg-slate-50 border-slate-200' },
          { l: 'Reincidentes', v: r.reincidentes, h: 'reabiertos', c: 'text-amber-700 bg-amber-50 border-amber-200' },
          { l: 'Resueltos solos', v: r.resueltos, h: 'no reaparecieron', c: 'text-green-700 bg-green-50 border-green-200' },
          { l: 'Abiertos en el registro', v: r.abiertosTotal, h: 'total vigente', c: 'text-indigo-700 bg-indigo-50 border-indigo-200' },
        ].map(k => (
          <div key={k.l} className={`rounded-xl border p-3 ${k.c}`}>
            <div className="text-2xl font-extrabold font-mono">{k.v}</div>
            <div className="text-xs font-bold">{k.l}</div>
            <div className="text-[10px] opacity-70">{k.h}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-1">
        <span>Fotografía: <b>{r.snapshot}</b></span>
        <span>Escaneadas: <b>{r.escaneadas}</b></span>
        <span>Sin escanear al cierre: <b>{r.sinEscanear}</b></span>
        {r.lineaBase && <span className="text-violet-700 font-bold">Línea base</span>}
        <span>Cotización usada: <b>{r.cotizacionDolar}</b></span>
      </div>
      <div className="mt-3 text-xs">
        <div className="font-bold text-slate-700 mb-1">Hallazgos por tipo (únicos)</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(tipos).map(([t, n]) => <span key={t} className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 font-mono">{t}: <b>{n}</b></span>)}
        </div>
      </div>
      {r.movidas && r.movidas.length > 0 && (
        <div className="mt-3 text-xs">
          <div className="font-bold text-slate-700 mb-1">Se movieron durante la auditoría (no generan caso): {r.movidas.length}</div>
          <ul className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
            {r.movidas.map((m, i) => <li key={i} className="px-2 py-1 flex gap-2"><span className="font-mono font-bold">{m.codigo}</span><span className="text-slate-500 truncate">{m.cliente}</span><span className="text-slate-400 ml-auto">{m.motivo}</span></li>)}
          </ul>
        </div>
      )}
      {r.duplicados && r.duplicados.length > 0 && (
        <div className="mt-3 text-xs text-pink-700">Códigos repetidos en la fotografía (solo informe, no generan caso): {r.duplicados.map(d => `${d.codigo} ×${d.filas}`).join(', ')}</div>
      )}
      <div className="mt-4 flex justify-end">
        <button onClick={onClose} className="px-3 py-2 text-xs font-bold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">Ver el Registro de Casos</button>
      </div>
    </Modal>
  );
}
