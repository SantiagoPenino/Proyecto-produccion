import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Palette, RefreshCw, Users } from 'lucide-react';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFechaHora } from '../../../utils/fechas';
import OrderDetailModal from '../../production/components/OrderDetailModal';
import { BTN_PRIMARIO, BTN_SECUNDARIO, ESTADO_PARTE, NOMBRE_PARTE, Pill, PillModificada, TIPO_TRABAJO, errorDe } from './solicitudesComunes';

/**
 * Spec 41 — Bandeja común de Diseño (RN-SOL.18c / RN-SOL.31). Las partes que los vendedores envían
 * caen acá sin dueño: cualquier diseñador habilitado TOMA una, queda a su nombre y sale de las
 * disponibles para los demás. El diseñador ve la bandeja común y lo que él mismo tomó.
 */
export default function BandejaDisenoPage() {
    const navigate = useNavigate();
    const [data, setData] = useState({ disponibles: [], mias: [] });
    const [perfil, setPerfil] = useState(null);
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    const [verDisenadores, setVerDisenadores] = useState(false);
    const [enProduccion, setEnProduccion] = useState([]);   // Bordado / TPU ya en planta que esperan su diseño
    const [ficha, setFicha] = useState(null);               // orden abierta en la ficha de producción

    const cargar = useCallback(async () => {
        setLoading(true);
        try { setData(await svc.bandeja()); }
        catch (e) { if (e?.response?.status !== 403) toast.error(errorDe(e)); }
        try { setEnProduccion(await svc.disenosEnProduccion()); }
        catch (e) { setEnProduccion([]); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { svc.miPerfil().then(p => { setPerfil(p); if (p.esDisenador) cargar(); }).catch(e => toast.error(errorDe(e))); }, [cargar]);

    // Esta pantalla no guarda ningún estado propio: lee el estado REAL de cada orden en producción. Si alguien sube
    // el diseño entrando por el área (el ojito), acá cambia igual; se vuelve a leer sola cada minuto y al volver a la pestaña.
    useEffect(() => {
        if (!perfil?.esDisenador) return undefined;
        const leer = () => { if (document.visibilityState === 'visible' && !ficha) cargar(); };
        const t = setInterval(leer, 60000);
        document.addEventListener('visibilitychange', leer);
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', leer); };
    }, [perfil, ficha, cargar]);

    const tomar = async (pa) => {
        if (!window.confirm(`Vas a tomar "${NOMBRE_PARTE[pa.Tipo]}" de ${pa.ClienteNombre} (${pa.NombreTrabajo}). Queda a tu nombre y deja de estar disponible para los demás diseñadores.${pa.Modificada ? '\n\nTiene un cambio del vendedor: al tomarlo lo das por aceptado.' : ''} ¿Tomarlo?`)) return;
        setBusy(true);
        try { await svc.tomar(pa.ParteID); toast.success('Trabajo tomado: quedó a tu nombre.'); navigate(`/ventas/solicitudes/${pa.SolicitudID}`); }
        catch (e) { toast.error(errorDe(e)); await cargar(); }
        finally { setBusy(false); }
    };

    if (!perfil) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-indigo-500" /></div>;

    return (
        <div className="p-4 md:p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h1 className="text-xl font-black text-slate-800 flex items-center gap-2"><Palette size={22} className="text-indigo-500" /> Bandeja de Diseño</h1>
                    <p className="text-xs text-slate-500 mt-1">Trabajos que los vendedores enviaron a diseñar. Es una bandeja común: el que toma un trabajo se lo queda.</p>
                </div>
                <div className="flex items-center gap-2">
                    {perfil.esAdmin && <button onClick={() => setVerDisenadores(v => !v)} className={BTN_SECUNDARIO}><Users size={14} /> {verDisenadores ? 'Ocultar la lista de diseñadores' : 'Ver quiénes son diseñadores'}</button>}
                    <button onClick={cargar} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500" title="Actualizar"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
                </div>
            </div>

            {perfil.esAdmin && verDisenadores && <Disenadores />}

            {!perfil.esDisenador ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">Tu usuario no es diseñador. Es diseñador quien tiene el rol "Diseñador" (se asigna en la pantalla de Usuarios). Si tenés otro rol y además diseñás, un administrador te habilita desde esta misma pantalla ("Ver quiénes son diseñadores").</div>
            ) : (
                <>
                    <Tabla titulo={`Mis trabajos (${data.mias.length})`} vacio="No tenés trabajos tomados." rows={data.mias} mias
                        accion={(pa) => <button onClick={() => navigate(`/ventas/solicitudes/${pa.SolicitudID}`)} className={BTN_PRIMARIO}>{pa.Modificada ? 'Abrir y aceptar el cambio' : pa.Estado === 'DISENADO' ? 'Abrir (sustituir archivo)' : 'Abrir y subir el diseño'}</button>} />
                    <Tabla titulo={`Disponibles para tomar (${data.disponibles.length})`} vacio="No hay trabajos esperando en la bandeja." rows={data.disponibles}
                        accion={(pa) => (
                            <span className="inline-flex gap-1">
                                <button onClick={() => navigate(`/ventas/solicitudes/${pa.SolicitudID}`)} className={BTN_SECUNDARIO}>Ver solicitud</button>
                                <button disabled={busy} onClick={() => tomar(pa)} className={BTN_PRIMARIO}>Tomar este trabajo</button>
                            </span>
                        )} />
                    <EnProduccion rows={enProduccion} onVerSolicitud={(sid) => navigate(`/ventas/solicitudes/${sid}`)} onAbrir={(o) => setFicha({ id: o.OrdenID, area: o.AreaID, codigo: o.CodigoOrden, cliente: o.Cliente })} />
                </>
            )}
            {/* La MISMA ficha que se abre con el ojito en el área: desde acá se sube la matriz / el boceto / el arte. */}
            <OrderDetailModal order={ficha} onClose={() => { setFicha(null); cargar(); }} onOrderUpdated={cargar} />
        </div>
    );
}

// Mismos rótulos para Bordado y TPU (por debajo Bordado usa requisitos y TPU usa el estado en el área).
const ETAPA_PRODUCCION = {
    RECHAZADO: { txt: 'Rechazado por el cliente', cls: 'bg-rose-50 text-rose-700 border-rose-200', hacer: 'Corregir el boceto y volver a enviarlo a aprobación' },
    FALTA_DISENO: { txt: 'Falta diseño', cls: 'bg-amber-50 text-amber-700 border-amber-200', hacer: { EMB: 'Subir la matriz (ponchado .dst / .emb)', TPU: 'Subir el boceto de producción y enviarlo a aprobación' } },
    APROBADO_FALTA_ARTE: { txt: 'Aprobado · falta el arte', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', hacer: 'Subir las capas del arte (2 a 5)' },
    ESPERANDO_APROBACION: { txt: 'Esperando aprobación del cliente', cls: 'bg-sky-50 text-sky-700 border-sky-200', hacer: { EMB: 'Cuando el cliente apruebe, tildar "Aprobación del Cliente" en los requisitos', TPU: 'Esperar al cliente (aprueba o rechaza desde su portal)' } },
};
const AREA_NOMBRE = { EMB: 'Bordado', TPU: 'Estampado TPU' };

function EnProduccion({ rows, onAbrir, onVerSolicitud }) {
    return (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-100">
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Diseños pendientes en producción — Bordado y TPU ({rows.length})</div>
                <p className="text-[11px] text-slate-500 mt-0.5">Pedidos que ya están en planta y todavía esperan su diseño. Se trabaja desde la ficha de la orden (la misma que se abre con el ojito en el área): ahí se sube la matriz, el boceto o el arte, y la orden se libera sola. Un trabajo que tenías tomado en una solicitud pasa a esta lista cuando la solicitud se convierte en pedido.</p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>
                            <th className="text-left px-3 py-2">Etapa</th>
                            <th className="text-left px-3 py-2">Orden</th>
                            <th className="text-left px-3 py-2">Cliente / trabajo</th>
                            <th className="text-left px-3 py-2">Material</th>
                            <th className="text-left px-3 py-2">Qué hay que hacer</th>
                            <th className="text-left px-3 py-2">Ingresó</th>
                            <th className="px-3 py-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-6">No hay órdenes de Bordado ni de TPU esperando diseño.</td></tr>}
                        {rows.map(o => {
                            const et = ETAPA_PRODUCCION[o.Etapa] || { txt: o.Etapa, cls: 'bg-slate-50 text-slate-600 border-slate-200', hacer: '' };
                            const hacer = typeof et.hacer === 'string' ? et.hacer : (et.hacer[o.AreaID] || '');
                            return (
                                <tr key={o.OrdenID} className="border-t border-slate-100">
                                    <td className="px-3 py-2"><span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${et.cls}`}>{et.txt}</span></td>
                                    <td className="px-3 py-2"><div className="font-mono font-bold text-slate-800">{o.CodigoOrden}</div><div className="text-[10px] text-slate-400">{AREA_NOMBRE[o.AreaID] || o.AreaID} · pedido {o.NoDocERP}</div></td>
                                    <td className="px-3 py-2"><div className="font-bold text-slate-800">{o.Cliente}</div><div className="text-slate-500">{o.DescripcionTrabajo}</div>
                                        {o.SolicitudID ? <div className="text-[10px] text-slate-500 mt-0.5">Viene de la <button type="button" onClick={() => onVerSolicitud(o.SolicitudID)} className="text-indigo-600 font-bold hover:underline">Solicitud #{o.SolicitudID}</button>{o.DisenadorSolicitud ? <> · ahí lo había tomado <b>{o.DisenadorSolicitud}</b></> : null}</div> : null}</td>
                                    <td className="px-3 py-2 text-slate-600">{o.Material}</td>
                                    <td className="px-3 py-2 text-slate-700 max-w-xs">{hacer}</td>
                                    <td className="px-3 py-2 text-slate-500">{fmtFechaHora(o.FechaIngreso)}</td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap"><button onClick={() => onAbrir(o)} className={BTN_PRIMARIO}>Abrir la ficha de la orden</button></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function Tabla({ titulo, vacio, rows, accion, mias }) {
    return (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-2 border-b border-slate-100 text-[10px] font-black uppercase tracking-wide text-slate-500">{titulo}</div>
            <div className="overflow-x-auto">
                <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>
                            <th className="text-left px-3 py-2">Estado</th>
                            <th className="text-left px-3 py-2">Qué hay que hacer</th>
                            <th className="text-left px-3 py-2">Cliente / trabajo</th>
                            <th className="text-left px-3 py-2">Producto</th>
                            <th className="text-left px-3 py-2">Detalle</th>
                            <th className="text-left px-3 py-2">{mias ? 'Tomado' : 'Enviado'}</th>
                            <th className="px-3 py-2"></th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.length === 0 && <tr><td colSpan={7} className="text-center text-slate-400 py-6">{vacio}</td></tr>}
                        {rows.map(pa => (
                            <tr key={pa.ParteID} className={`border-t border-slate-100 ${pa.Modificada ? 'bg-fuchsia-50/50' : ''}`}>
                                <td className="px-3 py-2"><Pill e={pa.Estado} mapa={ESTADO_PARTE} />{pa.Modificada ? <div className="mt-1"><PillModificada titulo={pa.ModificadaDetalle} /></div> : null}</td>
                                <td className="px-3 py-2"><div className="font-bold text-slate-800">{NOMBRE_PARTE[pa.Tipo]}</div><div className="text-slate-500">{TIPO_TRABAJO[pa.TipoTrabajo] || '—'}</div></td>
                                <td className="px-3 py-2"><div className="font-bold text-slate-800">{pa.ClienteNombre}</div><div className="text-slate-500">#{pa.SolicitudID} · {pa.NombreTrabajo}</div><div className="text-[10px] text-slate-400">vendedor {pa.VendedorNombre || '—'}</div></td>
                                <td className="px-3 py-2 text-slate-700">{pa.TipoFabricacion === 'PRODUCTO_TERMINADO' ? pa.ProductoNombre : 'Personalizado'}<div className="text-[10px] text-slate-400">{pa.CantidadPrendas} prendas</div></td>
                                <td className="px-3 py-2 text-slate-600 max-w-xs">{[pa.CantidadTotal ? `${pa.CantidadTotal} en total` : null, pa.PorPrenda ? `${pa.PorPrenda} por prenda` : null, pa.Ubicacion].filter(Boolean).join(' · ') || '—'}{pa.Observaciones ? <div className="text-[10px] text-slate-400 truncate" title={pa.Observaciones}>{pa.Observaciones}</div> : null}</td>
                                <td className="px-3 py-2 text-slate-500">{fmtFechaHora(mias ? pa.FechaInicioDiseno : pa.FechaEnvioDiseno)}</td>
                                <td className="px-3 py-2 text-right whitespace-nowrap">{accion(pa)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// Diseñador = rol de login "Diseñador". Acá el Admin ve quiénes lo son y habilita, como excepción, a alguien
// que tiene OTRO rol y además diseña. El rol Admin siempre puede operar la bandeja.
function Disenadores() {
    const [rows, setRows] = useState([]);
    const [q, setQ] = useState('');
    const cargar = useCallback(() => svc.disenadores().then(setRows).catch(e => toast.error(errorDe(e))), []);
    useEffect(() => { cargar(); }, [cargar]);
    const cambiar = async (u) => {
        if (u.PorRol) return toast.info(`${u.Nombre} es diseñador porque tiene el rol "Diseñador". Para quitárselo, cambiale el rol en la pantalla de Usuarios.`);
        const activo = !u.EsDisenador;
        if (!window.confirm(activo ? `¿Habilitar a ${u.Nombre} como diseñador aunque su rol sea "${u.NombreRol}"? Va a ver la bandeja de Diseño y va a poder tomar trabajos.` : `¿Quitarle a ${u.Nombre} la habilitación de diseñador? Deja de ver la bandeja; los trabajos que ya tomó siguen a su nombre.`)) return;
        try { await svc.definirDisenador(u.IdUsuario, activo); await cargar(); }
        catch (e) { toast.error(errorDe(e)); }
    };
    const visibles = rows.filter(u => u.EsDisenador || (q.trim().length >= 2 && String(u.Nombre || '').toLowerCase().includes(q.trim().toLowerCase())));
    return (
        <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Quiénes son diseñadores</div>
            <p className="text-xs text-slate-500">Lo normal es asignarle a la persona el rol "Diseñador" en la pantalla de Usuarios. Acá solo se habilita, como excepción, a alguien que tiene otro rol y además diseña.</p>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar a alguien con otro rol para habilitarlo (mínimo 2 letras)" className="block w-full md:w-96 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm" />
            <ul className="flex flex-wrap gap-2">
                {visibles.length === 0 && <li className="text-xs text-slate-400">Todavía no hay nadie con el rol "Diseñador" ni habilitado como excepción.</li>}
                {visibles.map(u => (
                    <li key={u.IdUsuario}><button onClick={() => cambiar(u)} className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${u.EsDisenador ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}>{u.Nombre} <span className="font-normal text-slate-400">· {u.NombreRol}</span> — {u.PorRol ? 'por su rol' : u.EsDisenador ? 'habilitado como excepción (quitar)' : 'habilitar'}</button></li>
                ))}
            </ul>
        </div>
    );
}
