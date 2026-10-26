import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, Loader2, Undo2 } from 'lucide-react';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFechaHora } from '../../../utils/fechas';
import { BTN_SECUNDARIO, BTN_PELIGRO, NOMBRE_PARTE, Ventana, errorDe } from './solicitudesComunes';

/* ══════════════════════════════════════════════════════════════════════
   BANDEJA DE DISEÑO › TIEMPOS Y PUNTOS (23/10/2026)

   Para la bonificación de los diseñadores. Cada diseño (servicio de una
   solicitud) tiene 2 días hábiles desde que el diseñador lo TOMA hasta que
   SUBE el diseño a producción (el diseño pronto o, con el pedido ya en
   planta, la matriz / el arte en la orden); si se pasa, pierde 1 punto.
   Cada falla del pedido por culpa del diseño (la marcan un Admin o los
   vendedores, con el motivo; también desde la solicitud) resta 1 más.
   Las reglas y la cuenta: backend/services/solicitudesVendedorPuntosDiseno.js.
   El Admin ve a todos; un diseñador ve lo suyo. Anula quien marcó o un Admin.
   ══════════════════════════════════════════════════════════════════════ */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ROTULO = 'text-[11px] font-black uppercase tracking-wider text-slate-500';

// Ventana para escribir el motivo (marcar o anular una falla). También la usa la solicitud (FallasDisenoBloque.jsx)
export function PedirMotivo({ titulo, texto, boton, minimo, onClose, onConfirmar }) {
    const [motivo, setMotivo] = useState('');
    const [guardando, setGuardando] = useState(false);
    const confirmar = async () => {
        setGuardando(true);
        try { await onConfirmar(motivo.trim()); } finally { setGuardando(false); }
    };
    return (
        <Ventana Icono={AlertTriangle} titulo={titulo} onClose={onClose} chica ancho="sm:max-w-lg"
            pie={(
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} className={BTN_SECUNDARIO}>Cancelar</button>
                    <button onClick={confirmar} disabled={guardando || motivo.trim().length < minimo} className={BTN_PELIGRO}>
                        {guardando ? <Loader2 size={12} className="animate-spin" /> : null} {boton}
                    </button>
                </div>
            )}>
            <p className="text-sm text-slate-600 mb-3">{texto}</p>
            <textarea data-autofocus value={motivo} onChange={e => setMotivo(e.target.value)} rows={3} maxLength={500}
                placeholder="Motivo (lo ve el diseñador y queda en el historial de la solicitud)"
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15" />
        </Ventana>
    );
}

const Trabajo = ({ x }) => (
    <div className="min-w-0">
        <div className="font-bold text-slate-700 truncate">{x.cliente || 'Sin cliente'} · {x.trabajo || `#${x.solicitudId}`}</div>
        <div className="text-[11px] text-slate-400 truncate">
            #{x.solicitudId} · {NOMBRE_PARTE[x.servicio] || x.servicio}{x.producto ? ` · ${x.producto}` : ''}{x.pedido ? ` · pedido ${x.pedido}` : ''}
        </div>
    </div>
);

