import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ClipboardList, LayoutGrid, List, Plus, RefreshCw } from 'lucide-react';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFecha, fmtFechaHora } from '../../../utils/fechas';
import { BTN_PRIMARIO, ESTADO_SOLICITUD, INPUT, Pill, PillModificada, Sello, errorDe, plata } from './solicitudesComunes';

/**
 * Spec 41 — Solicitudes de vendedores. La Solicitud vive ANTES del pedido: acá el vendedor capta
 * lo que pide el cliente, lo libera a Diseño por partes y pacta precio y seña. Los vendedores
 * ven TODAS las solicitudes y filtran por estado (RN-SOL.30).
 */
const FILTROS = [
    ['ABIERTAS', 'Abiertas (falta algo)'], ['INGRESADA', 'Ingresadas'], ['EN_DISENO', 'En diseño'],
    ['PEDIDO_SOLICITADO', 'Pedido solicitado'], ['CANCELADA', 'Canceladas'], ['TODAS', 'Todas'],
];

export default function SolicitudesVendedorPage() {
    const navigate = useNavigate();
    const [filtros, setFiltros] = useState({ estado: 'ABIERTAS', vendedorId: '', desde: '', hasta: '', q: '' });
    const [rows, setRows] = useState([]);
    const [vendedores, setVendedores] = useState([]);
    const [loading, setLoading] = useState(false);
    const [sello, setSello] = useState('');      // '' | 'LISTOS' | 'FALTA'  (los cuatro botones de la maqueta)
    const [vista, setVista] = useState(() => { try { return localStorage.getItem('solicitudes.vista') || 'fichas'; } catch (_) { return 'fichas'; } });
    const cambiarVista = (v) => { setVista(v); try { localStorage.setItem('solicitudes.vista', v); } catch (_) { /* nada */ } };

    const cargar = useCallback(async () => {
        setLoading(true);
        try { setRows(await svc.listar(filtros)); }
        catch (e) { toast.error(errorDe(e)); }
        finally { setLoading(false); }
    }, [filtros]);
    useEffect(() => { const t = setTimeout(cargar, filtros.q ? 350 : 0); return () => clearTimeout(t); }, [cargar, filtros.q]);
    useEffect(() => { svc.vendedores().then(setVendedores).catch(() => setVendedores([])); }, []);

    const set = (k) => (e) => setFiltros(f => ({ ...f, [k]: e.target.value }));

    // Los números cuentan lo que está en curso (no canceladas). Listo = todo el checklist cumplido.
    const enCurso = rows.filter(s => s.Estado !== 'CANCELADA');
    const listos = enCurso.filter(s => s.Listo === true).length;
    const faltaInfo = enCurso.filter(s => s.Listo === false).length;
    const unidades = enCurso.reduce((a, s) => a + (Number(s.Unidades) || 0), 0);
    const visibles = rows.filter(s => sello === 'LISTOS' ? s.Listo === true : sello === 'FALTA' ? s.Listo === false : true);

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-black text-slate-800 flex items-center gap-2"><ClipboardList size={22} className="text-indigo-500" /> Solicitudes de vendedores</h1>
                    <p className="text-xs text-slate-500 mt-1">Lo que pide el cliente antes de ser pedido: se capta, se diseña por partes y se pacta precio y seña. Acá no se crea ninguna orden de producción.</p>
                </div>
                <button onClick={() => navigate('/ventas/solicitudes/nueva')} className={BTN_PRIMARIO}><Plus size={14} /> Nueva solicitud</button>
            </div>

            {/* Los números del día y los botones Listos / Falta info, como en la maqueta */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[['Solicitudes en curso', enCurso.length, ''], ['Listas para ingresar', listos, 'LISTOS'], ['Con requisitos pendientes', faltaInfo, 'FALTA'], ['Unidades en total', unidades, null]].map(([l, n, k]) => (
                    <button key={l} type="button" disabled={k === null} onClick={() => k !== null && setSello(s => (s === k ? '' : k))}
                        className={`text-left rounded-xl border px-3 py-2 ${sello === k && k ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'} ${k === null ? 'cursor-default' : 'hover:bg-slate-50'}`}>
                        <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{l}</div>
                        <div className={`text-xl font-black ${k === 'LISTOS' ? 'text-emerald-700' : k === 'FALTA' ? 'text-rose-700' : 'text-slate-800'}`}>{n}</div>
                    </button>
                ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    {FILTROS.map(([k, txt]) => (
                        <button key={k} onClick={() => setFiltros(f => ({ ...f, estado: k }))} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${filtros.estado === k ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{txt}</button>
                    ))}
                    <div className="ml-auto flex items-center gap-1">
                        <button onClick={() => cambiarVista('fichas')} className={`p-2 rounded-lg border ${vista === 'fichas' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`} title="Ver como fichas"><LayoutGrid size={14} /></button>
                        <button onClick={() => cambiarVista('tabla')} className={`p-2 rounded-lg border ${vista === 'tabla' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`} title="Ver como tabla"><List size={14} /></button>
                        <button onClick={cargar} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500" title="Actualizar"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
                    </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                    <input value={filtros.q} onChange={set('q')} placeholder="Buscar por cliente, trabajo o número" className={INPUT} />
                    <select value={filtros.vendedorId} onChange={set('vendedorId')} className={INPUT}>
                        <option value="">Todos los vendedores</option>
                        {vendedores.map(v => <option key={v.IdUsuario} value={v.IdUsuario}>{v.Nombre}</option>)}
                    </select>
                    <input type="date" value={filtros.desde} onChange={set('desde')} className={INPUT} title="Fecha de solicitud desde" />
                    <input type="date" value={filtros.hasta} onChange={set('hasta')} className={INPUT} title="Fecha de solicitud hasta" />
                </div>
            </div>

            {vista === 'fichas' && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {!loading && visibles.length === 0 && <div className="col-span-full text-center text-slate-400 py-8 bg-white border border-slate-200 rounded-2xl">No hay solicitudes con estos filtros.</div>}
                    {visibles.map(s => <Ficha key={s.SolicitudID} s={s} onAbrir={() => navigate(`/ventas/solicitudes/${s.SolicitudID}`)} />)}
                </div>
            )}

            {vista === 'tabla' && <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="text-left px-3 py-2">Estado</th>
                                <th className="text-left px-3 py-2">Cliente / trabajo</th>
                                <th className="text-left px-3 py-2">Vendedor</th>
                                <th className="text-left px-3 py-2">Diseño</th>
                                <th className="text-left px-3 py-2">Precio pactado</th>
                                <th className="text-left px-3 py-2">Seña</th>
                                <th className="text-left px-3 py-2">Pedidos</th>
                                <th className="px-3 py-2"></th>
                            </tr>
                        </thead>
                        <tbody>
                            {!loading && visibles.length === 0 && <tr><td colSpan={8} className="text-center text-slate-400 py-8">No hay solicitudes con estos filtros.</td></tr>}
                            {visibles.map(s => (
                                <tr key={s.SolicitudID} className="border-t border-slate-100 hover:bg-indigo-50/40 cursor-pointer" onClick={() => navigate(`/ventas/solicitudes/${s.SolicitudID}`)}>
                                    <td className="px-3 py-2"><Pill e={s.Estado} mapa={ESTADO_SOLICITUD} />{s.Listo !== null && s.Estado !== 'PEDIDO_SOLICITADO' && <div className="mt-1"><Sello listo={s.Listo} chico /></div>}
                                        {s.DisenoPendProd > 0 && <div className="mt-1"><span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase border bg-amber-50 text-amber-700 border-amber-200" title="El pedido ya está en producción, pero Bordado y/o TPU todavía esperan su diseño">Diseño pendiente en producción</span></div>}
                                        <div className="text-[10px] text-slate-400 mt-1">#{s.SolicitudID} · {fmtFechaHora(s.FechaSolicitud)}</div></td>
                                    <td className="px-3 py-2"><div className="font-bold text-slate-800">{s.ClienteNombre || `Cliente ${s.CodCliente}`}</div><div className="text-slate-500">{s.NombreTrabajo}</div>{s.PreNumero ? <div className="text-[10px] text-slate-400 font-mono">presupuesto {s.PreNumero}</div> : null}</td>
                                    <td className="px-3 py-2 text-slate-700">{s.VendedorNombre || '—'}</td>
                                    <td className="px-3 py-2">
                                        <div className="text-slate-700"><b>{s.Disenadas || 0}</b> de {s.Partes || 0} diseñadas</div>
                                        {/* Lo que ya es pedido no se sigue diseñando en la solicitud: su diseño sigue en producción */}
                                        {(s.Convertidos || 0) < (s.Productos || 0) && <div className="text-[10px] text-slate-400">{s.Ingresadas || 0} sin enviar · {s.EnBandeja || 0} en bandeja · {s.Iniciadas || 0} en curso</div>}
                                        {s.DisenoPendProd > 0 && <div className="text-[10px] font-bold text-amber-700 mt-0.5">En producción falta: {s.DisenoPendProdTxt}</div>}
                                        {s.Convertidos > 0 && !(s.DisenoPendProd > 0) && <div className="text-[10px] font-bold text-emerald-700 mt-0.5">En producción: no queda diseño pendiente</div>}
                                        {s.Modificadas > 0 && <div className="mt-1"><PillModificada /></div>}
                                    </td>
                                    <td className="px-3 py-2">{!s.ModoCobro ? <span className="text-rose-600 font-bold">Sin pactar</span> : s.ModoCobro === 'POR_AREA' ? 'Factura por cada área' : <b>{plata(s.PrecioPactado, s.MonIdMoneda)}</b>}</td>
                                    <td className="px-3 py-2">{!s.RequiereSena ? <span className="text-slate-400">No requiere</span> : s.SenaConfirmada ? <span className="text-emerald-700 font-bold">Confirmada</span> : <span className="text-rose-600 font-bold">Sin confirmar</span>}</td>
                                    <td className="px-3 py-2 text-slate-700">
                                        {s.NumerosPedido ? <div className="font-black text-emerald-700">Pedido {s.NumerosPedido}</div> : null}
                                        <div className={s.NumerosPedido ? 'text-[10px] text-slate-400' : ''}>{s.Convertidos || 0} de {s.Productos || 0} productos convertidos</div>
                                    </td>
                                    <td className="px-3 py-2 text-right"><button className="text-indigo-600 font-bold hover:underline">Abrir</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>}
        </div>
    );
}

// Una ficha por solicitud, como la tarjeta de la maqueta: la franja de la izquierda es lo primero
// que se mira (verde: lista para ingresar · roja: falta info · gris: ya es pedido o cancelada).
function Ficha({ s, onAbrir }) {
    const f = s.Ficha || {};
    const convertida = s.Estado === 'PEDIDO_SOLICITADO';
    const franja = s.Estado === 'CANCELADA' ? 'border-l-slate-300 opacity-60' : convertida && !(s.DisenoPendProd > 0) ? 'border-l-slate-400' : s.Listo ? 'border-l-emerald-500' : 'border-l-rose-500';
    return (
        <button type="button" onClick={onAbrir} className={`text-left bg-white border border-slate-200 border-l-[5px] rounded-xl p-3 hover:shadow-md transition-shadow space-y-1.5 ${franja}`}>
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-[10px] font-mono text-slate-400">#{s.SolicitudID} · {fmtFechaHora(s.FechaSolicitud)}</div>
                    <div className="font-black text-slate-800 leading-tight truncate">{s.NombreTrabajo}</div>
                    <div className="text-xs text-slate-600 truncate">{s.ClienteNombre || `Cliente ${s.CodCliente}`} · <span className="text-slate-400">vende {s.VendedorNombre || '—'}</span></div>
                </div>
                <Pill e={s.Estado} mapa={ESTADO_SOLICITUD} />
            </div>
            <div className="flex flex-wrap gap-1 text-[10px]">
                {s.Unidades > 0 && <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 font-bold">{s.Unidades} unidades</span>}
                {f.dondeSeCose === 'EXTERNO' && <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 font-bold">taller {f.tallerExterno || 'externo'}</span>}
                {s.NumerosPedido && <span className="px-1.5 py-0.5 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 font-bold">Pedido {s.NumerosPedido}</span>}
                {s.DisenoPendProd > 0 && <span className="px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50 text-amber-700 font-bold">Diseño pendiente en producción</span>}
                {s.Modificadas > 0 && <PillModificada />}
                {s.ModoCobro === 'PRECIO_ESTABLECIDO' && <span className="px-1.5 py-0.5 rounded border border-slate-200 bg-slate-50 text-slate-600 font-bold">{plata(s.PrecioPactado, s.MonIdMoneda)}</span>}
                {s.RequiereSena && <span className={`px-1.5 py-0.5 rounded border font-bold ${s.SenaConfirmada ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>seña {s.SenaConfirmada ? 'confirmada' : 'sin confirmar'}</span>}
            </div>
            <div className="flex items-end justify-between gap-2 pt-1">
                <div className="text-xs">
                    <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Entrega</div>
                    <div className={s.FechaEntrega ? 'text-slate-800 font-bold' : 'text-rose-600'}>{s.FechaEntrega ? `${fmtFecha(s.FechaEntrega)}${s.FechaEntregaHasta ? ` → ${fmtFecha(s.FechaEntregaHasta)}` : ''}` : 'sin fecha'}</div>
                </div>
                {s.Estado === 'CANCELADA' ? null : convertida ? <span className="text-[10px] font-black uppercase text-slate-500">{s.DisenoPendProd > 0 ? 'En producción · falta diseño' : 'En producción'}</span>
                    : s.Listo === null ? null : <div className="text-right"><Sello listo={s.Listo} chico />{!s.Listo && <div className="text-[10px] text-rose-600 mt-0.5">{s.Faltan} cosa{s.Faltan === 1 ? '' : 's'} por completar</div>}</div>}
            </div>
        </button>
    );
}
