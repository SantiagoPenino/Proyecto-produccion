import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Ban, Clock, Globe, ListTodo, Loader2, Palette, RefreshCw, Search, Send, UserCheck, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFechaHora } from '../../../utils/fechas';
import OrderDetailModal from '../../production/components/OrderDetailModal';
import Selector from '../../ui/Selector';
import SelectorFecha from '../../ui/SelectorFecha';
import { BTN_SECUNDARIO, BotonAyuda, ESTADO_PARTE, NOMBRE_PARTE, TIPO_TRABAJO, Ventana, VisorPdf, errorDe, useConfirmar } from './solicitudesComunes';

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
    const [portal, setPortal] = useState([]);               // [20/10] lo de la tienda del portal que todavía no es pedido
    const [cancelando, setCancelando] = useState(null);     // [20/10] pedido del portal que se está por cancelar (pide el motivo)
    const [global, setGlobal] = useState(null);             // [20/10] resultados del buscador en todo Diseño (null = sin buscar)
    const [buscando, setBuscando] = useState(false);
    const [ficha, setFicha] = useState(null);               // orden abierta en la ficha de producción
    const [dialogo, preguntar] = useConfirmar();             // confirmaciones con el estilo del sistema (06/10)
    const [pestana, setPestana] = useState(null);           // 'mias' | 'disponibles' | 'produccion' (null hasta la 1.ª carga)
    const [filtro, setFiltro] = useState({ q: '', servicio: '', estado: '' });   // [FILTROS 14/10] ver filtrar()
    const [pdf, setPdf] = useState(null);                   // [15/10] ficha de la solicitud abierta: { blob, sid }
    const [abriendo, setAbriendo] = useState(null);         // SolicitudID cuya ficha se está armando
    // [HECHOS 15/10] Lo que Diseño ya terminó en el período (por defecto, hoy) y sus filtros propios
    const [hechos, setHechos] = useState(null);             // null = todavía sin leer
    const [periodo, setPeriodo] = useState({ clave: 'hoy', desde: '', hasta: '' });
    const [fh, setFh] = useState({ quien: '', pedido: '', mios: false });
    const cargarHechos = useCallback(async () => {
        const { desde, hasta } = rangoDe(periodo);
        try { setHechos(await svc.disenosHechos(desde, hasta)); }
        catch (e) { setHechos([]); if (e?.response?.status !== 403) toast.error(errorDe(e)); }
    }, [periodo]);

    const cargar = useCallback(async () => {
        setLoading(true);
        let bandeja = null;
        let produccion = [];
        try { bandeja = await svc.bandeja(); setData(bandeja); }
        catch (e) { if (e?.response?.status !== 403) toast.error(errorDe(e)); }
        try { produccion = await svc.disenosEnProduccion(); setEnProduccion(produccion); }
        catch (e) { setEnProduccion([]); }
        try { setPortal(await svc.bandejaPortal()); } catch (e) { setPortal([]); }   // [20/10] pestaña "Del portal"
        finally { setLoading(false); }
        // La primera vez abre la primera pestaña que tenga algo; después queda la que elija el diseñador
        // (que no salte sola cuando se vuelve a leer cada minuto).
        // [20/10] en el orden de las pestañas: Para tomar · Mis trabajos · En producción
        setPestana(p => p ?? (bandeja?.disponibles?.length ? 'disponibles' : bandeja?.mias?.length ? 'mias' : produccion.length ? 'produccion' : 'disponibles'));
    }, []);
    useEffect(() => { svc.miPerfil().then(p => { setPerfil(p); if (p.esDisenador) cargar(); }).catch(e => toast.error(errorDe(e))); }, [cargar]);
    useEffect(() => { if (perfil?.esDisenador) cargarHechos(); }, [perfil, cargarHechos]);

    // Esta pantalla no guarda ningún estado propio: lee el estado REAL de cada orden en producción. Si alguien sube
    // el diseño entrando por el área (el ojito), acá cambia igual; se vuelve a leer sola cada minuto y al volver a la pestaña.
    useEffect(() => {
        if (!perfil?.esDisenador) return undefined;
        const leer = () => { if (document.visibilityState === 'visible' && !ficha) { cargar(); cargarHechos(); } };
        const t = setInterval(leer, 60000);
        document.addEventListener('visibilitychange', leer);
        return () => { clearInterval(t); document.removeEventListener('visibilitychange', leer); };
    }, [perfil, ficha, cargar, cargarHechos]);

    // [BUSCAR 20/10] El buscador busca en TODO Diseño (también lo tomado por otros diseñadores, lo del portal, lo ya pedido
    // y lo cancelado): el servidor (buscarDiseno) + las órdenes en producción que ya están en pantalla.
    useEffect(() => {
        const q = filtro.q.trim();
        if (!perfil?.esDisenador || q.length < 2) { setGlobal(null); return undefined; }
        let vivo = true;
        const t = setTimeout(async () => {
            setBuscando(true);
            try { const r = await svc.buscarDiseno(q); if (vivo) setGlobal(r); }
            catch (e) { if (vivo) { setGlobal([]); toast.error(errorDe(e)); } }
            finally { if (vivo) setBuscando(false); }
        }, 450);
        return () => { vivo = false; clearTimeout(t); };
    }, [filtro.q, perfil]);

    // [20/10] Pedido del portal: reenviar a TIZADA (después de corregir lo que rechazó) y cancelar con motivo (el cliente lo ve)
    const reenviarTizada = async (x) => {
        const ok = await preguntar({
            Icono: Send, titulo: 'Reenviar a TIZADA PRO', boton: 'Reenviar a TIZADA PRO',
            texto: `Pedido del portal de ${x.ClienteNombre} (#${x.SolicitudID}). Se vuelven a revisar el arte y los datos; si TIZADA lo acepta, la tizada vuelve sola y el pedido se arma solo.`,
            nota: x.Detalle ? `La última vez TIZADA dijo: ${x.Detalle}` : null,
        });
        if (!ok) return;
        setBusy(true);
        try {
            const r = await svc.tizadaProEnviar(x.SolicitudID, x.ProductoSolID, false);
            if (r.Estado === 'RECHAZADO') toast.error(`TIZADA no lo acepta: ${r.mensaje || 'mirá las alarmas en la solicitud'}.`);
            else toast.success(`Mandado a TIZADA PRO (${r.Referencia}). La tizada vuelve sola cuando termine.`);
        } catch (e) { toast.error(errorDe(e)); }
        finally { setBusy(false); await cargar(); }
    };
    const confirmarCancelacion = async (x, motivo) => {
        setBusy(true);
        try { await svc.cancelarDelPortal(x.SolicitudID, motivo); toast.success(`Pedido #${x.SolicitudID} cancelado. El cliente lo ve en su portal con el motivo.`); setCancelando(null); await cargar(); }
        catch (e) { toast.error(errorDe(e)); }
        finally { setBusy(false); }
    };

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

    // [15/10] "Ver solicitud" abre la ficha de la solicitud en PDF (lo que pidió el cliente y lo de Diseño), como en la
    // pantalla de Diseño. Antes iba a la pantalla del vendedor.
    const verSolicitud = async (sid) => {
        setAbriendo(sid);
        try { setPdf({ blob: new Blob([await svc.fichaPdf(sid)], { type: 'application/pdf' }), sid }); }
        catch (e) { toast.error(`No se pudo generar la ficha: ${errorDe(e)}`); }
        finally { setAbriendo(null); }
    };

    // Producción principal de un producto con molde de TIZADA PRO: [20/10] se toma como cualquier trabajo y se manda a TIZADA
    // desde la pantalla de Diseño (en "Mis trabajos": "Abrir y enviar a TIZADA PRO"); la tizada vuelve sola como diseño pronto.
    const esTizada = (pa) => pa.Tipo === 'PRINCIPAL' && pa.TipoFabricacion === 'PRODUCTO_TERMINADO' && !!pa.TizadaProMoldeRef;

    if (!perfil) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-brand-cyan" /></div>;
    const vista = pestana ?? 'disponibles';

    // [FILTROS 14/10] El texto y el servicio valen para las tres pestañas (los contadores dicen cuántos coinciden en
    // cada una); el estado es de la pestaña abierta (cada una tiene los suyos) y se limpia al cambiar de pestaña.
    // [15/10] "Mis trabajos" suma las órdenes en producción de servicios que tomé en la solicitud y todavía esperan
    // su diseño (misProduccion): tomé el trabajo, entonces lo sigo viendo aunque ya sea pedido. También siguen en "En producción".
    const misProduccion = enProduccion.filter(o => o.EsMia);
    const listas = { produccion: enProduccion, mias: data.mias, misProduccion, disponibles: data.disponibles, hechos: hechos || [], portal };
    const deProduccion = (k) => k === 'produccion' || k === 'misProduccion';
    // [HECHOS 15/10] además del texto y el servicio: quién lo hizo, el pedido y "Solo los míos" (el estado no aplica)
    const propiosHechos = (x) => (!fh.quien || x.Quien === fh.quien) && (!fh.pedido || estadoPedidoDe(x) === fh.pedido) && (!fh.mios || x.EsMia);
    const filtrada = (k, conEstado) => {
        const r = filtrar(listas[k], deProduccion(k), filtro, conEstado && k !== 'hechos' && k !== 'portal');
        return k === 'hechos' ? r.filter(propiosHechos) : r;
    };
    const visibles = filtrada(vista, true);
    const visiblesMiProd = vista === 'mias' ? filtrada('misProduccion', true) : [];
    const hayFiltro = !!(filtro.q.trim() || filtro.servicio || filtro.estado || (vista === 'hechos' && (fh.quien || fh.pedido || fh.mios)));
    const servicios = [...new Set([...enProduccion.map(servicioOrden), ...data.mias.map(pa => pa.Tipo), ...data.disponibles.map(pa => pa.Tipo), ...(hechos || []).map(x => x.Tipo)])]
        .sort((a, b) => ORDEN_SERVICIO.indexOf(a) - ORDEN_SERVICIO.indexOf(b));
    const estados = vista === 'hechos' || vista === 'portal' ? [] : vista === 'mias' ? [...estadosDe(data.mias, false), ...estadosDe(misProduccion, true)] : estadosDe(listas[vista], deProduccion(vista));
    const cambiarPestana = (v) => { setPestana(v); setFiltro(f => ({ ...f, estado: '' })); };
    const contador = (k) => (k === 'hechos' && hechos === null ? null
        : k === vista ? visibles.length + visiblesMiProd.length : filtrada(k, false).length + (k === 'mias' ? filtrada('misProduccion', false).length : 0));
    const abrirOrden = (o) => setFicha({ id: o.OrdenID, area: o.AreaID, codigo: o.CodigoOrden, cliente: o.Cliente });
    // [BUSCAR 20/10] con 2 letras o más el buscador muestra lo de todo Diseño (el filtro de servicio también vale)
    const busquedaGlobal = filtro.q.trim().length >= 2;
    const globalFiltrado = (global || []).filter(x => !filtro.servicio || x.Tipo === filtro.servicio);
    const vacioCon = (txt) => (hayFiltro ? 'Ningún trabajo coincide con los filtros.' : txt);

    // Tema claro, como el resto del sistema (06/10). Antes iba dentro de .fp-oscuro, el tema oscuro de las
    // pantallas de Solicitudes (fichaPedido.css, borrado el 06/10), que pasaba las clases claras a azul y amarillo.
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
                    <button onClick={() => { cargar(); if (perfil.esDisenador) cargarHechos(); }} className="p-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-500" title="Actualizar"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
                    <BotonAyuda guia="disenadores" />
                </div>
            </div>

            {perfil.esAdmin && verDisenadores && <Disenadores onClose={() => setVerDisenadores(false)} />}

            {!perfil.esDisenador ? (
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">Tu usuario no es diseñador. Es diseñador quien tiene el rol "Diseñador" (se asigna en la pantalla de Usuarios). Si tenés otro rol y además diseñás, un administrador te habilita desde esta misma pantalla ("Ver quiénes son diseñadores").</div>
            ) : (
                <>
                    <Pestanas actual={vista} onCambiar={cambiarPestana} pestanas={[
                        // [20/10] Para tomar · Mis trabajos · En producción · Hechos (pedido de Yoania)
                        ['disponibles', 'Para tomar', contador('disponibles')],
                        ['mias', 'Mis trabajos', contador('mias')],
                        ['produccion', 'En producción', contador('produccion')],
                        ['hechos', 'Hechos', contador('hechos')],   // [HECHOS 15/10] lo ya diseñado (por defecto, hoy)
                        ['portal', 'Del portal', contador('portal')],   // [20/10] lo de la tienda que todavía no es pedido
                    ]} />
                    <Filtros filtro={filtro} onCambiar={c => setFiltro(f => ({ ...f, ...c }))} servicios={servicios} estados={estados} hayFiltro={hayFiltro}
                        onLimpiar={() => { setFiltro({ q: '', servicio: '', estado: '' }); setFh({ quien: '', pedido: '', mios: false }); }}>
                        {vista === 'hechos' && <FiltrosHechos periodo={periodo} onPeriodo={setPeriodo} fh={fh} onFh={c => setFh(f => ({ ...f, ...c }))} />}
                    </Filtros>
                    {busquedaGlobal ? (
                        <ResultadosBusqueda q={filtro.q.trim()} rows={globalFiltrado} buscando={buscando} produccion={filtrar(enProduccion, true, filtro, false)}
                            perfil={perfil} busy={busy} abriendo={abriendo} onVerSolicitud={verSolicitud} onTomar={tomar} onAbrirOrden={abrirOrden}
                            onAbrir={(x) => navigate(`/ventas/solicitudes/${x.SolicitudID}/diseno`)} />
                    ) : (<>
                    {vista === 'mias' && visiblesMiProd.length > 0 && visibles.length > 0 && <h3 className={`${ROTULO} -mb-2`}>En las solicitudes</h3>}
                    {vista === 'mias' && (visibles.length > 0 || !visiblesMiProd.length) && (
                        <Tabla vacio={vacioCon('No tenés trabajos tomados.')} rows={visibles} mias
                            accion={(pa) => <button onClick={() => navigate(`/ventas/solicitudes/${pa.SolicitudID}/diseno`)} className={pa.TizadaEnCurso && !pa.Modificada ? BTN_SECUNDARIO : BTN_PRINCIPAL}>{pa.Modificada ? 'Abrir y aceptar el cambio' : pa.TizadaEnCurso ? 'Abrir (TIZADA está trabajando)' : pa.Estado === 'DISENADO' ? (esTizada(pa) ? 'Abrir (rehacer la tizada)' : 'Abrir (sustituir archivo)') : esTizada(pa) ? 'Abrir y enviar a TIZADA PRO' : 'Abrir y subir el diseño'}</button>} />
                    )}
                    {vista === 'mias' && visiblesMiProd.length > 0 && (
                        <>
                            <h3 className={`${ROTULO} -mb-2`}>Ya en producción · esperan tu diseño</h3>
                            <EnProduccion rows={visiblesMiProd} vacio="" onVerSolicitud={verSolicitud} onAbrir={abrirOrden}
                                ayuda="Servicios que tomaste en la solicitud y ya son pedido: la orden está en planta esperando su diseño. Se sube en la ficha de la orden y la orden se libera sola. Salen de acá cuando la orden tiene su diseño." />
                        </>
                    )}
                    {vista === 'disponibles' && (
                        <Tabla vacio={vacioCon('No hay trabajos esperando en la bandeja.')} rows={visibles}
                            accion={(pa) => (
                                <span className="flex flex-wrap justify-end gap-1">
                                    <button disabled={abriendo === pa.SolicitudID} onClick={() => verSolicitud(pa.SolicitudID)} className={BTN_SECUNDARIO} title="La ficha de la solicitud en PDF">{abriendo === pa.SolicitudID ? <Loader2 size={12} className="animate-spin" /> : null} Ver solicitud</button>
                                    {/* [20/10] siempre se toma: el de TIZADA PRO se revisa y se manda desde la pantalla de Diseño, ya tomado */}
                                    <button disabled={busy} onClick={() => tomar(pa)} className={BTN_PRINCIPAL}>Tomar este trabajo</button>
                                </span>
                            )} />
                    )}
                    {vista === 'produccion' && (
                        <EnProduccion rows={visibles} vacio={vacioCon('No hay órdenes de Bordado ni de TPU esperando diseño.')} onVerSolicitud={verSolicitud} onAbrir={abrirOrden} />
                    )}
                    {vista === 'hechos' && (hechos === null
                        ? <div className="flex justify-center py-10"><Loader2 className="animate-spin text-brand-cyan" /></div>
                        : <ListaHechos rows={visibles} abriendo={abriendo} onVerSolicitud={verSolicitud} onAbrir={(x) => navigate(`/ventas/solicitudes/${x.SolicitudID}/diseno`)}
                            vacio={vacioCon(periodo.clave === 'hoy' ? 'Hoy todavía no se terminó ningún diseño.' : 'No hay diseños terminados en ese período.')} />)}
                    {vista === 'portal' && (
                        <DelPortal rows={visibles} vacio={vacioCon('No hay pedidos del portal sin convertir.')} busy={busy} abriendo={abriendo}
                            onVerSolicitud={verSolicitud} onReenviar={reenviarTizada} onCancelar={setCancelando} />
                    )}
                    </>)}
                </>
            )}
        </div>
            {/* La MISMA ficha que se abre con el ojito en el área: desde acá se sube la matriz / el boceto / el arte. */}
            <OrderDetailModal order={ficha} onClose={() => { setFicha(null); cargar(); }} onOrderUpdated={cargar} />
            <VisorPdf blob={pdf?.blob || null} nombre={`Ficha pedido SOL-${pdf?.sid}.pdf`} onClose={() => setPdf(null)} />
            {dialogo}
            {cancelando && <CancelarPortal x={cancelando} busy={busy} onClose={() => setCancelando(null)} onConfirmar={(m) => confirmarCancelacion(cancelando, m)} />}
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