export default function TiemposDiseno() {
    const hoy = new Date();
    const [anio, setAnio] = useState(hoy.getFullYear());
    const [mes, setMes] = useState(hoy.getMonth() + 1);
    const [data, setData] = useState(null);
    const [cargando, setCargando] = useState(false);
    const [quien, setQuien] = useState('');            // disenadorId elegido ('' = todos)
    const [marcando, setMarcando] = useState(null);    // diseño al que se le marca una falla
    const [anulando, setAnulando] = useState(null);    // falla que se anula

    const cargar = useCallback(async () => {
        setCargando(true);
        try { setData(await svc.puntosDiseno(anio, mes)); }
        catch (e) { toast.error(errorDe(e)); setData(null); }
        finally { setCargando(false); }
    }, [anio, mes]);
    useEffect(() => { cargar(); }, [cargar]);

    const mover = (d) => {
        let m = mes + d, a = anio;
        if (m < 1) { m = 12; a -= 1; }
        if (m > 12) { m = 1; a += 1; }
        setMes(m); setAnio(a);
    };
    const esFuturo = anio * 12 + mes >= hoy.getFullYear() * 12 + hoy.getMonth() + 1;

    const marcar = async (motivo) => {
        try {
            await svc.marcarFallaDiseno(marcando.parteId, motivo);
            toast.success(`Falla de diseño marcada: ${marcando.disenador} pierde 1 punto este mes. Quedó en el historial de la solicitud #${marcando.solicitudId}.`);
            setMarcando(null);
            await cargar();
        } catch (e) { toast.error(errorDe(e)); }
    };
    const anular = async (motivo) => {
        try {
            await svc.anularFallaDiseno(anulando.eventoId, motivo);
            toast.success(`Falla anulada: ${anulando.disenador} recupera el punto. La marca y la anulación quedan en el historial de la solicitud.`);
            setAnulando(null);
            await cargar();
        } catch (e) { toast.error(errorDe(e)); }
    };

    const disenos = (data?.disenos || []).filter(x => !quien || String(x.disenadorId) === quien);
    const fallas = (data?.fallas || []).filter(x => !quien || String(x.disenadorId) === quien);
    const plazo = data?.plazoDiasHabiles || 2;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <button onClick={() => mover(-1)} className={BTN_SECUNDARIO} title="Mes anterior"><ChevronLeft size={14} /></button>
                    <span className="min-w-[140px] text-center text-sm font-black text-slate-700">{MESES[mes - 1]} {anio}</span>
                    <button onClick={() => mover(1)} disabled={esFuturo} className={BTN_SECUNDARIO} title="Mes siguiente"><ChevronRight size={14} /></button>
                    {cargando && <Loader2 size={14} className="animate-spin text-brand-cyan" />}
                </div>
                <p className="text-xs text-slate-500 max-w-2xl">
                    Cada diseño tiene <b>{plazo} días hábiles</b> desde que se toma hasta que se sube a producción (lunes a viernes, sin feriados). Si se pasa,
                    <b> −1 punto</b> en el mes en que se sube. Cada falla del pedido por el diseño, <b>−1 punto</b> en el mes en que se marca.
                </p>
            </div>

            {/* Por diseñador */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                    <thead>
                        <tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                            <th className="text-left font-bold px-4 py-2">Diseñador</th>
                            <th className="text-center font-bold px-3 py-2" title="Diseños subidos en el mes">Subidos</th>
                            <th className="text-center font-bold px-3 py-2">A tiempo</th>
                            <th className="text-center font-bold px-3 py-2">Atrasados</th>
                            <th className="text-center font-bold px-3 py-2">Fallas</th>
                            <th className="text-center font-bold px-3 py-2" title="Tomados y todavía sin subir (solo en el mes en curso)">Sin subir</th>
                            <th className="text-center font-bold px-4 py-2">Puntos que pierde</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data && data.disenadores.length === 0 && (
                            <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">Nadie tomó ni subió diseños en {MESES[mes - 1].toLowerCase()}.</td></tr>
                        )}
                        {(data?.disenadores || []).map(d => {
                            const elegido = quien === String(d.disenadorId);
                            return (
                                <tr key={d.disenadorId} onClick={() => setQuien(elegido ? '' : String(d.disenadorId))} role="button" tabIndex={0}
                                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setQuien(elegido ? '' : String(d.disenadorId)); } }}
                                    title={elegido ? 'Ver a todos' : 'Ver solo sus diseños y fallas'}
                                    className={`border-t border-slate-100 cursor-pointer ${elegido ? 'bg-brand-cyan/5' : 'hover:bg-slate-50'}`}>
                                    <td className="px-4 py-2 font-bold text-slate-700">{d.disenador}</td>
                                    <td className="px-3 py-2 text-center tabular-nums">{d.subidos}</td>
                                    <td className="px-3 py-2 text-center tabular-nums text-emerald-600">{d.aTiempo}</td>
                                    <td className={`px-3 py-2 text-center tabular-nums ${d.atrasados ? 'font-bold text-red-600' : 'text-slate-400'}`}>{d.atrasados}</td>
                                    <td className={`px-3 py-2 text-center tabular-nums ${d.fallas ? 'font-bold text-red-600' : 'text-slate-400'}`}>{d.fallas}</td>
                                    <td className="px-3 py-2 text-center tabular-nums text-slate-500">
                                        {d.abiertos}{d.vencidosSinSubir ? <span className="ml-1 text-[11px] font-bold text-amber-600">({d.vencidosSinSubir} vencidos)</span> : null}
                                    </td>
                                    <td className="px-4 py-2 text-center">
                                        <span className={`inline-block min-w-[2.5rem] rounded-full px-2 py-0.5 text-sm font-black ${d.puntosMenos ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                            {d.puntosMenos ? `−${d.puntosMenos}` : '0'}
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Diseños del mes */}
            <div>
                <h3 className={`${ROTULO} mb-2`}>Diseños {quien ? `de ${(data?.disenadores || []).find(d => String(d.disenadorId) === quien)?.disenador || ''}` : ''} ({disenos.length})</h3>
                <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                                <th className="text-left font-bold px-4 py-2">Trabajo</th>
                                <th className="text-left font-bold px-3 py-2">Diseñador</th>
                                <th className="text-left font-bold px-3 py-2">Tomado</th>
                                <th className="text-left font-bold px-3 py-2">Vence</th>
                                <th className="text-left font-bold px-3 py-2">Subido</th>
                                <th className="text-left font-bold px-3 py-2">Plazo</th>
                                {data?.puedeMarcar && <th className="px-4 py-2" />}
                            </tr>
                        </thead>
                        <tbody>
                            {disenos.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">Sin diseños en el mes.</td></tr>}
                            {disenos.map(x => (
                                <tr key={x.parteId} className="border-t border-slate-100 align-top">
                                    <td className="px-4 py-2 max-w-[320px]"><Trabajo x={x} /></td>
                                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{x.disenador}</td>
                                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap tabular-nums">{fmtFechaHora(x.tomado)}</td>
                                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap tabular-nums">{fmtFechaHora(x.vence)}</td>
                                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap tabular-nums">
                                        {x.subido ? fmtFechaHora(x.subido) : <span className="text-slate-400">Sin subir</span>}
                                        {x.subidoEn === 'ORDEN' && <div className="text-[10px] text-slate-400" title="El pedido ya estaba en planta: el diseño se subió en la ficha de la orden">en la orden ({x.servicio === 'TPU' ? 'arte de TPU' : 'matriz'})</div>}
                                    </td>
                                    <td className="px-3 py-2 whitespace-nowrap">
                                        {x.subido
                                            ? (x.atrasado
                                                ? <span className="rounded px-1.5 py-0.5 text-[10px] font-black bg-red-50 text-red-700 border border-red-200">ATRASADO · −1</span>
                                                : <span className="rounded px-1.5 py-0.5 text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-200">A TIEMPO</span>)
                                            : (x.vencidoSinSubir
                                                ? <span className="rounded px-1.5 py-0.5 text-[10px] font-black bg-amber-50 text-amber-700 border border-amber-200" title="Resta el punto cuando se suba">VENCIDO, SIN SUBIR</span>
                                                : <span className="inline-flex items-center gap-1 text-[11px] text-slate-500"><Clock size={12} /> en plazo</span>)}
                                    </td>
                                    {data?.puedeMarcar && (
                                        <td className="px-4 py-2 text-right">
                                            <button onClick={() => setMarcando(x)} className={BTN_SECUNDARIO}
                                                title="El pedido tuvo una falla por culpa del diseño: el diseñador pierde 1 punto este mes y queda en el historial de la solicitud">
                                                <AlertTriangle size={12} /> Falla de diseño
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Fallas marcadas en el mes */}
            <div>
                <h3 className={`${ROTULO} mb-2`}>Fallas por diseño marcadas en el mes ({fallas.length})</h3>
                <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
                                <th className="text-left font-bold px-4 py-2">Trabajo</th>
                                <th className="text-left font-bold px-3 py-2">Diseñador</th>
                                <th className="text-left font-bold px-3 py-2">Motivo</th>
                                <th className="text-left font-bold px-3 py-2">Marcada</th>
                                {data?.puedeMarcar && <th className="px-4 py-2" />}
                            </tr>
                        </thead>
                        <tbody>
                            {fallas.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Sin fallas por diseño en el mes.</td></tr>}
                            {fallas.map(f => (
                                <tr key={f.eventoId} className="border-t border-slate-100 align-top">
                                    <td className="px-4 py-2 max-w-[320px]"><Trabajo x={f} /></td>
                                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{f.disenador}</td>
                                    <td className="px-3 py-2 text-slate-700">{f.motivo}</td>
                                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtFechaHora(f.fecha)}<div className="text-[11px]">{f.marcadaPor}</div></td>
                                    {data?.puedeMarcar && (
                                        <td className="px-4 py-2 text-right">
                                            {(data.esAdmin || Number(f.marcadaPorId) === Number(data.yo)) && (
                                                <button onClick={() => setAnulando(f)} className={BTN_SECUNDARIO} title="Se marcó por error: el diseñador recupera el punto (la marca queda en el historial, con la anulación). La anula un administrador o quien la marcó.">
                                                    <Undo2 size={12} /> Anular
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {marcando && (
                <PedirMotivo titulo="Falla por el diseño" boton="Marcar la falla (−1 punto)" minimo={5} onClose={() => setMarcando(null)} onConfirmar={marcar}
                    texto={`${NOMBRE_PARTE[marcando.servicio] || marcando.servicio} de ${marcando.cliente || 'sin cliente'} (#${marcando.solicitudId}), diseñado por ${marcando.disenador}. Pierde 1 punto en ${MESES[hoy.getMonth()].toLowerCase()} y la falla queda en el historial de la solicitud.`} />
            )}
            {anulando && (
                <PedirMotivo titulo="Anular la falla" boton="Anular la falla" minimo={3} onClose={() => setAnulando(null)} onConfirmar={anular}
                    texto={`${anulando.disenador} recupera el punto. La falla («${anulando.motivo}») y la anulación quedan en el historial de la solicitud #${anulando.solicitudId}.`} />
            )}
        </div>
    );
}
