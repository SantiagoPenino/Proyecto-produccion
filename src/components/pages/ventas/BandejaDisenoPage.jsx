import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Clock, ListTodo, Loader2, Palette, RefreshCw, Search, Send, UserCheck, UserMinus, UserPlus, Users } from 'lucide-react';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFechaHora } from '../../../utils/fechas';
import OrderDetailModal from '../../production/components/OrderDetailModal';
import Selector from '../../ui/Selector';
import { BTN_SECUNDARIO, ESTADO_PARTE, NOMBRE_PARTE, TIPO_TRABAJO, Ventana, errorDe, useConfirmar } from './solicitudesComunes';

// Botón principal de esta pantalla (06/10): brand-cyan, como el resto del sistema. El BTN_PRIMARIO de
// solicitudesComunes es índigo y lo usan las pantallas oscuras de Solicitudes, que lo pasan a amarillo.
const BTN_PRINCIPAL = 'px-3 py-1.5 rounded-lg bg-brand-cyan hover:bg-brand-cyan/90 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50';

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
    const [dialogo, preguntar] = useConfirmar();             // confirmaciones con el estilo del sistema (06/10)
    const [pestana, setPestana] = useState(null);           // 'mias' | 'disponibles' | 'produccion' (null hasta la 1.ª carga)

    const cargar = useCallback(async () => {
        setLoading(true);
        let bandeja = null;
        let produccion = [];
        try { bandeja = await svc.bandeja(); setData(bandeja); }
        catch (e) { if (e?.response?.status !== 403) toast.error(errorDe(e)); }
        try { produccion = await svc.disenosEnProduccion(); setEnProduccion(produccion); }
        catch (e) { setEnProduccion([]); }
        finally { setLoading(false); }
        // La primera vez abre la primera pestaña que tenga algo; después queda la que elija el diseñador
        // (que no salte sola cuando se vuelve a leer cada minuto).
        setPestana(p => p ?? (produccion.length ? 'produccion' : bandeja?.mias?.length ? 'mias' : bandeja?.disponibles?.length ? 'disponibles' : 'produccion'));
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
        const ok = await preguntar({
            Icono: UserCheck, titulo: 'Tomar este trabajo', boton: 'Tomar el trabajo',
            texto: `"${NOMBRE_PARTE[pa.Tipo]}" de ${pa.ClienteNombre} (${pa.NombreTrabajo}). Queda a tu nombre y deja de estar disponible para los demás diseñadores.`,
            nota: pa.Modificada ? 'Tiene un cambio del vendedor: al tomarlo lo das por aceptado.' : null,
        });
        if (!ok) return;
        setBusy(true);
        try { await svc.tomar(pa.ParteID); toast.success('Trabajo tomado: quedó a tu nombre.'); navigate(`/ventas/solicitudes/${pa.SolicitudID}/diseno`); }
        catch (e) { toast.error(errorDe(e)); await cargar(); }
        finally { setBusy(false); }
    };

    // Producción principal de un producto con molde de TIZADA PRO: no se toma, se manda a TIZADA y vuelve sola
    const esTizada = (pa) => pa.Tipo === 'PRINCIPAL' && pa.TipoFabricacion === 'PRODUCTO_TERMINADO' && !!pa.TizadaProMoldeRef;
    const enviarTizada = async (pa) => {
        const ok = await preguntar({
            Icono: Send, titulo: 'Mandar a TIZADA PRO', boton: 'Mandar a TIZADA PRO',
            texto: `"${NOMBRE_PARTE[pa.Tipo]}" de ${pa.ClienteNombre} (${pa.NombreTrabajo}). Antes se revisan el arte y los datos; si TIZADA lo acepta, la tizada vuelve sola como diseño pronto.`,
        });
        if (!ok) return;
        setBusy(true);
        try {
            const r = await svc.tizadaProEnviar(pa.SolicitudID, pa.ProductoSolID, false);
            if (r.Estado === 'RECHAZADO') toast.error(`TIZADA no lo acepta: ${r.mensaje || 'mirá las alarmas en la solicitud'}.`);
            else toast.success(`Mandado a TIZADA PRO (${r.Referencia}). La tizada vuelve sola cuando termine.`);
            navigate(`/ventas/solicitudes/${pa.SolicitudID}/diseno`);
        } catch (e) { toast.error(errorDe(e)); await cargar(); }
        finally { setBusy(false); }
    };

    if (!perfil) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-brand-cyan" /></div>;
    const vista = pestana ?? 'produccion';

    // Tema claro, como el resto del sistema (06/10). Antes iba dentro de .fp-oscuro, el tema oscuro de las
    // pantallas de Solicitudes (fichaPedido.css), que pasa las clases claras de Tailwind a azul y amarillo.
    return (
        <>
        <div className="p-3 md:p-6 space-y-4">
            {/* Encabezado como el de Configurar Productos: ícono de Lucide en brand-cyan y sin fondo */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <Palette size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Bandeja de Diseño</h1>
                        <p className="text-sm text-slate-400">Trabajos que los vendedores enviaron a diseñar. Es una bandeja común: el que toma un trabajo se lo queda.</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {perfil.esAdmin && <button onClick={() => setVerDisenadores(true)} className={BTN_SECUNDARIO}><Users size={14} /> Ver quiénes son diseñadores</button>}
                    <button onClick={cargar} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500" title="Actualizar"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
                </div>
            </div>

            {perfil.esAdmin && verDisenadores && <Disenadores onClose={() => setVerDisenadores(false)} />}

            {!perfil.esDisenador ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">Tu usuario no es diseñador. Es diseñador quien tiene el rol "Diseñador" (se asigna en la pantalla de Usuarios). Si tenés otro rol y además diseñás, un administrador te habilita desde esta misma pantalla ("Ver quiénes son diseñadores").</div>
            ) : (
                <>
                    <Pestanas actual={vista} onCambiar={setPestana} pestanas={[
                        // En producción primero (06/10, pedido de Santiago)
                        ['produccion', 'En producción', enProduccion.length],
                        ['mias', 'Mis trabajos', data.mias.length],
                        ['disponibles', 'Para tomar', data.disponibles.length],
                    ]} />
                    {vista === 'mias' && (
                        <Tabla vacio="No tenés trabajos tomados." rows={data.mias} mias
                            accion={(pa) => <button onClick={() => navigate(`/ventas/solicitudes/${pa.SolicitudID}/diseno`)} className={BTN_PRINCIPAL}>{pa.Modificada ? 'Abrir y aceptar el cambio' : pa.Estado === 'DISENADO' ? 'Abrir (sustituir archivo)' : esTizada(pa) ? 'Abrir y enviar a TIZADA PRO' : 'Abrir y subir el diseño'}</button>} />
                    )}
                    {vista === 'disponibles' && (
                        <Tabla vacio="No hay trabajos esperando en la bandeja." rows={data.disponibles}
                            accion={(pa) => (
                                <span className="flex flex-wrap justify-end gap-1">
                                    <button onClick={() => navigate(`/ventas/solicitudes/${pa.SolicitudID}`)} className={BTN_SECUNDARIO}>Ver solicitud</button>
                                    {esTizada(pa)
                                        ? <button disabled={busy} onClick={() => enviarTizada(pa)} className={BTN_PRINCIPAL} title="Revisa arte y datos, y lo manda a TIZADA PRO: la tizada vuelve sola como diseño pronto">Enviar a TIZADA PRO</button>
                                        : <button disabled={busy} onClick={() => tomar(pa)} className={BTN_PRINCIPAL}>Tomar este trabajo</button>}
                                </span>
                            )} />
                    )}
                    {vista === 'produccion' && (
                        <EnProduccion rows={enProduccion} onVerSolicitud={(sid) => navigate(`/ventas/solicitudes/${sid}`)} onAbrir={(o) => setFicha({ id: o.OrdenID, area: o.AreaID, codigo: o.CodigoOrden, cliente: o.Cliente })} />
                    )}
                </>
            )}
        </div>
            {/* La MISMA ficha que se abre con el ojito en el área: desde acá se sube la matriz / el boceto / el arte. */}
            <OrderDetailModal order={ficha} onClose={() => { setFicha(null); cargar(); }} onOrderUpdated={cargar} />
            {dialogo}
        </>
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

// ── Las tres secciones (06/10) ──
// Las tres tablas tienen las mismas columnas, en el mismo orden y del mismo ancho, así quedan alineadas una debajo
// de la otra: Estado · Cliente / trabajo · Qué hay que hacer · Producto · Fecha · acción. Antes cada una tenía las
// suyas en otro orden ("Qué hay que hacer" era la 2.ª en dos y la 5.ª en la otra). table-fixed respeta los anchos
// de <col>; Cliente y "Qué hay que hacer" se reparten lo que sobra. Por debajo de xl, tarjetas (ver Seccion).
// Desde 2xl, donde sobra lugar, Estado, Producto y la acción se ensanchan: "Esperando aprobación del cliente" y
// "Parche (De hasta 10x8)" entran en una línea, y "Ver solicitud" va al lado de "Tomar este trabajo" o "Enviar a
// TIZADA PRO" (más angosto, abajo).
// Rótulo chico en mayúsculas: los títulos de columna y, en las tarjetas, el nombre de cada dato
const ROTULO = 'text-[10px] font-black uppercase tracking-wider text-slate-400';
const TH = `px-3 py-2 first:pl-4 last:pr-4 text-left ${ROTULO}`;
const TD = 'px-3 py-3 first:pl-4 last:pr-4 align-top';

function Columnas() {
    return (
        <colgroup>
            <col className="w-52 2xl:w-64" />
            <col />
            <col />
            <col className="w-44 2xl:w-56" />
            <col className="w-36" />
            <col className="w-[15.5rem] 2xl:w-72" />
        </colgroup>
    );
}

// Las filas llegan armadas por dato (estado, cliente, hacer, producto, fecha, accion), en grupos, y se dibujan dos
// veces (06/10): como renglones de la tabla desde xl, y como tarjetas más angosto. La tabla pide 68rem, que por
// debajo de xl (1280 px menos la barra lateral y los márgenes) no entran: antes quedaba con scroll lateral, también
// en el celular.
// Con las pestañas (06/10) la sección ya no lleva título ni contador, que van en la pestaña. Vacía, es una tarjeta
// con el aviso en el medio (antes, una línea con el título y el aviso).
function Seccion({ cantidad, vacio, ayuda, fecha, grupos }) {
    if (!cantidad) return <section className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">{vacio}</section>;
    return (
        <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            {ayuda ? <p className="border-b border-slate-100 px-4 py-3 text-xs text-slate-400">{ayuda}</p> : null}
            <div className="hidden overflow-x-auto xl:block">
                <table className="w-full min-w-[68rem] table-fixed text-sm">
                    <Columnas />
                    <thead>
                        <tr>
                            <th className={TH}>Estado</th>
                            <th className={TH}>Cliente / trabajo</th>
                            <th className={TH}>Qué hay que hacer</th>
                            <th className={TH}>Producto</th>
                            <th className={TH}>{fecha}</th>
                            <th className={TH}><span className="sr-only">Acción</span></th>
                        </tr>
                    </thead>
                    {grupos.map((g, i) => (
                        <tbody key={g.titulo || i}>
                            {g.titulo ? <tr><th colSpan={6} scope="colgroup" className="border-t border-slate-200 bg-slate-100/80 px-4 py-2.5 text-left"><TituloGrupo titulo={g.titulo} Icono={g.Icono} cantidad={g.filas.length} /></th></tr> : null}
                            {g.filas.map(f => (
                                <tr key={f.key} className={`border-t border-slate-100 ${f.resaltada ? 'bg-fuchsia-50/50' : ''}`}>
                                    <td className={TD}>{f.estado}</td>
                                    <td className={TD}>{f.cliente}</td>
                                    <td className={TD}>{f.hacer}</td>
                                    <td className={TD}>{f.producto}</td>
                                    <td className={`${TD} text-slate-500`}>{f.fecha}</td>
                                    <td className={`${TD} text-right`}>{f.accion}</td>
                                </tr>
                            ))}
                        </tbody>
                    ))}
                </table>
            </div>
            <div className="xl:hidden">
                {grupos.map((g, i) => (
                    <div key={g.titulo || i}>
                        {g.titulo ? <div className={`bg-slate-100/80 px-4 py-2.5 ${i > 0 ? 'border-t border-slate-200' : ''}`}><TituloGrupo titulo={g.titulo} Icono={g.Icono} cantidad={g.filas.length} /></div> : null}
                        {/* grid-cols-1 (minmax(0, 1fr)) y no la columna implícita: la observación en una línea (truncate) la estiraba más que la pantalla */}
                        <ul className="grid grid-cols-1 gap-3 p-3 md:grid-cols-2">
                            {g.filas.map(f => (
                                <li key={f.key} className={`flex flex-col gap-3 rounded-xl border p-3 text-sm ${f.resaltada ? 'border-fuchsia-200 bg-fuchsia-50/50' : 'border-slate-200'}`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">{f.estado}</div>
                                        <div className="shrink-0 text-right">
                                            <div className={ROTULO}>{fecha}</div>
                                            <div className="text-xs text-slate-500">{f.fecha}</div>
                                        </div>
                                    </div>
                                    <div>{f.cliente}</div>
                                    <div><div className={ROTULO}>Qué hay que hacer</div>{f.hacer}</div>
                                    <div><div className={ROTULO}>Producto</div>{f.producto}</div>
                                    {/* Los botones ocupan todo el ancho de la tarjeta; en el celular, 44 px de alto para el dedo */}
                                    <div className="mt-auto grid grid-cols-1 [&>span]:gap-2 [&_button]:flex-1 [&_button]:justify-center max-md:[&_button]:min-h-[44px]">{f.accion}</div>
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </div>
        </section>
    );
}

// El estado escrito normal, sin mayúsculas, con su color (06/10). Las pastillas de solicitudesComunes van en
// mayúsculas y las usan también las pantallas oscuras de Solicitudes, así que acá va una propia. rounded-xl en vez
// de rounded-full: en una línea se ven igual, y un estado largo que no entra en la columna baja a dos líneas sin
// deformarse.
const PastillaEstado = ({ txt, cls, title }) => (
    <span title={title} className={`inline-block rounded-xl px-2 py-0.5 text-xs font-semibold leading-snug ${cls}`}>{txt}</span>
);

// Título de un grupo ("Para hacer" / "Esperando al cliente"), el mismo en la tabla y en las tarjetas.
// 06/10: más visible (Santiago: "pasan un poco desapercibidos"). Antes era igual a los títulos de columna (10 px,
// mayúsculas, gris claro); ahora va en 14 px negrita, con su ícono en brand-cyan y el contador, sobre una franja gris.
const TituloGrupo = ({ titulo, Icono, cantidad }) => (
    <span className="flex items-center gap-2">
        {Icono ? <Icono size={16} className="shrink-0 text-brand-cyan" aria-hidden="true" /> : null}
        <span className="text-sm font-black text-slate-800">{titulo}</span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">{cantidad}</span>
    </span>
);

// Producción partida en dos grupos (06/10): arriba lo que el diseñador tiene que hacer (rechazado, falta diseño,
// aprobado sin arte), con el botón en brand-cyan; abajo lo que espera al cliente, con "Ver ficha" sin color. Antes
// iban mezcladas, todas con el mismo botón. El orden dentro de cada grupo es el del backend (etapa y fecha).
// El texto de ayuda quedó en una línea: lo de "un trabajo tomado en una solicitud pasa a esta lista" ya se ve en
// la fila ("Viene de la Solicitud #… · ahí lo había tomado …").
function EnProduccion({ rows, onAbrir, onVerSolicitud }) {
    const esperaCliente = (o) => o.Etapa === 'ESPERANDO_APROBACION';
    const fila = (o) => {
        const et = ETAPA_PRODUCCION[o.Etapa] || { txt: o.Etapa, cls: 'bg-slate-50 text-slate-600 border-slate-200', hacer: '' };
        // [INGRESO INTERNO] Pedido cargado por el personal: el boceto de TPU no va al cliente,
        // lo confirma el diseñador desde la ficha ("Confirmar diseño").
        const interno = o.IngresoInternoPor != null;
        const hacer = (interno && o.AreaID === 'TPU' && o.Etapa === 'FALTA_DISENO')
            ? 'Subir el boceto de producción y confirmar el diseño (pedido interno: no va al cliente)'
            : (typeof et.hacer === 'string' ? et.hacer : (et.hacer[o.AreaID] || ''));
        return {
            key: o.OrdenID,
            estado: (
                <>
                    <PastillaEstado txt={et.txt} cls={et.cls} />
                    {interno ? <div className="mt-1"><PastillaEstado txt="Pedido interno" cls="bg-cyan-50 text-brand-cyan" title="Lo cargó el personal. En TPU el boceto no va al cliente: lo confirma el diseñador." /></div> : null}
                </>
            ),
            // La orden (antes una columna aparte) va con el cliente; el área, en "Qué hay que hacer", como el servicio en las solicitudes
            cliente: (
                <>
                    <div className="font-bold text-slate-800">{o.Cliente}</div>
                    <div className="text-slate-500">{o.DescripcionTrabajo}</div>
                    <div className="text-xs text-slate-400"><span className="font-mono font-bold text-slate-700">{o.CodigoOrden}</span> · pedido {o.NoDocERP}</div>
                    {o.SolicitudID ? <div className="text-xs text-slate-500 mt-0.5">Viene de la <button type="button" onClick={() => onVerSolicitud(o.SolicitudID)} className="text-brand-cyan font-bold hover:underline">Solicitud #{o.SolicitudID}</button>{o.DisenadorSolicitud ? <> · ahí lo había tomado <b>{o.DisenadorSolicitud}</b></> : null}</div> : null}
                </>
            ),
            hacer: (
                <>
                    <div className="font-semibold text-slate-800">{AREA_NOMBRE[o.AreaID] || o.AreaID}</div>
                    <div className="text-slate-500">{hacer}</div>
                </>
            ),
            producto: <div className="text-slate-700">{o.Material}</div>,
            fecha: fmtFechaHora(o.FechaIngreso),
            accion: esperaCliente(o)
                ? <button onClick={() => onAbrir(o)} className={BTN_SECUNDARIO}>Ver ficha</button>
                : <button onClick={() => onAbrir(o)} className={BTN_PRINCIPAL}>Abrir la ficha de la orden</button>,
        };
    };
    const grupos = [['Para hacer', ListTodo, rows.filter(o => !esperaCliente(o))], ['Esperando al cliente', Clock, rows.filter(esperaCliente)]]
        .filter(([, , lista]) => lista.length > 0)
        .map(([titulo, Icono, lista]) => ({ titulo, Icono, filas: lista.map(fila) }));
    return (
        <Seccion cantidad={rows.length} vacio="No hay órdenes de Bordado ni de TPU esperando diseño."
            ayuda="Pedidos que ya están en planta y esperan su diseño. Se sube en la ficha de la orden, la misma del ojito en el área, y la orden se libera sola."
            fecha="Ingresó" grupos={grupos} />
    );
}

function Tabla({ vacio, rows, accion, mias }) {
    const filas = rows.map(pa => {
        const est = ESTADO_PARTE[pa.Estado] || { txt: pa.Estado, cls: 'bg-slate-100 text-slate-600' };
        // El detalle (antes una columna aparte) va con lo que hay que hacer: cuántos, dónde y las observaciones
        const detalle = [pa.CantidadTotal ? `${pa.CantidadTotal} en total` : null, pa.PorPrenda ? `${pa.PorPrenda} por prenda` : null, pa.Ubicacion].filter(Boolean).join(' · ');
        return {
            key: pa.ParteID,
            resaltada: !!pa.Modificada,
            estado: (
                <>
                    <PastillaEstado txt={est.txt} cls={est.cls} />
                    {pa.Modificada ? <div className="mt-1"><PastillaEstado txt="Modificada · falta aceptar" cls="bg-fuchsia-100 text-fuchsia-700" title={pa.ModificadaDetalle || ''} /></div> : null}
                </>
            ),
            cliente: (
                <>
                    <div className="font-bold text-slate-800">{pa.ClienteNombre}</div>
                    <div className="text-slate-500">#{pa.SolicitudID} · {pa.NombreTrabajo}</div>
                    <div className="text-xs text-slate-400">vendedor {pa.VendedorNombre || '—'}</div>
                </>
            ),
            hacer: (
                <>
                    <div className="font-semibold text-slate-800">{NOMBRE_PARTE[pa.Tipo]}</div>
                    <div className="text-slate-500">{TIPO_TRABAJO[pa.TipoTrabajo] || '—'}</div>
                    {detalle ? <div className="text-xs text-slate-400">{detalle}</div> : null}
                    {pa.Observaciones ? <div className="text-xs text-slate-400 truncate" title={pa.Observaciones}>{pa.Observaciones}</div> : null}
                </>
            ),
            producto: (
                <>
                    <div className="text-slate-700">{pa.TipoFabricacion === 'PRODUCTO_TERMINADO' ? pa.ProductoNombre : 'Personalizado'}</div>
                    <div className="text-xs text-slate-400">{pa.CantidadPrendas} prendas</div>
                </>
            ),
            fecha: fmtFechaHora(mias ? pa.FechaInicioDiseno : pa.FechaEnvioDiseno),
            accion: accion(pa),
        };
    });
    return <Seccion cantidad={rows.length} vacio={vacio} fecha={mias ? 'Tomado' : 'Enviado'} grupos={[{ filas }]} />;
}

// Pestañas (06/10; Santiago eligió probarlas, "a ver"): se ve una lista por vez. Mismo estilo que Configurar
// Productos y Servicio Técnico: la elegida subrayada en brand-cyan, con su contador. El contador de una pestaña sin
// nada va apagado, para ver de un vistazo dónde hay trabajo. En el celular, el desplegable con la pestaña actual.
// La línea de abajo es una sombra interna: con un borde, el subrayado desbordaba y aparecía una barra de scroll.
function Pestanas({ pestanas, actual, onCambiar }) {
    return (
        <>
            <div className="sm:hidden">
                <Selector value={actual} onChange={e => onCambiar(e.target.value)} aria-label="Lista" anchoLista={260}>
                    {pestanas.map(([id, label, n]) => <option key={id} value={id}>{label} · {n}</option>)}
                </Selector>
            </div>
            <div className="hidden sm:flex items-center overflow-x-auto no-scrollbar shadow-[inset_0_-1px_0_0_#e2e8f0]">
                {pestanas.map(([id, label, n]) => {
                    const on = actual === id;
                    return (
                        <button key={id} type="button" onClick={() => onCambiar(id)} aria-current={on ? 'page' : undefined}
                            className={`shrink-0 inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${on ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}>
                            {label}
                            <span className={`rounded-full px-1.5 text-[11px] font-black ${on ? 'bg-brand-cyan/10 text-brand-cyan' : n ? 'bg-slate-200 text-slate-600' : 'bg-slate-100 text-slate-400'}`}>{n}</span>
                        </button>
                    );
                })}
            </div>
        </>
    );
}

// Diseñador = rol de login "Diseñador". Acá el Admin ve quiénes lo son y habilita, como excepción, a alguien
// que tiene OTRO rol y además diseña. El rol Admin siempre puede operar la bandeja.
// En una ventana (06/10): antes era un panel que se abría en el medio de la página, con cada persona como un botón
// ("— por su rol", "— habilitar"). Ahora es una lista: arriba los diseñadores y abajo el buscador para habilitar a
// alguien con otro rol. Los que lo son por su rol no tienen botón (antes avisaba que se cambia en Usuarios).
function Disenadores({ onClose }) {
    const [rows, setRows] = useState(null);     // null = cargando
    const [q, setQ] = useState('');
    const [dialogo, preguntar] = useConfirmar();
    const cargar = useCallback(() => svc.disenadores().then(setRows).catch(e => { setRows([]); toast.error(errorDe(e)); }), []);
    useEffect(() => { cargar(); }, [cargar]);
    const cambiar = async (u) => {
        const activo = !u.EsDisenador;
        const ok = await preguntar(activo
            ? { Icono: UserPlus, titulo: 'Habilitar como diseñador', boton: 'Habilitar', texto: `${u.Nombre} tiene el rol "${u.NombreRol}". Va a ver la bandeja de Diseño y va a poder tomar trabajos.` }
            : { Icono: UserMinus, titulo: 'Quitar la habilitación', boton: 'Quitar', texto: `${u.Nombre} deja de ver la bandeja de Diseño. Los trabajos que ya tomó siguen a su nombre.` });
        if (!ok) return;
        try { await svc.definirDisenador(u.IdUsuario, activo); await cargar(); }
        catch (e) { toast.error(errorDe(e)); }
    };
    const texto = q.trim().toLowerCase();
    const disenadores = (rows || []).filter(u => u.EsDisenador);
    const encontrados = texto.length >= 2 ? (rows || []).filter(u => !u.EsDisenador && String(u.Nombre || '').toLowerCase().includes(texto)) : [];
    const pastilla = 'rounded-xl bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700';
    const persona = (u, derecha) => (
        <li key={u.IdUsuario} className="flex items-center justify-between gap-3 py-2.5">
            <div className="min-w-0">
                <div className="truncate text-sm font-bold text-slate-800">{u.Nombre}</div>
                <div className="truncate text-xs text-slate-400">{u.NombreRol || 'Sin rol'}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">{derecha}</div>
        </li>
    );
    return (
        <Ventana Icono={Users} titulo="Quiénes son diseñadores" onClose={onClose}>
            <div className="space-y-6">
                <p className="text-sm text-slate-500">Lo normal es asignarle a la persona el rol "Diseñador" en la pantalla de Usuarios. Acá solo se habilita, como excepción, a alguien que tiene otro rol y además diseña.</p>
                <div>
                    <div className="flex items-center gap-2">
                        <h3 className={ROTULO}>Diseñadores</h3>
                        {rows ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">{disenadores.length}</span> : null}
                    </div>
                    {rows === null ? <div className="flex justify-center py-6"><Loader2 className="animate-spin text-brand-cyan" /></div>
                        : disenadores.length === 0 ? <p className="pt-2 text-sm text-slate-400">Todavía no hay nadie con el rol "Diseñador" ni habilitado como excepción.</p>
                        : (
                            <ul className="divide-y divide-slate-100">
                                {disenadores.map(u => persona(u, u.PorRol
                                    ? <span className={pastilla} title='Para quitárselo, cambiale el rol en la pantalla de Usuarios'>Por su rol</span>
                                    : <><span className={pastilla}>Excepción</span><button type="button" onClick={() => cambiar(u)} className={BTN_SECUNDARIO}>Quitar</button></>))}
                            </ul>
                        )}
                </div>
                <div>
                    <h3 className={`${ROTULO} mb-2`}>Habilitar a alguien con otro rol</h3>
                    <div className="relative">
                        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre (mínimo 2 letras)" aria-label="Buscar a alguien con otro rol"
                            className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15" />
                    </div>
                    {texto.length >= 2 && (encontrados.length
                        ? <ul className="mt-1 divide-y divide-slate-100">{encontrados.map(u => persona(u, <button type="button" onClick={() => cambiar(u)} className={BTN_PRINCIPAL}>Habilitar</button>))}</ul>
                        : <p className="pt-3 text-sm text-slate-400">No hay nadie con otro rol que se llame así.</p>)}
                </div>
            </div>
            {dialogo}
        </Ventana>
    );
}