// ── [FILTROS 14/10] Buscar, servicio y estado ──
// El servicio con la misma clave en las tres pestañas: en producción es el área de la orden (EMB → Bordado)
const servicioOrden = (o) => ({ EMB: 'BORDADO', TPU: 'TPU' }[o.AreaID] || o.AreaID);
const ORDEN_SERVICIO = ['PRINCIPAL', 'BORDADO', 'DTF', 'TPU'];
const nombreServicio = (k) => NOMBRE_PARTE[k] || AREA_NOMBRE[k] || k;
const sinTilde = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Dónde busca el texto: lo que se ve en la fila (cliente, trabajo, orden, pedido, solicitud, vendedor, producto)
const textoDe = (x, prod) => sinTilde((prod
    ? [x.Cliente, x.DescripcionTrabajo, x.CodigoOrden, x.NoDocERP && `pedido ${x.NoDocERP}`, x.SolicitudID && `#${x.SolicitudID}`, x.Material, x.DisenadorSolicitud, AREA_NOMBRE[x.AreaID]]
    : [x.ClienteNombre, x.NombreTrabajo, `#${x.SolicitudID}`, x.VendedorNombre, x.ProductoNombre, NOMBRE_PARTE[x.Tipo], x.Observaciones,
        x.PedidoNoDocERP && `pedido ${x.PedidoNoDocERP}`, x.DisenadorNombre, x.HizoNombre]).filter(Boolean).join(' '));
