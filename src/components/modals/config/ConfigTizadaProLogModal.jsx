import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../services/apiClient';
import { fmtFechaHora } from '../../../utils/fechas';

// Administración › TIZADA PRO: el registro del intercambio con TIZADA.
//  - Pedidos: los que se mandaron (dbo.TizadaProEnvios), con el pedido.json, lo que volvió, las alarmas y los archivos.
//  - Llamadas: cada llamada a la API de TIZADA y cada aviso que llegó (las últimas 300, en memoria: se pierden al
//    reiniciar el backend). Backend: controllers/tizadaProRegistroController.js.
const ESTADO = {
    REVISADO: 'bg-sky-100 text-sky-700', EN_COLA: 'bg-amber-100 text-amber-700', PROCESANDO: 'bg-amber-100 text-amber-700',
    LISTO: 'bg-amber-100 text-amber-700', APLICANDO: 'bg-amber-100 text-amber-700', APLICADO: 'bg-emerald-100 text-emerald-700',
    RECHAZADO: 'bg-rose-100 text-rose-700', ERROR: 'bg-rose-100 text-rose-700', ERROR_APLICAR: 'bg-rose-100 text-rose-700', CANCELADO: 'bg-zinc-100 text-zinc-600',
};
const horaLocal = (iso) => { try { return new Date(iso).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); } catch { return iso; } };
const lindo = (v) => {
    if (v == null || v === '') return '';
    if (typeof v !== 'string') return JSON.stringify(v, null, 2);
    try { return JSON.stringify(JSON.parse(v), null, 2); } catch { return v; }
};

function BloqueJson({ titulo, valor }) {
    const texto = lindo(valor);
    const [copiado, setCopiado] = useState(false);
    if (!texto) return null;
    return (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-100 border-b border-zinc-200">
                <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{titulo}</span>
                <button type="button" className="text-[11px] font-bold text-indigo-600 hover:underline"
                    onClick={() => { navigator.clipboard?.writeText(texto).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 1500); }); }}>
                    {copiado ? 'Copiado' : 'Copiar'}
                </button>
            </div>
            <pre className="text-[11px] leading-snug p-3 overflow-auto max-h-80 text-zinc-800 whitespace-pre-wrap break-all">{texto}</pre>
        </div>
    );
}

