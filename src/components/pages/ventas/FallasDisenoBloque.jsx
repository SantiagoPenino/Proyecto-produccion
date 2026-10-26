import React, { useState } from 'react';
import { AlertTriangle, Undo2 } from 'lucide-react';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFechaHora } from '../../../utils/fechas';
import { BTN_SECUNDARIO, NOMBRE_PARTE } from './solicitudesComunes';
import { PedirMotivo } from './TiemposDiseno';

/* ══════════════════════════════════════════════════════════════════════
   FALLAS POR EL DISEÑO, EN LA SOLICITUD (23/10/2026)

   En la pestaña del producto de la solicitud del vendedor: cada servicio que
   tomó un diseñador, con el botón para marcar que el pedido tuvo una falla
   por culpa del diseño (resta 1 punto de la bonificación del diseñador; ver
   Bandeja de Diseño › Tiempos y puntos). Marcan el Admin y los vendedores;
   anula un Admin o quien la marcó. Las fallas salen del Historial de la
   solicitud (eventos FALLA_DISENO / FALLA_DISENO_ANULADA "#<EventoID> …").
   ══════════════════════════════════════════════════════════════════════ */

// Las fallas vigentes de un servicio (sin las anuladas)
export const fallasDeParte = (eventos, parteId) => {
    const anuladas = new Set((eventos || []).filter(e => e.Tipo === 'FALLA_DISENO_ANULADA')
        .map(e => Number((/^#(\d+) /.exec(String(e.Texto || '')) || [])[1])).filter(Boolean));
    return (eventos || []).filter(e => e.Tipo === 'FALLA_DISENO' && e.ParteID === parteId && !anuladas.has(e.EventoID));
};

export default function FallasDisenoBloque({ s, p, user, perfil, busy, hacer }) {
    const [marcando, setMarcando] = useState(null);   // servicio al que se le marca una falla
    const [anulando, setAnulando] = useState(null);   // { ev, pa }
    const partes = p.Partes.filter(pa => pa.DisenadorID);
    if (!perfil?.esVendedor || partes.length === 0) return null;

    const marcar = async (motivo) => {
        const pa = marcando;
        const ok = await hacer(() => svc.marcarFallaDiseno(pa.ParteID, motivo),
            `Falla de diseño marcada: ${pa.DisenadorNombre || 'el diseñador'} pierde 1 punto este mes. Quedó en el historial.`);
        if (ok) setMarcando(null);
    };
    const anular = async (motivo) => {
        const { ev, pa } = anulando;
        const ok = await hacer(() => svc.anularFallaDiseno(ev.EventoID, motivo),
            `Falla anulada: ${pa.DisenadorNombre || 'el diseñador'} recupera el punto. La marca y la anulación quedan en el historial.`);
        if (ok) setAnulando(null);
    };

    return (
        <section className="rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[11px] font-black uppercase tracking-wide text-slate-500 flex items-center gap-1"><AlertTriangle size={12} /> Fallas por el diseño</h3>
                <span className="text-[11px] text-slate-400">Si el pedido tuvo una falla por culpa del diseño, marcala acá: el diseñador pierde 1 punto de su bonificación.</span>
            </div>
            <ul className="divide-y divide-slate-100">
                {partes.map(pa => {
                    const fallas = fallasDeParte(s.Eventos, pa.ParteID);
                    return (
                        <li key={pa.ParteID} className="py-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-slate-700"><b>{NOMBRE_PARTE[pa.Tipo] || pa.Tipo}</b> · diseñó <b>{pa.DisenadorNombre || 'el diseñador'}</b></span>
                                <button type="button" disabled={busy} onClick={() => setMarcando(pa)} className={BTN_SECUNDARIO}
                                    title="El pedido tuvo una falla por culpa del diseño: el diseñador pierde 1 punto este mes y queda en el historial de la solicitud">
                                    <AlertTriangle size={12} /> Marcar falla de diseño
                                </button>
                            </div>
                            {fallas.map(ev => (
                                <div key={ev.EventoID} className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-50 px-2 py-1.5 text-red-800">
                                    <span><b>Falla de diseño (−1 punto):</b> {ev.Texto} <span className="text-red-500">· {fmtFechaHora(ev.Fecha)} · {ev.UsuarioNombre || '—'}</span></span>
                                    {(perfil.esAdmin || Number(ev.UsuarioID) === Number(user?.id)) && (
                                        <button type="button" disabled={busy} onClick={() => setAnulando({ ev, pa })} className={BTN_SECUNDARIO}
                                            title="Se marcó por error: el diseñador recupera el punto (la marca queda en el historial, con la anulación)">
                                            <Undo2 size={12} /> Anular
                                        </button>
                                    )}
                                </div>
                            ))}
                        </li>
                    );
                })}
            </ul>
            {marcando && (
                <PedirMotivo titulo="Falla por el diseño" boton="Marcar la falla (−1 punto)" minimo={5} onClose={() => setMarcando(null)} onConfirmar={marcar}
                    texto={`${NOMBRE_PARTE[marcando.Tipo] || marcando.Tipo} de la solicitud #${s.SolicitudID}, diseñado por ${marcando.DisenadorNombre || 'el diseñador'}. Pierde 1 punto este mes y la falla queda en el historial de la solicitud.`} />
            )}
            {anulando && (
                <PedirMotivo titulo="Anular la falla" boton="Anular la falla" minimo={3} onClose={() => setAnulando(null)} onConfirmar={anular}
                    texto={`${anulando.pa.DisenadorNombre || 'El diseñador'} recupera el punto. La falla («${anulando.ev.Texto}») y la anulación quedan en el historial de la solicitud.`} />
            )}
        </section>
    );
}