// Estado: en producción la etapa de la orden; en las solicitudes el de la parte, y "Modificada" aparte (es una marca)
const MODIFICADA = 'MODIFICADA';
function filtrar(rows, prod, { q, servicio, estado }, conEstado) {
    const palabras = sinTilde(q).split(/\s+/).filter(Boolean);
    return rows.filter(x => {
        if (servicio && (prod ? servicioOrden(x) : x.Tipo) !== servicio) return false;
        if (conEstado && estado && !(prod ? x.Etapa === estado : estado === MODIFICADA ? !!x.Modificada : x.Estado === estado)) return false;
        if (!palabras.length) return true;
        const t = textoDe(x, prod);
        return palabras.every(w => t.includes(w));
    });
}
// Los estados que hay en la pestaña (en el orden de siempre), para el desplegable
function estadosDe(rows, prod) {
    const mapa = prod ? ETAPA_PRODUCCION : ESTADO_PARTE;
    const hay = new Set(rows.map(x => (prod ? x.Etapa : x.Estado)));
    const lista = [...Object.keys(mapa).filter(k => hay.has(k)), ...[...hay].filter(k => k && !mapa[k])].map(k => [k, mapa[k]?.txt || k]);
    if (!prod && rows.some(x => x.Modificada)) lista.push([MODIFICADA, 'Modificada · falta aceptar']);
    return lista;
}