function DetalleEnvio({ id, onVolver }) {
    const [d, setD] = useState(null);
    const [error, setError] = useState(null);
    useEffect(() => {
        api.get(`/admin/tizadapro/envios/${id}`).then(r => setD(r.data?.data)).catch(e => setError(e.response?.data?.error || e.message));
    }, [id]);
    return (
        <div className="space-y-3">
            <button type="button" onClick={onVolver} className="text-xs font-bold text-indigo-600 hover:underline"><i className="fa-solid fa-arrow-left mr-1"></i>Volver a la lista</button>
            {error && <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold border border-red-100">{error}</div>}
            {!d && !error && <div className="flex justify-center py-10 text-zinc-400"><i className="fa-solid fa-circle-notch fa-spin text-2xl"></i></div>}
            {d && (<>
                <div className="bg-white rounded-xl border border-zinc-200 p-3 text-sm space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                        <b className="font-mono">{d.Referencia}</b>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${ESTADO[d.Estado] || 'bg-zinc-100 text-zinc-600'}`}>{d.Estado}</span>
                        {d.SoloRevision && <span className="text-[11px] text-sky-700 font-bold">solo revisión (no se fabricó)</span>}
                    </div>
                    <div className="text-xs text-zinc-500">
                        Solicitud {d.OrigenID} · producto {d.OrigenItemID} · mandado {fmtFechaHora(d.FechaEnvio)} · última novedad {fmtFechaHora(d.FechaActualizado)}{d.FechaFin ? ` · terminó ${fmtFechaHora(d.FechaFin)}` : ''}
                    </div>
                    {d.Etapa && <div className="text-xs text-zinc-700">{d.Etapa}</div>}
                    {d.ErrorTexto && <div className="text-xs text-rose-700 font-bold">{d.ErrorTexto}</div>}
                </div>
                {(d.Alarmas || []).length > 0 && (
                    <div className="bg-white rounded-xl border border-zinc-200 p-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Alarmas ({d.Alarmas.length})</div>
                        <ul className="space-y-1 text-xs">{d.Alarmas.map((a, k) => (
                            <li key={k} className={a.frena ? 'text-rose-700' : 'text-amber-700'}>
                                <b>{a.frena ? 'Frena' : 'Aviso'}</b> · <span className="font-mono">{a.codigo}</span>{a.etapa ? ` (${a.etapa})` : ''} — {a.mensaje}
                                {a.donde ? <span className="text-zinc-500"> · {Object.entries(a.donde).map(([k2, v]) => `${k2}: ${v}`).join(', ')}</span> : null}
                            </li>
                        ))}</ul>
                    </div>
                )}
                {(d.Archivos || []).length > 0 && (
                    <div className="bg-white rounded-xl border border-zinc-200 p-3">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Archivos que volvieron ({d.Archivos.length})</div>
                        <ul className="space-y-0.5 text-xs">{d.Archivos.map((a, k) => (
                            <li key={k}>{a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="font-bold text-indigo-600 hover:underline">{a.nombre}</a> : <b>{a.nombre}</b>}
                                <span className="text-zinc-500">{a.tipo ? ` · ${a.tipo}` : ''}{a.tela ? ` · ${a.tela}` : ''}{a.metros ? ` · ${Number(a.metros).toFixed(2)} m` : ''}</span></li>
                        ))}</ul>
                    </div>
                )}
                <BloqueJson titulo="pedido.json que se mandó" valor={d.Pedido} />
                <BloqueJson titulo="Lo que contestó TIZADA (estado / resultado)" valor={d.Resultado} />
            </>)}
        </div>
    );
}

const ConfigTizadaProLogModal = ({ isOpen, onClose }) => {
    const [datos, setDatos] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [error, setError] = useState(null);
    const [pestana, setPestana] = useState('pedidos');
    const [envioSel, setEnvioSel] = useState(null);
    const [llamadaAbierta, setLlamadaAbierta] = useState(null);
    const [filtro, setFiltro] = useState('');

    const cargar = async () => {
        setCargando(true); setError(null);
        try { const r = await api.get('/admin/tizadapro/registro'); setDatos(r.data?.data || null); }
        catch (e) { setError(e.response?.data?.error || e.message); }
        finally { setCargando(false); }
    };
    useEffect(() => { if (isOpen) cargar(); }, [isOpen]);

    const f = filtro.trim().toLowerCase();
    const envios = useMemo(() => (datos?.envios || []).filter(e => !f || `${e.Referencia} ${e.Estado} ${e.Etapa || ''} ${e.Usuario || ''}`.toLowerCase().includes(f)), [datos, f]);
    const llamadas = useMemo(() => (datos?.llamadas || []).filter(l => !f || `${l.metodo} ${l.ruta} ${l.status ?? ''} ${l.error || ''} ${l.referencia || ''}`.toLowerCase().includes(f)), [datos, f]);

    if (!isOpen) return null;
    const c = datos?.config;
    return createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-zinc-900/50 p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl overflow-hidden border border-zinc-200 flex flex-col max-h-[92vh]">
                <div className="bg-zinc-900 px-6 py-4 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3 text-white">
                        <div className="p-2 bg-white/10 rounded-lg"><i className="fa-solid fa-right-left text-cyan-400"></i></div>
                        <div>
                            <h3 className="text-lg font-bold">TIZADA PRO · Registro del intercambio</h3>
                            <p className="text-xs text-zinc-400">Qué se mandó, qué contestó TIZADA y qué avisos llegaron</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={cargar} disabled={cargando} className="text-zinc-300 hover:text-white bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg text-xs font-bold">
                            <i className={`fa-solid fa-rotate mr-1 ${cargando ? 'fa-spin' : ''}`}></i>Actualizar
                        </button>
                        <button onClick={onClose} className="text-zinc-400 hover:text-white transition-colors bg-white/5 hover:bg-white/10 p-2 rounded-full w-8 h-8 flex items-center justify-center" aria-label="Cerrar">
                            <i className="fa-solid fa-times"></i>
                        </button>
                    </div>
                </div>

                <div className="p-5 overflow-y-auto bg-zinc-50 flex-1 space-y-4">
                    {error && <div className="bg-red-50 text-red-600 p-3 rounded-xl text-sm font-bold border border-red-100">{error}</div>}

                    {c && (
                        <div className="bg-white rounded-xl border border-zinc-200 p-3 grid gap-x-6 gap-y-1 text-xs text-zinc-600" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                            <div><b className="text-zinc-800">Conexión:</b> {c.activa ? <span className="text-emerald-700 font-bold">prendida</span> : <span className="text-rose-700 font-bold">apagada</span>}{c.motivo ? ` · ${c.motivo}` : ''}</div>
                            <div className="truncate" title={c.url}><b className="text-zinc-800">Dirección:</b> {c.url || '—'}</div>
                            <div><b className="text-zinc-800">Modo:</b> {c.soloLectura ? <span className="text-amber-700 font-bold">SOLO LECTURA (no se manda nada)</span> : 'se pueden mandar pedidos'}</div>
                            <div><b className="text-zinc-800">Envío:</b> {c.modoEnvio} · referencias {c.prefijo}-…</div>
                            <div className="truncate" title={c.avisoUrl || ''}><b className="text-zinc-800">Aviso:</b> {c.avisoUrl || 'sin dirección (se pregunta el estado)'}{c.sondeoSegundos ? ` · pregunta cada ${c.sondeoSegundos} s` : ''}</div>
                            <div><b className="text-zinc-800">Base de TIZADA:</b> {c.baseTizada} · mesas {c.mesasModo}</div>
                        </div>
                    )}

                    {!envioSel && (
                        <div className="flex flex-wrap items-center gap-2">
                            {[['pedidos', `Pedidos (${datos?.envios?.length ?? 0})`], ['llamadas', `Llamadas y avisos (${datos?.llamadas?.length ?? 0})`]].map(([k, t]) => (
                                <button key={k} type="button" onClick={() => setPestana(k)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${pestana === k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300'}`}>{t}</button>
                            ))}
                            <input type="text" value={filtro} onChange={e => setFiltro(e.target.value)} placeholder="Buscar (referencia, estado, ruta, error…)"
                                className="ml-auto w-72 p-2 text-xs border border-zinc-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-500" />
                        </div>
                    )}

                    {cargando && !datos && <div className="flex justify-center py-10 text-zinc-400"><i className="fa-solid fa-circle-notch fa-spin text-2xl"></i></div>}

                    {envioSel && <DetalleEnvio id={envioSel} onVolver={() => setEnvioSel(null)} />}

                    {!envioSel && datos && pestana === 'pedidos' && (
                        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                            <table className="w-full text-xs">
                                <thead className="bg-zinc-100 text-zinc-500 text-[10px] uppercase tracking-wider">
                                    <tr><th className="text-left px-3 py-2">Referencia</th><th className="text-left px-3 py-2">Estado</th><th className="text-left px-3 py-2">Etapa</th>
                                        <th className="text-left px-3 py-2">Alarmas</th><th className="text-left px-3 py-2">Archivos</th><th className="text-left px-3 py-2">Mandado</th><th className="text-left px-3 py-2">Por</th></tr>
                                </thead>
                                <tbody>
                                    {envios.length === 0 ? <tr><td colSpan={7} className="text-center text-zinc-400 py-6">Todavía no se mandó ningún pedido.</td></tr> : envios.map(e => (
                                        <tr key={e.EnvioID} onClick={() => setEnvioSel(e.EnvioID)} className="border-t border-zinc-100 hover:bg-indigo-50/50 cursor-pointer" title="Ver el pedido.json, lo que volvió, las alarmas y los archivos">
                                            <td className="px-3 py-2 font-mono font-bold text-zinc-800">{e.Referencia}{e.SoloRevision ? <span className="ml-1 font-sans font-bold text-sky-600">· revisión</span> : null}</td>
                                            <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ESTADO[e.Estado] || 'bg-zinc-100 text-zinc-600'}`}>{e.Estado}</span></td>
                                            <td className="px-3 py-2 text-zinc-600 max-w-[280px] truncate" title={e.ErrorTexto || e.Etapa || ''}>{e.ErrorTexto || e.Etapa || '—'}</td>
                                            <td className="px-3 py-2">{e.Frenan ? <span className="text-rose-700 font-bold">{e.Frenan} frena{e.Frenan === 1 ? '' : 'n'}</span> : null}{e.Frenan && e.Avisos ? ' · ' : ''}{e.Avisos ? <span className="text-amber-700">{e.Avisos} aviso{e.Avisos === 1 ? '' : 's'}</span> : null}{!e.Frenan && !e.Avisos ? '—' : null}</td>
                                            <td className="px-3 py-2">{e.Archivos || '—'}</td>
                                            <td className="px-3 py-2 whitespace-nowrap">{fmtFechaHora(e.FechaEnvio)}</td>
                                            <td className="px-3 py-2 text-zinc-500">{e.Usuario || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {!envioSel && datos && pestana === 'llamadas' && (
                        <div className="space-y-1.5">
                            <p className="text-[11px] text-zinc-500">Las últimas 300 desde que arrancó el backend (al reiniciarlo se vacía; los pedidos quedan en la otra pestaña). La llave nunca se guarda.</p>
                            {llamadas.length === 0 && <div className="bg-white rounded-xl border border-zinc-200 text-center text-zinc-400 py-6 text-xs">Todavía no hubo llamadas desde el último reinicio.</div>}
                            {llamadas.map(l => {
                                const abierta = llamadaAbierta === l.id;
                                const mal = l.error || (l.status && l.status >= 400);
                                return (
                                    <div key={l.id} className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
                                        <button type="button" onClick={() => setLlamadaAbierta(abierta ? null : l.id)} className="w-full flex flex-wrap items-center gap-2 px-3 py-2 text-xs text-left hover:bg-zinc-50">
                                            <i className={`fa-solid fa-chevron-${abierta ? 'down' : 'right'} text-zinc-400 w-3`}></i>
                                            <span className="text-zinc-400 whitespace-nowrap">{horaLocal(l.fecha)}</span>
                                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${l.sentido === 'ENTRA' ? 'bg-violet-100 text-violet-700' : 'bg-zinc-100 text-zinc-600'}`}>{l.sentido === 'ENTRA' ? 'TIZADA → nosotros' : 'nosotros → TIZADA'}</span>
                                            <b className="font-mono text-zinc-800">{l.metodo} {l.ruta}</b>
                                            {l.referencia && <span className="font-mono text-zinc-500">{l.referencia}</span>}
                                            <span className={`ml-auto font-bold ${mal ? 'text-rose-700' : 'text-emerald-700'}`}>{l.status ?? '—'}</span>
                                            <span className="text-zinc-400 w-14 text-right">{l.ms} ms</span>
                                        </button>
                                        {l.error && <div className="px-3 pb-2 text-[11px] text-rose-700 font-bold">{l.error}</div>}
                                        {abierta && (
                                            <div className="p-3 pt-0 space-y-2">
                                                <BloqueJson titulo="Lo que se mandó" valor={l.enviado} />
                                                <BloqueJson titulo="Lo que contestó" valor={l.respuesta} />
                                                {!l.enviado && !l.respuesta && <p className="text-[11px] text-zinc-400">Sin cuerpo.</p>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
};

export default ConfigTizadaProLogModal;