function Filtros({ filtro, onCambiar, servicios, estados, hayFiltro, onLimpiar, children = null }) {
    return (
        <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-md">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input value={filtro.q} onChange={e => onCambiar({ q: e.target.value })} placeholder="Buscar en todo Diseño: cliente, trabajo, orden, pedido, solicitud o diseñador" aria-label="Buscar en todo Diseño"
                    className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15" />
            </div>
            {(servicios.length > 1 || filtro.servicio) && (
                <Selector filtro value={filtro.servicio} onChange={e => onCambiar({ servicio: e.target.value })} aria-label="Servicio" anchoLista={260}>
                    <option value="">Todos los servicios</option>
                    {servicios.map(k => <option key={k} value={k}>{nombreServicio(k)}</option>)}
                </Selector>
            )}
            {(estados.length > 1 || filtro.estado) && (
                <Selector filtro value={filtro.estado} onChange={e => onCambiar({ estado: e.target.value })} aria-label="Estado" anchoLista={280}>
                    <option value="">Todos los estados</option>
                    {estados.map(([k, txt]) => <option key={k} value={k}>{txt}</option>)}
                </Selector>
            )}
            {children}
            {hayFiltro && <button type="button" onClick={onLimpiar} className={BTN_SECUNDARIO}><X size={14} /> Limpiar filtros</button>}
        </div>
    );
}

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
function Seccion({ cantidad, vacio, ayuda, fecha, grupos, tituloHacer = 'Qué hay que hacer' }) {
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
                            <th className={TH}>{tituloHacer}</th>
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
                                    <div><div className={ROTULO}>{tituloHacer}</div>{f.hacer}</div>
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
function EnProduccion({ rows, vacio, onAbrir, onVerSolicitud, ayuda = 'Pedidos que ya están en planta y esperan su diseño. Se sube en la ficha de la orden, la misma del ojito en el área, y la orden se libera sola.' }) {
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
        <Seccion cantidad={rows.length} vacio={vacio} ayuda={ayuda} fecha="Ingresó" grupos={grupos} />
    );
}

function Tabla({ vacio, rows, accion, mias }) {
    const filas = rows.map(pa => {
        const est = ESTADO_PARTE[pa.Estado] || { txt: pa.Estado, cls: 'bg-slate-100 text-slate-600' };
        // [15/10] Con TIZADA PRO las cantidades salen de la lista de jugadores (ListaPrendas, del servidor); "cantidad total /
        // por prenda / ubicación" eran del formulario viejo y pueden estar desactualizados. Sin TIZADA, como antes.
        const conTz = !!pa.TizadaProMoldeRef;
        const noCoincide = conTz && pa.ListaPrendas != null && Number(pa.ListaPrendas) !== Number(pa.CantidadPrendas);
        // El detalle (antes una columna aparte) va con lo que hay que hacer: cuántos, dónde y las observaciones
        const detalle = conTz
            ? (pa.ListaPrendas != null ? `${pa.ListaPrendas} prenda${Number(pa.ListaPrendas) === 1 ? '' : 's'} en la lista de jugadores` : 'Todavía sin lista de jugadores')
            : [pa.CantidadTotal ? `${pa.CantidadTotal} en total` : null, pa.PorPrenda ? `${pa.PorPrenda} por prenda` : null, pa.Ubicacion].filter(Boolean).join(' · ');
        return {
            key: pa.ParteID,
            resaltada: !!pa.Modificada,
            estado: (
                <>
                    <PastillaEstado txt={est.txt} cls={est.cls} />
                    {pa.Modificada ? <div className="mt-1"><PastillaEstado txt="Modificada · falta aceptar" cls="bg-fuchsia-100 text-fuchsia-700" title={pa.ModificadaDetalle || ''} /></div> : null}
                    {pa.TizadaEnCurso ? <div className="mt-1"><PastillaEstado txt="En TIZADA PRO" cls="bg-sky-50 text-sky-700" title={`${pa.TizadaEnCurso.Referencia} · ${pa.TizadaEnCurso.Etapa || pa.TizadaEnCurso.Estado}`} /></div> : null}
                </>
            ),
            cliente: (
                <>
                    <div className="font-bold text-slate-800">{pa.ClienteNombre}</div>
                    <div className="text-slate-500">#{pa.SolicitudID} · {pa.NombreTrabajo}</div>
                    {/* [20/10] del portal: lo pidió el cliente; el "vendedor" es la asesora de su ficha de cliente */}
                    <div className="text-xs text-slate-400">{pa.Origen === 'PORTAL' ? <><span className="font-bold text-brand-cyan">Pedido desde el portal</span> · asesora {pa.VendedorNombre || '—'}</> : <>vendedor {pa.VendedorNombre || '—'}</>}</div>
                </>
            ),
            hacer: (
                <>
                    <div className="font-semibold text-slate-800">{NOMBRE_PARTE[pa.Tipo]}</div>
                    <div className="text-slate-500">{pa.TizadaEnCurso ? 'TIZADA PRO está armando la tizada: vuelve sola como diseño pronto' : (TIPO_TRABAJO[pa.TipoTrabajo] || '—')}</div>
                    {detalle ? <div className="text-xs text-slate-400">{detalle}</div> : null}
                    {pa.Observaciones ? <div className="text-xs text-slate-400 truncate" title={pa.Observaciones}>{pa.Observaciones}</div> : null}
                </>
            ),
            producto: (
                <>
                    <div className="text-slate-700">{pa.TipoFabricacion === 'PRODUCTO_TERMINADO' ? pa.ProductoNombre : 'Personalizado'}</div>
                    <div className="text-xs text-slate-400">{pa.CantidadPrendas} prendas{noCoincide ? <span className="font-bold text-amber-700"> · la lista suma {pa.ListaPrendas}</span> : null}</div>
                </>
            ),
            fecha: fmtFechaHora(mias ? pa.FechaInicioDiseno : pa.FechaEnvioDiseno),
            accion: accion(pa),
        };
    });
    return <Seccion cantidad={rows.length} vacio={vacio} fecha={mias ? 'Tomado' : 'Enviado'} grupos={[{ filas }]} />;
}

// ── [DEL PORTAL 20/10] Lo de la tienda del portal que todavía no es pedido ──
// En qué está cada uno (lo decide el servidor: portalDiseno) y qué se puede hacer: ver la solicitud, reenviar a TIZADA (si
// la rechazó) y cancelar con motivo (el cliente lo ve en su portal). Primero lo que necesita una persona.
const SITUACION_PORTAL = {
    TIZADA_RECHAZO: { txt: 'TIZADA lo rechazó', cls: 'bg-rose-50 text-rose-700', hacer: 'Corregir lo que dice TIZADA y reenviar, o cancelar' },
    ERROR_CONVERSION: { txt: 'No se pudo armar el pedido', cls: 'bg-rose-50 text-rose-700', hacer: 'Mirar el error y convertir desde la solicitud, o cancelar' },
    EN_DISENO: { txt: 'En Diseño', cls: 'bg-sky-50 text-sky-700', hacer: 'Lo tiene Diseño (Para tomar o Mis trabajos)' },
    EN_TIZADA: { txt: 'En TIZADA PRO', cls: 'bg-sky-50 text-sky-700', hacer: 'TIZADA está armando la tizada: vuelve sola' },
    POR_CONVERTIR: { txt: 'Diseñado · se arma solo', cls: 'bg-emerald-50 text-emerald-700', hacer: 'El pedido se arma solo en unos minutos' },
    ARMANDO: { txt: 'El cliente lo está armando', cls: 'bg-amber-50 text-amber-700', hacer: 'Todavía no lo confirmó' },
};
function DelPortal({ rows, vacio, busy, abriendo, onVerSolicitud, onReenviar, onCancelar }) {
    const fila = (x) => {
        const si = SITUACION_PORTAL[x.Situacion] || { txt: x.Situacion, cls: 'bg-slate-100 text-slate-600', hacer: '' };
        return {
            key: x.ProductoSolID,
            estado: <PastillaEstado txt={si.txt} cls={si.cls} />,
            cliente: (
                <>
                    <div className="font-bold text-slate-800">{x.ClienteNombre}</div>
                    <div className="text-slate-500">#{x.SolicitudID} · {x.NombreTrabajo}</div>
                    <div className="text-xs text-slate-400">asesora {x.VendedorNombre || '—'}{x.DisenadorNombre ? <> · lo tiene <b>{x.DisenadorNombre}</b></> : null}</div>
                </>
            ),
            hacer: (
                <>
                    <div className="text-slate-700">{si.hacer}</div>
                    {x.Detalle ? <div className="mt-0.5 flex items-start gap-1 text-xs text-rose-700"><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span className="line-clamp-3" title={x.Detalle}>{x.Detalle}</span></div> : null}
                </>
            ),
            producto: (
                <>
                    <div className="text-slate-700">{x.ProductoNombre}</div>
                    <div className="text-xs text-slate-400">{x.Cantidad} {Number(x.Cantidad) === 1 ? 'unidad' : 'unidades'}</div>
                </>
            ),
            fecha: fmtFechaHora(x.PortalConfirmado || x.FechaSolicitud),
            accion: (
                <span className="flex flex-wrap justify-end gap-1">
                    <button disabled={abriendo === x.SolicitudID} onClick={() => onVerSolicitud(x.SolicitudID)} className={BTN_SECUNDARIO} title="La ficha de la solicitud en PDF">{abriendo === x.SolicitudID ? <Loader2 size={12} className="animate-spin" /> : null} Ver solicitud</button>
                    {x.Situacion === 'TIZADA_RECHAZO' && <button disabled={busy} onClick={() => onReenviar(x)} className={BTN_PRINCIPAL}><Send size={12} /> Reenviar a TIZADA</button>}
                    <button disabled={busy} onClick={() => onCancelar(x)} className="px-3 py-1.5 rounded-lg border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50"><Ban size={12} /> Cancelar</button>
                </span>
            ),
        };
    };
    const atencion = rows.filter(x => ['TIZADA_RECHAZO', 'ERROR_CONVERSION'].includes(x.Situacion));
    const enCurso = rows.filter(x => ['EN_DISENO', 'EN_TIZADA', 'POR_CONVERTIR'].includes(x.Situacion));
    const armando = rows.filter(x => x.Situacion === 'ARMANDO');
    const grupos = [['Necesitan una persona', AlertTriangle, atencion], ['En curso', Clock, enCurso], ['El cliente lo está armando', Globe, armando]]
        .filter(([, , l]) => l.length).map(([titulo, Icono, l]) => ({ titulo, Icono, filas: l.map(fila) }));
    return <Seccion cantidad={rows.length} vacio={vacio} fecha="Confirmado" grupos={grupos} tituloHacer="Qué pasa"
        ayuda="Lo que los clientes pidieron desde la tienda del portal y todavía no es pedido de producción. Al cancelar, el cliente ve en su portal que se canceló y el motivo." />;
}

// Cancelar un pedido del portal: el motivo es obligatorio y lo ve el cliente
function CancelarPortal({ x, busy, onClose, onConfirmar }) {
    const [motivo, setMotivo] = useState('');
    const ok = motivo.trim().length >= 5;
    return (
        <Ventana chica Icono={Ban} titulo={`Cancelar el pedido #${x.SolicitudID}`} onClose={onClose}
            pie={<>
                <button type="button" onClick={onClose} className={BTN_SECUNDARIO}>Volver</button>
                <button type="button" disabled={!ok || busy} onClick={() => onConfirmar(motivo.trim())}
                    className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Ban size={12} />} Cancelar el pedido
                </button>
            </>}>
            <p className="text-sm text-slate-600">{x.ClienteNombre} · {x.ProductoNombre}. <b>El cliente ve en su portal que se canceló y el motivo</b>, así que escribilo para él.</p>
            <label className="mt-3 block text-xs font-bold text-slate-600">Motivo
                <textarea data-autofocus rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} maxLength={500}
                    placeholder="Ej.: el arte no tiene la medida del banderín. Bajá la plantilla de la tienda, armalo encima y volvé a pedirlo."
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15" />
            </label>
        </Ventana>
    );
}

// ── [BUSCAR 20/10] Resultados del buscador en todo Diseño ──
// Dónde está cada servicio (en el orden de las pestañas) y qué se puede hacer desde acá.
function dondeEsta(x) {
    if (x.SolEstado === 'CANCELADA') return { txt: 'Solicitud cancelada', cls: 'bg-slate-100 text-slate-500' };
    if (x.PedidoNoDocERP) return { txt: `Ya es pedido ${x.PedidoNoDocERP}`, cls: 'bg-emerald-50 text-emerald-700' };
    if (x.Estado === 'INGRESADO') return x.Origen === 'PORTAL' && !x.PortalConfirmado
        ? { txt: 'Del portal · el cliente lo está armando', cls: 'bg-amber-50 text-amber-700' }
        : { txt: 'Todavía con el vendedor', cls: 'bg-slate-100 text-slate-600' };
    if (x.Estado === 'ENVIADO_DISENO') return { txt: 'Para tomar', cls: 'bg-sky-50 text-sky-700' };
    if (x.Estado === 'DISENADO') return { txt: `Hecho${x.DisenadorNombre ? ` por ${x.DisenadorNombre}` : ''}`, cls: 'bg-emerald-50 text-emerald-700' };
    return x.EsMia ? { txt: 'Mis trabajos', cls: 'bg-indigo-50 text-indigo-700' } : { txt: `Lo tiene ${x.DisenadorNombre || 'otro diseñador'}`, cls: 'bg-violet-50 text-violet-700' };
}
function ResultadosBusqueda({ q, rows, buscando, produccion, busy, abriendo, onVerSolicitud, onTomar, onAbrir, onAbrirOrden }) {
    if (rows === null || (buscando && !rows.length)) return <div className="flex justify-center py-10"><Loader2 className="animate-spin text-brand-cyan" /></div>;
    const filas = (rows || []).map(x => {
        const d = dondeEsta(x);
        const puedeTomar = x.Estado === 'ENVIADO_DISENO' && x.SolEstado !== 'CANCELADA' && !x.PedidoNoDocERP;
        const puedeAbrir = x.EsMia && ['DISENO_INICIADO', 'DISENADO'].includes(x.Estado) && x.SolEstado !== 'CANCELADA';
        return {
            key: x.ParteID,
            estado: <PastillaEstado txt={d.txt} cls={d.cls} />,
            cliente: (
                <>
                    <div className="font-bold text-slate-800">{x.ClienteNombre}</div>
                    <div className="text-slate-500">#{x.SolicitudID} · {x.NombreTrabajo}</div>
                    <div className="text-xs text-slate-400">{x.Origen === 'PORTAL' ? <><span className="font-bold text-brand-cyan">Pedido desde el portal</span> · asesora {x.VendedorNombre || '—'}</> : <>vendedor {x.VendedorNombre || '—'}</>}</div>
                </>
            ),
            hacer: <div className="font-semibold text-slate-800">{NOMBRE_PARTE[x.Tipo] || x.Tipo}</div>,
            producto: (
                <>
                    <div className="text-slate-700">{x.ProductoNombre || 'Personalizado'}</div>
                    <div className="text-xs text-slate-400">{x.CantidadPrendas} prendas</div>
                </>
            ),
            fecha: fmtFechaHora(x.FechaDisenado || x.FechaEnvioDiseno),
            accion: (
                <span className="flex flex-wrap justify-end gap-1">
                    <button disabled={abriendo === x.SolicitudID} onClick={() => onVerSolicitud(x.SolicitudID)} className={BTN_SECUNDARIO}>{abriendo === x.SolicitudID ? <Loader2 size={12} className="animate-spin" /> : null} Ver solicitud</button>
                    {puedeTomar && <button disabled={busy} onClick={() => onTomar(x)} className={BTN_PRINCIPAL}>Tomar este trabajo</button>}
                    {puedeAbrir && <button onClick={() => onAbrir(x)} className={BTN_PRINCIPAL}>Abrir</button>}
                </span>
            ),
        };
    });
    return (
        <div className="space-y-3">
            <p className="text-xs text-slate-500">Buscando «{q}» en todo Diseño: todos los diseñadores, lo del portal, lo ya pedido y lo cancelado.{buscando ? ' Actualizando…' : ''} Borrá la búsqueda para volver a la pestaña.</p>
            <Seccion cantidad={filas.length} vacio={`Ninguna solicitud coincide con «${q}».`} fecha="Fecha" grupos={[{ filas }]} tituloHacer="Servicio" />
            {produccion.length > 0 && (
                <>
                    <h3 className={`${ROTULO} -mb-2`}>Órdenes en producción que esperan diseño</h3>
                    <EnProduccion rows={produccion} vacio="" onVerSolicitud={onVerSolicitud} onAbrir={onAbrirOrden} />
                </>
            )}
        </div>
    );
}

// ── [HECHOS 15/10] Lo que Diseño ya terminó ──
// Período: por defecto HOY. Las fechas van como las del día de la computadora (AAAA-MM-DD), los dos extremos incluidos.
// (el texto dice qué filtra: con solo "Hoy" no se entendía que era la fecha en que se diseñó)
const PERIODOS = [['hoy', 'Diseñados hoy'], ['ayer', 'Diseñados ayer'], ['7', 'Diseñados en los últimos 7 días'], ['30', 'Diseñados en los últimos 30 días'], ['90', 'Diseñados en los últimos 90 días'], ['rango', 'Diseñados entre fechas…']];
const isoLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function rangoDe({ clave, desde, hasta }) {
    const hoy = new Date();
    const atras = (n) => { const d = new Date(hoy); d.setDate(d.getDate() - n); return isoLocal(d); };
    if (clave === 'ayer') return { desde: atras(1), hasta: atras(1) };
    if (['7', '30', '90'].includes(clave)) return { desde: atras(Number(clave) - 1), hasta: isoLocal(hoy) };
    if (clave === 'rango' && desde) return { desde, hasta: hasta || isoLocal(hoy) };
    return { desde: isoLocal(hoy), hasta: isoLocal(hoy) };
}
// Quién lo hizo (el servidor lo decide: disenosHechos) y en qué anda el pedido
const QUIEN = { DISENADOR: 'Un diseñador', TIZADA: 'TIZADA PRO (automático)', VENDEDOR: 'El vendedor (arte listo del cliente)' };
const ESTADO_PEDIDO_HECHO = {
    SIN_PEDIDO: { txt: 'Diseñado · todavía sin pedido', cls: 'bg-slate-100 text-slate-600' },
    EN_PRODUCCION: { txt: 'Pedido en producción', cls: 'bg-sky-50 text-sky-700' },
    TERMINADO: { txt: 'Pedido terminado', cls: 'bg-emerald-50 text-emerald-700' },
};
const estadoPedidoDe = (x) => (!x.Pedido ? 'SIN_PEDIDO' : x.Pedido.Ordenes > 0 && x.Pedido.Terminadas >= x.Pedido.Ordenes ? 'TERMINADO' : 'EN_PRODUCCION');

function FiltrosHechos({ periodo, onPeriodo, fh, onFh }) {
    return (
        <>
            <Selector filtro value={periodo.clave} onChange={e => onPeriodo({ ...periodo, clave: e.target.value })} aria-label="Período: cuándo se diseñó" anchoLista={280}>
                {PERIODOS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </Selector>
            {periodo.clave === 'rango' && (
                <>
                    <SelectorFecha filtro vaciable placeholder="Desde" aria-label="Desde" value={periodo.desde} max={periodo.hasta || undefined} onChange={e => onPeriodo({ ...periodo, desde: e.target.value })} />
                    <SelectorFecha filtro vaciable placeholder="Hasta" aria-label="Hasta" value={periodo.hasta} min={periodo.desde || undefined} onChange={e => onPeriodo({ ...periodo, hasta: e.target.value })} />
                </>
            )}
            <Selector filtro value={fh.quien} onChange={e => onFh({ quien: e.target.value })} aria-label="Quién lo hizo" anchoLista={280}>
                <option value="">Lo hizo cualquiera</option>
                {Object.entries(QUIEN).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </Selector>
            <Selector filtro value={fh.pedido} onChange={e => onFh({ pedido: e.target.value })} aria-label="Pedido" anchoLista={260}>
                <option value="">Con o sin pedido</option>
                {Object.entries(ESTADO_PEDIDO_HECHO).map(([k, v]) => <option key={k} value={k}>{v.txt}</option>)}
            </Selector>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600">
                <input type="checkbox" checked={fh.mios} onChange={e => onFh({ mios: e.target.checked })} className="h-4 w-4 accent-brand-cyan" /> Solo los míos
            </label>
        </>
    );
}

function ListaHechos({ rows, vacio, abriendo, onVerSolicitud, onAbrir }) {
    const filas = rows.map(x => {
        const ep = ESTADO_PEDIDO_HECHO[estadoPedidoDe(x)];
        const quien = x.Quien === 'DISENADOR' ? `Lo diseñó ${x.DisenadorNombre}${x.Automatico ? ' · tizada de TIZADA PRO' : ''}`
            : x.Quien === 'TIZADA' ? `TIZADA PRO, automático${x.Automatico?.detalle ? ` (${x.Automatico.detalle})` : ''}${x.HizoNombre ? ` · lo mandó ${x.HizoNombre}` : ''}`
                : `Arte listo del cliente · lo subió ${x.HizoNombre || 'el vendedor'}`;
        return {
            key: x.ParteID,
            estado: (
                <>
                    <PastillaEstado txt={ep.txt} cls={ep.cls} />
                    {x.EsMia ? <div className="mt-1"><PastillaEstado txt="Tuyo" cls="bg-cyan-50 text-brand-cyan" /></div> : null}
                </>
            ),
            cliente: (
                <>
                    <div className="font-bold text-slate-800">{x.ClienteNombre}</div>
                    <div className="text-slate-500">#{x.SolicitudID} · {x.NombreTrabajo}</div>
                    <div className="text-xs text-slate-400">vendedor {x.VendedorNombre || '—'}</div>
                </>
            ),
            hacer: (
                <>
                    <div className="font-semibold text-slate-800">{NOMBRE_PARTE[x.Tipo]}</div>
                    <div className="text-slate-500">{quien}</div>
                </>
            ),
            producto: (
                <>
                    <div className="text-slate-700">{x.TipoFabricacion === 'PRODUCTO_TERMINADO' ? x.ProductoNombre : 'Personalizado'}</div>
                    <div className="text-xs text-slate-400">{x.CantidadPrendas} prendas</div>
                    {x.Pedido ? <div className="text-xs text-slate-400">pedido <b className="text-slate-600">{x.Pedido.NoDocERP}</b> · {x.Pedido.Terminadas} de {x.Pedido.Ordenes} órdenes terminadas</div> : null}
                </>
            ),
            fecha: fmtFechaHora(x.FechaDisenado),
            accion: (
                <span className="flex flex-wrap justify-end gap-1">
                    <button disabled={abriendo === x.SolicitudID} onClick={() => onVerSolicitud(x.SolicitudID)} className={BTN_SECUNDARIO} title="La ficha de la solicitud en PDF">{abriendo === x.SolicitudID ? <Loader2 size={12} className="animate-spin" /> : null} Ver solicitud</button>
                    <button onClick={() => onAbrir(x)} className={BTN_SECUNDARIO} title="La pantalla de Diseño de la solicitud (ver o rehacer)">Abrir</button>
                </span>
            ),
        };
    });
    return <Seccion cantidad={rows.length} vacio={vacio} fecha="Diseñado" tituloHacer="Servicio y quién lo hizo" grupos={[{ filas }]} />;
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
                            {n == null ? null : <span className={`rounded-full px-1.5 text-[11px] font-black ${on ? 'bg-brand-cyan/10 text-brand-cyan' : n ? 'bg-slate-200 text-slate-600' : 'bg-slate-100 text-slate-400'}`}>{n}</span>}
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
