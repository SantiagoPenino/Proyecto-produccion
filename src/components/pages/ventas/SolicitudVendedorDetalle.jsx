import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Ban, CalendarClock, CheckCircle2, ClipboardList, Factory, FileText, History, Loader2, MessageSquare, Paperclip, Pencil, Printer, RefreshCw, RotateCcw, Send, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { fileService } from '../../../client-portal/api/fileService';
import api from '../../../services/apiClient';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFecha, fmtFechaHora } from '../../../utils/fechas';
import { RESPUESTA_MUESTRA } from './checklistSolicitud';
import OrderDetailModal from '../../production/components/OrderDetailModal';
import {
    BTN_PELIGRO, BTN_PRIMARIO, BTN_SECUNDARIO, Campo, ESTADO_PARTE, ESTADO_SOLICITUD, INPUT, Info, MONEDA, MotivoModal,
    NOMBRE_PARTE, ROL_ARCHIVO, Checklist, SEL_CAMPO, TIPO_TRABAJO, VisorPdf, claseSel, errorDe, plata, useConfirmar,
} from './solicitudesComunes';
import Selector from '../../ui/Selector';
import EstadoProduccionPanel from './EstadoProduccionPanel';
import TizadaProBloque from './TizadaProBloque';
// La grilla con el panel "Estado para producción" al costado era lo último de fichaPedido.css (fp-det-grid /
// fp-det-aside); pasó a Tailwind y la hoja de estilos se borró (06/10).

// Tema claro (06/10): las zonas, sus títulos y los subtítulos con el estilo del resto del sistema. Antes eran clases
// de fichaPedido.css (fp-zona, fp-zona-tit, fp-subtit), con el amarillo y la Barlow del tema oscuro.
const ZONA = 'rounded-xl border border-slate-200 bg-white p-4';
const TIT_ZONA = 'mb-3 text-sm font-black text-slate-800 [&_small]:ml-2 [&_small]:text-xs [&_small]:font-medium [&_small]:text-slate-400';
const SUBTIT = 'mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400 [&_small]:ml-1.5 [&_small]:text-[11px] [&_small]:font-medium [&_small]:normal-case [&_small]:tracking-normal';
// Mayúscula inicial en cada palabra ("admin" → "Admin"), como el vendedor en la lista de solicitudes
const capitalizar = (v) => String(v || '').trim().toLowerCase().replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1));

// Estados escritos normal, sin mayúsculas, con su color (06/10), como en la lista de solicitudes y la Bandeja. Antes
// eran las pastillas en mayúsculas de solicitudesComunes (Pill y PillModificada, que quedaron sin uso) y el sello torcido
// de la maqueta. Pastilla la usa también la pantalla de Diseño.
const PASTILLA = 'inline-block whitespace-nowrap rounded-xl px-2 py-0.5 text-xs font-semibold leading-snug';
export const Pastilla = ({ e, mapa }) => {
    const st = mapa[e] || { txt: e, cls: 'bg-slate-100 text-slate-600' };
    return <span className={`${PASTILLA} ${st.cls}`}>{st.txt}</span>;
};
const PastillaModificada = ({ titulo }) => <span title={titulo || ''} className={`${PASTILLA} bg-fuchsia-50 text-fuchsia-700`}>Modificada · falta aceptar</span>;
// Lo que antes era el sello ("LISTO PARA INGRESAR" / "FALTA INFO"), como en la lista de solicitudes
const PastillaIngreso = ({ listo, faltan }) => (listo
    ? <span className={`${PASTILLA} bg-emerald-50 text-emerald-700`}>Lista para ingresar</span>
    : <span className={`${PASTILLA} bg-rose-50 text-rose-700`}>{faltan > 0 ? `Falta${faltan === 1 ? '' : 'n'} ${faltan} cosa${faltan === 1 ? '' : 's'}` : 'Falta info'}</span>);

/**
 * Spec 41 — Detalle de una Solicitud: desde acá el vendedor adjunta archivos, libera a Diseño
 * por partes, pacta precio y seña, registra interacciones y cancela; el diseñador sube el
 * diseño pronto y acepta los cambios. Todo queda en el historial (no se edita ni se borra).
 */
const ROLES_PARTE = ['ARTE_CLIENTE', 'REFERENCIA', 'BOCETO'];
// F1: nombre de la producción principal según el área del producto (ProductoVentaConfig.TecnicaPrincipal)
const NOMBRE_PRINCIPAL = { SB: 'sublimación', DIRECTA: 'impresión directa', ECOUV: 'gran formato', DF: 'DTF' };
const nombrePrincipal = (p) => NOMBRE_PRINCIPAL[p?.Config?.TecnicaPrincipal] || 'sublimación';
const normTxt = (v) => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
// La tizada NO va acá: es el archivo de impresión de la sublimación → se sube como diseño pronto de la producción principal.
const ROLES_PRODUCTO = ['PLANILLA', 'REFERENCIA'];

// Llevan medida la producción principal (sublimación) y el DTF. Bordado y TPU NO: su archivo se sube tal cual.
// Mismas reglas que el ingreso de pedidos de prenda (RN-SOL.14). El ancho se controla en el servidor:
// el DTF contra el film que cargó el vendedor (al subir) y la sublimación contra la tela de cada archivo (al convertir).
export async function medirDisenoPronto(file, tipo) {
    if (tipo !== 'PRINCIPAL' && tipo !== 'DTF') return {};
    const m = await fileService.uploadFile(file, { allowJpeg: tipo === 'PRINCIPAL' });
    try { if (m.preview) URL.revokeObjectURL(m.preview); } catch (_) { /* nada */ }
    if (m.hasDPI === false) throw new Error(`No pudimos medir "${file.name}": el archivo no trae DPI. Exportalo con resolución (DPI) y volvé a subirlo.`);
    if (m.measurementError || !m.width || !m.height) throw new Error(`No pudimos medir "${file.name}": ${m.measurementError || 'sin dimensiones'}.`);
    if (m.pageCount > 1) throw new Error(`"${file.name}" tiene ${m.pageCount} páginas. Solo se permite 1 página por archivo.`);
    return { AnchoM: m.width, AltoM: m.height };
}

const ESTADO_PEDIDO = {
    PROCESANDO: 'Creando el pedido…',
    PASANDO_ARCHIVOS: 'Pedido creado · pasando los archivos a producción',
    CREADO: 'Pedido creado · todos los archivos están en producción',
    ERROR_ARCHIVOS: 'Pedido creado · hay archivos que NO pasaron a producción',
    RECHAZADO: 'El pedido NO se creó: la validación encontró problemas',
    ERROR: 'El pedido NO se creó: hubo un error',
};

export default function SolicitudVendedorDetalle() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { user } = useAuth() || {};
    const [s, setS] = useState(null);
    const [perfil, setPerfil] = useState({ esVendedor: false, esDisenador: false, esAdmin: false });
    const [busy, setBusy] = useState(false);
    const [subida, setSubida] = useState(null);           // { nombre, pct }
    const [cancelando, setCancelando] = useState(false);
    const [tab, setTab] = useState(null);                 // 'resumen' | 'prod-<id>' | 'precio' | 'interacciones' | 'historial'
    const [telas, setTelas] = useState([]);               // telas de sublimación (las elige el diseñador por archivo)
    const [ficha, setFicha] = useState(null);             // orden de producción abierta en su ficha (la misma del ojito)
    const [generandoFicha, setGenerandoFicha] = useState(false);
    const [pdf, setPdf] = useState(null);                 // ficha del pedido generada (Blob) → visor
    // Ficha del pedido (PDF armado en el servidor, tarda unos segundos). Se muestra en un visor acá
    // mismo: abrir una pestaña emergente después de esperar lo bloquea el navegador.
    const abrirFicha = async () => {
        setGenerandoFicha(true);
        try {
            const blob = await svc.fichaPdf(id);
            setPdf(new Blob([blob], { type: 'application/pdf' }));
        } catch (e) {
            let msg = errorDe(e);
            try { if (e?.response?.data instanceof Blob) msg = JSON.parse(await e.response.data.text()).error || msg; } catch (_) { /* sin detalle */ }
            toast.error(`No se pudo generar la ficha: ${msg}`);
        } finally { setGenerandoFicha(false); }
    };

    const cargar = useCallback(async () => {
        try { setS(await svc.obtener(id)); }
        catch (e) { toast.error(errorDe(e)); navigate(-1); }
    }, [id, navigate]);
    useEffect(() => {
        cargar();
        svc.miPerfil().then(setPerfil).catch(() => { });
        svc.materialesPrincipal().then(setTelas).catch(() => setTelas([]));
    }, [cargar]);

    // Mientras un pedido está pasando sus archivos a producción, se refresca solo.
    const pasando = !!s?.Conversion?.some(c => ['PROCESANDO', 'PASANDO_ARCHIVOS'].includes(c.pedido?.estado) && !c.pedido?.archivosColgados);
    useEffect(() => {
        if (!pasando) return undefined;
        const t = setInterval(cargar, 5000);
        return () => clearInterval(t);
    }, [pasando, cargar]);

    const hacer = async (fn, okMsg) => {
        setBusy(true);
        try { await fn(); if (okMsg) toast.success(okMsg); await cargar(); return true; }
        catch (e) { toast.error(errorDe(e)); return false; }
        finally { setBusy(false); }
    };

    const subir = async (files, campos, tipoParte) => {
        const lista = Array.from(files || []);
        if (!lista.length) return;
        setBusy(true);
        try {
            for (const f of lista) {
                const medida = campos.Rol === 'DISENO_PRONTO' && !campos.TizadaID ? await medirDisenoPronto(f, tipoParte) : {};
                setSubida({ nombre: f.name, pct: 0 });
                await svc.subirArchivo(id, f, { ...campos, ...medida }, (loaded, total) => setSubida({ nombre: f.name, pct: total ? Math.round((loaded / total) * 100) : 0 }));
            }
            toast.success(lista.length === 1 ? 'Archivo guardado.' : `${lista.length} archivos guardados.`);
        } catch (e) { toast.error(errorDe(e)); }
        finally { setSubida(null); setBusy(false); await cargar(); }
    };

    if (!s) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-brand-cyan" /></div>;

    const abierta = s.Estado === 'INGRESADA' || s.Estado === 'EN_DISENO';
    const puedeVender = perfil.esVendedor && abierta;
    const archivosDe = (filtro) => s.Archivos.filter(a => a.Vigente && filtro(a));
    const partes = s.Productos.flatMap(p => p.Partes);
    const disenadas = partes.filter(pa => pa.Estado === 'DISENADO').length;
    const interacciones = s.Eventos.filter(e => e.Tipo === 'INTERACCION').length;
    const tabActual = tab || (s.Productos[0] ? `prod-${s.Productos[0].ProductoSolID}` : 'resumen');
    const TABS = [
        { k: 'resumen', t: 'Resumen' },
        ...s.Productos.map((p, i) => ({ k: `prod-${p.ProductoSolID}`, t: `Producto ${i + 1} · ${p.Cantidad} prendas${p.PedidoNoDocERP ? ` · Pedido ${p.PedidoNoDocERP}` : ''}`, ok: !!p.PedidoNoDocERP })),
        { k: 'precio', t: 'Precio y seña' },
        { k: 'interacciones', t: 'Interacciones', n: interacciones },
        { k: 'historial', t: 'Historial', n: s.Eventos.length },
    ];

    // Tema claro, como la lista de solicitudes y la Bandeja de Diseño (06/10), y a todo el ancho como ellas (antes
    // max-w-7xl centrado). Antes iba dentro de .fp-oscuro, el tema oscuro de Solicitudes (fichaPedido.css).
    return (
        <>
        <div className="p-3 md:p-6 space-y-4">
            {/* Encabezado como el de las otras pantallas: ícono de Lucide en brand-cyan y sin fondo, título grande */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    <ClipboardList size={30} className="mt-1 shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><Pastilla e={s.Estado} mapa={ESTADO_SOLICITUD} />
                            {abierta && s.Conversion.some(c => c.checklist) && <PastillaIngreso listo={s.Conversion.every(c => !c.checklist || c.checklist.listo)} faltan={s.Conversion.reduce((n, c) => n + (c.checklist?.faltan?.length || 0), 0)} />}
                            <span className="text-xs text-slate-400">Solicitud #{s.SolicitudID} · {fmtFechaHora(s.FechaSolicitud)}</span></div>
                        <h1 className="mt-1 text-2xl font-black leading-tight text-slate-800">{s.NombreTrabajo}</h1>
                        <p className="text-sm text-slate-500">{s.ClienteNombre}{s.ClienteCodigo ? <span className="text-xs text-slate-400"> · {s.ClienteCodigo}</span> : null} · vendedor <b className="text-slate-700">{capitalizar(s.VendedorNombre) || '—'}</b></p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => navigate(perfil.esVendedor ? '/ventas/solicitudes' : '/ventas/bandeja-diseno')} className={BTN_SECUNDARIO}><ArrowLeft size={14} /> Volver</button>
                    <button onClick={cargar} className={BTN_SECUNDARIO} title="Actualizar"><RefreshCw size={14} /></button>
                    {perfil.esDisenador && <button onClick={() => navigate(`/ventas/solicitudes/${id}/diseno`)} className={BTN_SECUNDARIO} title="Tizada, PDF por hoja, diseño pronto: el trabajo de Diseño sobre esta solicitud"><Upload size={14} /> Trabajar el diseño</button>}
                    <button onClick={abrirFicha} disabled={generandoFicha} className={BTN_PRIMARIO} title="Todo lo de la solicitud y de Diseño en un solo PDF, con los archivos en miniatura. Es la misma ficha que se adjunta al pedido al convertir.">{generandoFicha ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Ficha del pedido (PDF)</button>
                    {puedeVender && <button onClick={() => navigate(`/ventas/solicitudes/${id}/editar`)} className={BTN_SECUNDARIO}><Pencil size={14} /> Editar solicitud</button>}
                    {puedeVender && <button onClick={() => setCancelando(true)} className={BTN_PELIGRO}><Ban size={14} /> Cancelar solicitud</button>}
                </div>
            </div>

            {s.Estado === 'CANCELADA' && (
                <div className="bg-slate-100 border border-slate-300 rounded-xl p-3 text-sm text-slate-700">
                    <b>Solicitud cancelada</b> por {s.CanceladaPorNombre || '—'} el {fmtFechaHora(s.FechaCancelacion)}. Motivo: {s.MotivoCancelacion}
                    {s.SenaConfirmada ? <div className="text-rose-700 font-bold mt-1">Tenía una seña registrada de {plata(s.SenaMonto, s.MonIdMoneda)}: Administración decide qué se hace con ese dinero.</div> : null}
                </div>
            )}

            {subida && (
                <div className="sticky top-2 z-20 bg-white border border-brand-cyan/30 rounded-xl p-3 shadow">
                    <div className="text-xs font-bold text-slate-700 flex items-center gap-2"><Loader2 size={12} className="animate-spin text-brand-cyan" /> Subiendo "{subida.nombre}"… {subida.pct}%</div>
                    <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-brand-cyan transition-all" style={{ width: `${subida.pct}%` }} /></div>
                </div>
            )}

            {/* Lo importante de un vistazo */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                <Dato l="Cómo se cobra" v={!s.ModoCobro ? <span className="text-rose-600">Sin pactar</span> : s.ModoCobro === 'POR_AREA' ? 'Por cada área' : 'Precio establecido'} />
                <Dato l="Precio de la solicitud" v={s.ModoCobro === 'PRECIO_ESTABLECIDO' ? plata(s.PrecioPactado, s.MonIdMoneda) : '—'} />
                <Dato l="Entrega que necesita el cliente" v={s.FechaEntrega ? `${fmtFecha(s.FechaEntrega)}${s.FechaEntregaHasta ? ` → ${fmtFecha(s.FechaEntregaHasta)}` : ''}` : <span className="text-rose-600">Sin fecha</span>} />
                <Dato l="Seña" v={!s.RequiereSena ? 'No requiere' : s.SenaConfirmada ? <span className="text-emerald-700">{plata(s.SenaMonto, s.MonIdMoneda)} confirmada</span> : <span className="text-rose-600">{plata(s.SenaMontoRequerido, s.MonIdMoneda)} sin confirmar</span>} />
                {s.Productos.some(p => p.PedidoNoDocERP)
                    ? <Dato l="Pedido de producción creado" v={<span className="text-emerald-700">{s.Productos.filter(p => p.PedidoNoDocERP).map(p => p.PedidoNoDocERP).join(', ')}</span>} />
                    : <Dato l="Servicios diseñados" v={`${disenadas} de ${partes.length}`} />}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl">
                {/* Pestañas subrayadas en brand-cyan, con su contador, como en Configurar Productos (antes texto de 12 px) */}
                <div className="flex flex-wrap gap-1 border-b border-slate-200 px-2">
                    {TABS.map(t => {
                        const on = tabActual === t.k;
                        return (
                            <button key={t.k} type="button" onClick={() => setTab(t.k)} aria-current={on ? 'page' : undefined}
                                className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-bold transition-colors ${on ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>
                                {t.ok ? <CheckCircle2 size={13} className="text-emerald-600" /> : null}{t.t}
                                {t.n != null ? <span className={`rounded-full px-1.5 text-[11px] font-black ${on ? 'bg-brand-cyan/10 text-brand-cyan' : 'bg-slate-100 text-slate-500'}`}>{t.n}</span> : null}
                            </button>
                        );
                    })}
                </div>

                <div className="p-4">
                    {tabActual === 'resumen' && (
                        <div className="space-y-3 text-sm">
                            <Info l="Qué pide el cliente" v={<span className="whitespace-pre-line">{s.Detalle}</span>} />
                            {s.PreNumero && <Info l="Presupuesto del que salió" v={<><b className="font-mono">{s.PreNumero}</b>{s.Presupuesto ? ` · ${s.Presupuesto.Moneda} ${Number(s.Presupuesto.Total || 0).toLocaleString('es-UY', { minimumFractionDigits: 2 })} · ${s.Presupuesto.Estado} · emitido ${fmtFechaHora(s.Presupuesto.FechaEmision)}` : ''}</>} />}
                            {s.Observaciones && <Info l="Observaciones generales" v={<span className="whitespace-pre-line">{s.Observaciones}</span>} />}
                            <FichaIngreso s={s} />
                            {abierta && s.Productos.some(p => !p.PedidoNoDocERP) && <PanelPlazo s={s} id={id} />}
                            <div className="border-t border-slate-100 pt-3 space-y-2">
                                <div>
                                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Archivos generales de la solicitud (opcional)</div>
                                    <p className="text-[11px] text-slate-500 mt-0.5">
                                        Son archivos de TODA la solicitud, que <b>no pertenecen a ningún producto ni a ningún servicio</b>: el mensaje o el brief del cliente,
                                        un manual de marca, fotos de muestra. <b>Lo que es de un servicio no va acá</b>: el arte y los bocetos de cada servicio, la tizada y la
                                        planilla de talles se adjuntan en la pestaña del producto, en su fila.
                                    </p>
                                    <ul className="text-[11px] text-slate-500 mt-1 list-disc pl-4 space-y-0.5">
                                        <li><b>Referencia</b>: al convertir viaja al pedido como referencia de la producción principal (la ve Sublimación).</li>
                                        <li><b>Planilla de talles y nombres</b>: al convertir viaja a Corte (si el producto no lleva Corte, a Sublimación). Si la solicitud tiene varios productos, va en el pedido de cada uno.</li>
                                        <li><b>Arte del cliente</b>: queda solo en la solicitud, para que lo vea Diseño. <b>No viaja a producción.</b></li>
                                    </ul>
                                </div>
                                <ListaArchivos titulo="Adjuntos generales" archivos={archivosDe(a => !a.ProductoSolID && !a.ParteID && !a.EventoID)} puedeQuitar={puedeVender} onQuitar={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Archivo quitado.')} />
                                {!archivosDe(a => !a.ProductoSolID && !a.ParteID && !a.EventoID).length && <div className="text-xs text-slate-400">Todavía no hay archivos generales.</div>}
                                {puedeVender && <BotonSubir busy={busy} roles={['REFERENCIA', 'ARTE_CLIENTE', 'PLANILLA']} onFiles={(files, Rol) => subir(files, { Rol })} />}
                            </div>
                        </div>
                    )}

                    {s.Productos.map((p, i) => tabActual === `prod-${p.ProductoSolID}` && (
                        <ProductoTab key={p.ProductoSolID} s={s} p={p} n={i + 1} id={id} user={user} perfil={perfil} busy={busy} abierta={abierta} puedeVender={puedeVender}
                            telas={telas} archivosDe={archivosDe} hacer={hacer} subir={subir} onAbrirFicha={setFicha} />
                    ))}

                    {tabActual === 'precio' && <PrecioSena s={s} puede={puedeVender} busy={busy} hacer={hacer} />}
                    {tabActual === 'interacciones' && <Interacciones s={s} puede={abierta && (perfil.esVendedor || perfil.esDisenador)} busy={busy} hacer={hacer} subir={subir} />}
                    {tabActual === 'historial' && (
                        <div>
                            <h2 className="text-[10px] font-black uppercase tracking-wide text-slate-500 flex items-center gap-1 mb-2"><History size={12} /> Historial (no se edita ni se borra)</h2>
                            <ul className="space-y-2">
                                {s.Eventos.map(ev => (
                                    <li key={ev.EventoID} className="text-xs border-l-2 border-slate-200 pl-2">
                                        <div className="text-[10px] text-slate-400">{fmtFechaHora(ev.Fecha)} · <b className="text-slate-600">{ev.UsuarioNombre || `Usuario ${ev.UsuarioID}`}</b></div>
                                        <div className="text-slate-700 whitespace-pre-line">
                                            {ev.Tipo === 'ESTADO_SOLICITUD' ? `Solicitud: ${ESTADO_SOLICITUD[ev.EstadoAnterior]?.txt || ev.EstadoAnterior} → ${ESTADO_SOLICITUD[ev.EstadoNuevo]?.txt || ev.EstadoNuevo}` : ev.Tipo === 'INTERACCION' ? `Interacción: ${ev.Texto}` : ev.Texto}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>


            {cancelando && (
                <MotivoModal titulo={`Cancelar la solicitud #${s.SolicitudID}`} etiquetaBoton="Cancelar la solicitud" busy={busy}
                    descripcion={`La solicitud queda CANCELADA: no se puede reabrir ni convertir en pedido, y todo lo que esté en Diseño sale de la bandeja.${s.SenaConfirmada ? `\n\nATENCIÓN: tiene una seña registrada de ${plata(s.SenaMonto, s.MonIdMoneda)}. Cancelar NO devuelve ni mueve ese dinero: lo resuelve Administración.` : ''}`}
                    onClose={() => setCancelando(false)}
                    onConfirm={async (motivo) => { if (await hacer(() => svc.cancelar(id, motivo), 'Solicitud cancelada.')) setCancelando(false); }} />
            )}
        </div>
        {/* La MISMA ficha de la orden que se abre con el ojito en el área: ahí se sube la matriz / el boceto / el arte. */}
        <OrderDetailModal order={ficha} onClose={() => { setFicha(null); cargar(); }} onOrderUpdated={cargar} />
        <VisorPdf blob={pdf} nombre={`Ficha pedido SOL-${s.SolicitudID}.pdf`} onClose={() => setPdf(null)} />
        </>
    );
}

// Las tarjetas de arriba (cómo se cobra, precio, entrega, seña, servicios): blancas con borde sobre el fondo gris de la
// página (06/10; con el gris claro de antes no se distinguían del fondo)
const Dato = ({ l, v }) => (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2">
        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{l}</div>
        <div className="text-sm font-bold text-slate-800">{v}</div>
    </div>
);

// Una pestaña por producto: datos del producto + tabla de servicios (una fila por servicio) + conversión a pedido.
export function ProductoTab({ s, p, n, id, user, perfil, busy, abierta, puedeVender, telas, archivosDe, hacer, subir, onAbrirFicha }) {
    const conv = s.Conversion.find(c => c.ProductoSolID === p.ProductoSolID) || {};
    const faltantes = conv.faltantes || [];
    const delProducto = archivosDe(a => a.ProductoSolID === p.ProductoSolID && !a.ParteID);
    // Producto del catálogo con molde: la producción principal no sale a Diseño sin modelo + tela por pieza
    const [subl, setSubl] = useState({ aplica: false });
    const planillas = delProducto.filter(a => a.Rol === 'PLANILLA');
    const faltaSubl = subl.aplica && !p.Datos?.sublimacion?.completo
        ? (p.Datos?.sublimacion?.modeloClave ? 'Faltan telas en "Piezas y telas".' : 'Primero elegí el modelo y la tela de cada pieza en "Piezas y telas".')
        : (!planillas.length && !String(p.Datos?.notaTalles || '').trim() && !(p.Datos?.tizadaPro?.planilla?.length > 0) && p.Datos?.comoSeDefine !== 'MEDIDA' && p.Config?.Molde !== 'NO' ? 'Falta la planilla de talles y nombres (o la nota de talles).' : null);
    const principal = p.Partes.find(pa => pa.Tipo === 'PRINCIPAL');

    return (
        // Producto a la izquierda y "Estado para producción" a la derecha, pegado al bajar; hasta 1100 px, uno abajo del otro
        <div className="grid grid-cols-1 items-start gap-5 min-[1101px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-black text-slate-800">Producto {n}: {p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? (p.ProductoNombre || `Producto ${p.ProIdProducto}`) : 'Producto personalizado del cliente'} <span className="font-bold text-slate-500">· {p.Cantidad} prendas</span></h2>
                {p.PedidoNoDocERP ? <span className="text-[10px] font-black uppercase text-emerald-700">Pedido {p.PedidoNoDocERP} · {fmtFechaHora(p.FechaConversion)}</span> : null}
            </div>

            <section className={ZONA}>
            <div className={TIT_ZONA}>Solicitud del cliente <small>lo carga el vendedor</small></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Info l="Corte" v={p.Datos?.corte?.activo ? `${p.Datos.corte.tipoMolde} · ${p.Datos.corte.origenTela}` : 'No lleva'} />
                <Info l="Costura" v={p.Datos?.costura?.activo ? (p.Datos.costura.instrucciones || 'Sin instrucciones especiales') : 'No lleva'} />
                {p.TipoFabricacion === 'PRODUCTO_TERMINADO' && (p.Datos?.accesorios || []).length > 0 && (
                    <Info l="Accesorios de stock" v={(p.Datos.accesorios || []).filter(a => a.incluir !== false).map(a => `${(Number(a.cantidadPorUnidad) || 1) * (Number(p.Cantidad) || 0)}× ${a.nombre}${a.varianteNombre ? ` (${a.varianteNombre})` : ' (sin variante)'}${a.cobro === 'APARTE' ? ' · aparte' : ''}`).join(' · ') || 'Ninguno'} />
                )}
                {p.Observaciones && <Info l="Observaciones" v={<span className="whitespace-pre-line">{p.Observaciones}</span>} />}
                <DatosProducto d={p.Datos || {}} />
            </div>
            </section>

            {/* Todo lo que Diseño necesita de la producción principal va en UN contenedor:
                arte del cliente → piezas y telas → planilla de talles y nombres → Enviar a Diseño */}
            {principal && (
                <PrincipalBloque s={s} p={p} pa={principal} id={id} perfil={perfil} busy={busy} abierta={abierta} puedeVender={puedeVender}
                    arte={archivosDe(a => a.ParteID === principal.ParteID && a.Rol !== 'DISENO_PRONTO')} planillas={delProducto} faltaEnvio={faltaSubl}
                    artes={archivosDe(a => a.Rol === 'ARTE_CLIENTE' && (a.ProductoSolID === p.ProductoSolID || p.Partes.some(pa => pa.ParteID === a.ParteID)))}
                    onEstadoSubl={setSubl} hacer={hacer} subir={subir} />
            )}

            {p.Partes.some(pa => pa.Tipo !== 'PRINCIPAL') && (
                <TablaServicios vista="cliente" titulo="Bordado y otros servicios" partes={p.Partes.filter(pa => pa.Tipo !== 'PRINCIPAL')} s={s} p={p} id={id} user={user} perfil={perfil} busy={busy} abierta={abierta} telas={telas} archivosDe={archivosDe} hacer={hacer} subir={subir} onAbrirFicha={onAbrirFicha} />
            )}
            {!principal && p.TipoFabricacion === 'PRODUCTO_TERMINADO' && (
                <PiezasTelasBloque id={id} p={p} busy={busy} puede={puedeVender && !p.PedidoNoDocERP} hacer={hacer} artes={[]} onEstado={setSubl} />
            )}

        </div>
            <aside className="min-[1101px]:sticky min-[1101px]:top-4 min-[1101px]:max-h-[calc(100vh-2rem)] min-[1101px]:overflow-y-auto">
                <Conversion s={s} p={p} pedido={conv.pedido} faltantes={faltantes} avisos={conv.avisos || []} checklist={conv.checklist} puedeVender={perfil.esVendedor} busy={busy} hacer={hacer} id={id} />
            </aside>
        </div>
    );
}

const ETAPA_PRODUCCION = {
    FALTA_DISENO: { txt: 'Falta diseño', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    ESPERANDO_APROBACION: { txt: 'Esperando aprobación del cliente', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    RECHAZADO: { txt: 'Rechazado por el cliente', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    APROBADO_FALTA_ARTE: { txt: 'Aprobado · falta el arte', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

/* Producción principal (sublimación) en la pestaña del producto: UN contenedor con todo lo que
   Diseño necesita, en el orden en que el vendedor lo carga: arte del cliente → piezas y telas →
   planilla de talles y nombres → Enviar a Diseño (al final, y trabado hasta que esté todo). */
function PrincipalBloque({ p, pa, id, perfil, busy, abierta, puedeVender, arte, planillas, artes, faltaEnvio, onEstadoSubl, hacer, subir }) {
    const [tipoTrabajo, setTipoTrabajo] = useState(pa.ArteOrigen === 'CLIENTE' ? 'REVISAR' : 'DESDE_CERO');
    const bloqueada = !abierta || !!p.PedidoNoDocERP;
    const puede = puedeVender && !p.PedidoNoDocERP;
    const d = pa.Datos || {};
    const Sub = ({ children }) => <div className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1">{children}</div>;
    // Con molde de TIZADA PRO: el arte es UN archivo por diseño (todas las piezas); diseños + lista de jugadores = paso 3
    const conTizada = p.TipoFabricacion === 'PRODUCTO_TERMINADO' && !!p.Config?.TizadaProMoldeRef;
    return (
        <section className={ZONA}>
            <div className={`${TIT_ZONA} flex flex-wrap items-center justify-between gap-2`}>
                <span>Producción principal ({nombrePrincipal(p)}) <small>{p.Config?.Molde === 'NO' ? 'arte → con eso se envía a Diseño' : conTizada ? 'arte · telas por pieza · diseños y lista de jugadores → TIZADA PRO arma la tizada' : 'arte · telas por pieza · planilla de talles → con eso se envía a Diseño'}</small></span>
                <span className="flex items-center gap-1.5"><Pastilla e={pa.Estado} mapa={ESTADO_PARTE} />{pa.Modificada ? <PastillaModificada /> : null}
                    {d.disenoAutomatico ? <span className="px-2 py-0.5 rounded-full border text-[10px] font-black bg-emerald-100 text-emerald-700 border-emerald-200 normal-case tracking-normal" title={`Lo hizo ${d.disenoAutomatico.sistema} (${d.disenoAutomatico.referencia})`}>Diseño automático · {d.disenoAutomatico.sistema}</span> : null}
                    {pa.DisenadorNombre ? <span className="text-[11px] font-bold text-slate-600 normal-case tracking-normal">{pa.Estado === 'DISENADO' ? 'Diseñó' : 'Lo tiene'} <b>{pa.DisenadorNombre}</b></span>
                        : pa.Estado === 'ENVIADO_DISENO' ? <span className="text-[11px] font-bold text-slate-500 normal-case tracking-normal">nadie lo tomó todavía</span> : null}</span>
            </div>
            <div className="grid md:grid-cols-2 gap-3 text-xs">
                <div className="space-y-0.5">
                    {pa.IncluidoEnProducto ? <div className="text-[10px] font-bold text-slate-400">Incluido en el producto</div> : null}
                    {d.variante && <div className="text-slate-600">{d.variante}</div>}
                    {d.material && <div className="text-slate-600">{d.material}</div>}
                    {pa.Observaciones ? <div className="text-slate-500 whitespace-pre-line">Indicaciones: {pa.Observaciones}</div> : <div className="text-slate-400">Sin indicaciones para Diseño.</div>}
                </div>
                <div>
                    <Sub>1 · Arte del cliente <span className="normal-case font-normal">{conTizada
                        ? '(UN archivo .ai o .pdf por diseño — jugador, alternativa… — con todas las piezas: se elige en el paso 3)'
                        : '(escudos, logos, bocetos: después se asigna a cada pieza)'}</span></Sub>
                    <ArchivosCelda archivos={arte} vacio="Sin archivos" puedeQuitar={puede} onQuitar={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Archivo quitado.')} conRol />
                    {puede && <div className="mt-1.5"><BotonSubir busy={busy} roles={ROLES_PARTE} onFiles={(files, Rol) => subir(files, { Rol, ParteID: pa.ParteID }, pa.Tipo)} /></div>}
                </div>
            </div>

            {p.TipoFabricacion === 'PRODUCTO_TERMINADO' && <PiezasTelasBloque plano id={id} p={p} busy={busy} puede={puede} hacer={hacer} artes={artes} onEstado={onEstadoSubl} conTizada={conTizada} />}

            {p.Config?.Molde !== 'NO' && !conTizada && <div className="pt-3 mt-3 border-t border-slate-200 text-xs">
                <Sub>{p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? '3' : '2'} · Planilla de talles y nombres <span className="normal-case font-normal">(cuántas prendas de cada talle, nombres y números) y referencias</span></Sub>
                <div className="grid md:grid-cols-2 gap-4">
                    <div>
                        <ArchivosCelda archivos={planillas} vacio="Sin archivos" puedeQuitar={puede} onQuitar={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Archivo quitado.')} conRol />
                        {puede && <div className="mt-1.5"><BotonSubir busy={busy} roles={ROLES_PRODUCTO} onFiles={(files, Rol) => subir(files, { Rol, ProductoSolID: p.ProductoSolID })} /></div>}
                    </div>
                    <TallesCampos id={id} p={p} puede={puede} busy={busy} hacer={hacer} />
                </div>
            </div>}

            {/* Con molde de TIZADA PRO el paso 3 es UNO: diseños (nombre + arte) + lista de jugadores → la tizada
                vuelve sola como diseño pronto (diseño automático). La planilla original del cliente y los datos de
                nombres y números quedan adentro, como opcionales. */}
            {conTizada && (
                <TizadaProBloque id={id} p={p} puede={puede && !bloqueada} onCargado={() => hacer(async () => { })} numero={3}
                    extra={(
                        <details className="mt-3 border border-slate-200 rounded-xl px-3 py-2" open={planillas.length > 0}>
                            <summary className="cursor-pointer text-[11px] font-bold text-slate-600">Planilla original del cliente y datos de nombres y números (opcional){planillas.length ? ` · ${planillas.length} archivo(s)` : ''}</summary>
                            <div className="grid md:grid-cols-2 gap-4 mt-2">
                                <div>
                                    <ArchivosCelda archivos={planillas} vacio="Sin archivos" puedeQuitar={puede} onQuitar={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Archivo quitado.')} conRol />
                                    {puede && <div className="mt-1.5"><BotonSubir busy={busy} roles={ROLES_PRODUCTO} onFiles={(files, Rol) => subir(files, { Rol, ProductoSolID: p.ProductoSolID })} /></div>}
                                </div>
                                <TallesCampos id={id} p={p} puede={puede} busy={busy} hacer={hacer} />
                            </div>
                        </details>
                    )} />
            )}

            <div className="pt-3 mt-3 border-t border-slate-200 flex flex-wrap items-center gap-2 text-xs">
                {pa.Estado === 'INGRESADO' ? (
                    !bloqueada && perfil.esVendedor ? (faltaEnvio
                        ? <span className="text-[11px] font-bold text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={12} /> Todavía no se puede enviar a Diseño: {faltaEnvio}</span>
                        : <>
                            <Selector value={tipoTrabajo} onChange={e => setTipoTrabajo(e.target.value)} claseBoton={claseSel('border border-slate-200 rounded-lg px-2 py-1.5 text-xs')} anchoLista={240}>
                                {Object.entries(TIPO_TRABAJO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                            </Selector>
                            <button disabled={busy} onClick={() => hacer(() => svc.enviarADiseno(pa.ParteID, tipoTrabajo), 'Producción principal enviada a la bandeja de Diseño.')} className={BTN_PRIMARIO}><Send size={12} /> Enviar a Diseño</button>
                        </>)
                    : <span className="text-slate-500">Todavía no se envió a Diseño.</span>
                ) : (
                    <span className="text-slate-600">
                        {pa.TipoTrabajo ? <>{TIPO_TRABAJO[pa.TipoTrabajo]} · </> : null}
                        {pa.DisenadorNombre ? <>Diseñador: <b>{pa.DisenadorNombre}</b> · </> : null}
                        {pa.FechaDisenado ? <>Diseñado {fmtFechaHora(pa.FechaDisenado)}</> : pa.FechaInicioDiseno ? <>Diseño iniciado {fmtFechaHora(pa.FechaInicioDiseno)}</> : pa.FechaEnvioDiseno ? <>Enviado a Diseño {fmtFechaHora(pa.FechaEnvioDiseno)}</> : null}
                        <span className="text-slate-400"> · el trabajo lo sigue Diseño desde su bandeja</span>
                    </span>
                )}
            </div>
        </section>
    );
}

/* Lo que antes era la pestaña "Lista de talles" del formulario. Se guarda en Datos del producto
   (PUT /productos/:id/talles). Producto del catálogo: siempre por talle y las medidas las da el
   molde, así que solo pide la nota de talles y lo de nombres y números. Producto del cliente:
   además "por talle / por medidas", medidas y terminación, medidas de la prenda y tabla estándar. */
function TallesCampos({ id, p, puede, busy, hacer }) {
    const d = p.Datos || {};
    const catalogo = p.TipoFabricacion === 'PRODUCTO_TERMINADO';
    const inicial = () => ({ comoSeDefine: d.comoSeDefine === 'MEDIDA' ? 'MEDIDA' : 'TALLE', notaTalles: d.notaTalles || '', medidas: d.medidas || '', terminacion: d.terminacion || '', medidasPrenda: d.medidasPrenda || '', tablaEstandar: !!d.tablaEstandar, personalizacion: !!d.personalizacion, listaCerrada: !!d.listaCerrada });
    const [v, setV] = useState(inicial);
    const firma = JSON.stringify(inicial());
    useEffect(() => { setV(inicial()); }, [p.ProductoSolID, firma]);   // eslint-disable-line react-hooks/exhaustive-deps
    const cambiado = JSON.stringify(v) !== firma;
    const set = (c) => setV(x => ({ ...x, ...c }));
    const porMedida = v.comoSeDefine === 'MEDIDA';
    const chk = (k, texto, extra) => (
        <label className="flex items-start gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={!!v[k]} disabled={!puede} onChange={e => set({ [k]: e.target.checked, ...(k === 'personalizacion' && !e.target.checked ? { listaCerrada: false } : {}) })} className="mt-0.5" />
            <span>{texto}{extra}</span>
        </label>
    );
    return (
        <div className="space-y-2">
            {!catalogo && (
                <div className="flex flex-wrap gap-1">
                    {[['TALLE', 'Por talle (prendas de vestir)'], ['MEDIDA', 'Por medidas en cm (banderas, toallas…)']].map(([k, t]) => (
                        <button type="button" key={k} disabled={!puede} onClick={() => set({ comoSeDefine: k })}
                            className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold ${v.comoSeDefine === k ? 'bg-brand-cyan text-white border-brand-cyan' : 'bg-white text-slate-600 border-slate-200'}`}>{t}</button>
                    ))}
                </div>
            )}
            {porMedida ? (
                <>
                    <Campo label="Medidas exactas y cantidad por cada medida" ayuda="Una línea por medida: Banderas 90 x 150 cm — 50 unidades"><textarea value={v.medidas} disabled={!puede} onChange={e => set({ medidas: e.target.value })} className={INPUT} rows={3} /></Campo>
                    <Campo label="Tipo de terminación o costura" ayuda="Dobladillo y tiras, vaina para mástil, fuelle…"><input value={v.terminacion} disabled={!puede} onChange={e => set({ terminacion: e.target.value })} className={INPUT} /></Campo>
                </>
            ) : (
                <>
                    <Campo label="Nota sobre los talles (si no adjuntás la planilla)" ayuda="Ej: S 20 · M 40 · L 30 · XL 10"><input value={v.notaTalles} disabled={!puede} onChange={e => set({ notaTalles: e.target.value })} className={INPUT} /></Campo>
                    {!catalogo && (
                        <>
                            <Campo label="Medidas de la prenda (largo, ancho de pecho, manga, cintura…)"><textarea value={v.medidasPrenda} disabled={!puede} onChange={e => set({ medidasPrenda: e.target.value })} className={INPUT} rows={2} /></Campo>
                            {chk('tablaEstandar', 'Se trabaja con la tabla de medidas estándar del taller, confirmada con el cliente')}
                        </>
                    )}
                </>
            )}
            {chk('personalizacion', 'Lleva nombres y números (personalización individual)')}
            {v.personalizacion && <div className="pl-5">{chk('listaCerrada', <b>Lista de nombres y números recibida, completa y cerrada.</b>, ' Se produce tal cual figura en la lista; lo que se agregue después puede cambiar costo y plazo.')}</div>}
            {puede && cambiado && <button type="button" disabled={busy} onClick={() => hacer(() => svc.guardarTalles(id, p.ProductoSolID, v), 'Talles guardados.')} className={BTN_PRIMARIO}><CheckCircle2 size={12} /> Guardar talles</button>}
        </div>
    );
}

/* Trabajo de Diseño sobre la solicitud: lo usa SolicitudDisenoPage (/ventas/solicitudes/:id/diseno),
   adonde llega el diseñador desde su bandeja. Todos los productos, con las columnas del diseñador
   (tizada, PDF por hoja, diseño pronto, tomar, aceptar cambios). Ya no es pestaña de la solicitud. */
export function DisenoTab({ s, id, user, perfil, busy, abierta, telas, archivosDe, hacer, subir, onAbrirFicha }) {
    return (
        <div className="space-y-6">
            {s.Productos.map((p, i) => {
                const conv = s.Conversion.find(c => c.ProductoSolID === p.ProductoSolID) || {};
                const bloqueada = !abierta || !!p.PedidoNoDocERP;
                const artes = archivosDe(a => a.Rol === 'ARTE_CLIENTE' && (a.ProductoSolID === p.ProductoSolID || p.Partes.some(pa => pa.ParteID === a.ParteID)));
                return (
                    <div key={p.ProductoSolID} className="space-y-3">
                        {/* Banda superior: el producto y, por cada servicio, su estado, el diseñador y las acciones (tomar, aceptar cambio) */}
                        <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 space-y-2">
                            <h2 className="text-sm font-black text-slate-800">Producto {i + 1}: {p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? (p.ProductoNombre || `Producto ${p.ProIdProducto}`) : 'Producto personalizado del cliente'} <span className="font-bold text-slate-500">· {p.Cantidad} prendas</span>
                                {p.PedidoNoDocERP ? <span className="ml-2 text-[10px] font-black uppercase text-emerald-700">Pedido {p.PedidoNoDocERP}</span> : null}</h2>
                            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
                                {p.Partes.map(pa => (
                                    <EstadoParteDiseno key={pa.ParteID} pa={pa} user={user} perfil={perfil} busy={busy} bloqueada={bloqueada} onAbrirFicha={onAbrirFicha}
                                        enProduccion={(conv.disenoProduccion || []).filter(o => o.AreaID === ({ BORDADO: 'EMB', TPU: 'TPU' })[pa.Tipo])}
                                        onTomar={() => hacer(() => svc.tomar(pa.ParteID), 'Trabajo tomado: quedó a tu nombre.')}
                                        // Con molde de TIZADA PRO la principal no se "toma": se manda a TIZADA y vuelve sola como diseño pronto
                                        onEnviarTizada={pa.Tipo === 'PRINCIPAL' && p.TipoFabricacion === 'PRODUCTO_TERMINADO' && p.Config?.TizadaProMoldeRef
                                            ? () => hacer(async () => {
                                                const r = await svc.tizadaProEnviar(id, p.ProductoSolID, false);
                                                if (r.Estado === 'RECHAZADO') toast.error(`TIZADA no lo acepta: ${r.mensaje || 'mirá las alarmas en "Tizada automática · TIZADA PRO"'}.`);
                                                else toast.success(`Mandado a TIZADA PRO (${r.Referencia}). La tizada vuelve sola cuando termine.`);
                                            })
                                            : null}
                                        onAceptar={() => hacer(() => svc.aceptarCambio(pa.ParteID), 'Cambio aceptado.')} />
                                ))}
                            </div>
                        </div>
                        {p.FichaProducto && <FichaProductoBloque f={p.FichaProducto} />}
                        {p.TipoFabricacion === 'PRODUCTO_TERMINADO' && <PiezasTelasBloque id={id} p={p} busy={busy} puede={false} hacer={hacer} artes={artes} />}
                        {/* TIZADA PRO: el diseñador elige la letra de nombre y número y genera la tizada (vuelve sola como diseño pronto) */}
                        {p.TipoFabricacion === 'PRODUCTO_TERMINADO' && p.Config?.TizadaProMoldeRef && (() => {
                            const pa = p.Partes.find(x => x.Tipo === 'PRINCIPAL');
                            const esDis = perfil.esDisenador || perfil.esAdmin;
                            const enviada = pa && pa.Estado !== 'INGRESADO';
                            return (
                                <section className={ZONA}>
                                    <TizadaProBloque id={id} p={p} modo="diseno" puede={esDis && !bloqueada} puedeGenerar={esDis && !bloqueada && enviada}
                                        motivoNoGenerar={!esDis ? 'La tizada la genera un diseñador.' : !enviada ? 'El vendedor todavía no tocó "Enviar a Diseño" en la solicitud.' : bloqueada ? 'La solicitud está cerrada o ya es pedido.' : null}
                                        onCargado={() => hacer(async () => { })} />
                                </section>
                            );
                        })()}
                        <TablaServicios vista="diseno" s={s} p={p} id={id} user={user} perfil={perfil} busy={busy} abierta={abierta} telas={telas} archivosDe={archivosDe} hacer={hacer} subir={subir} onAbrirFicha={onAbrirFicha} />
                        {/* El pedido de producción lo crea el diseñador desde acá, con la tizada y los archivos ya cargados */}
                        <div className="max-w-3xl">
                            <Conversion s={s} p={p} pedido={conv.pedido} faltantes={conv.faltantes || []} avisos={conv.avisos || []} checklist={conv.checklist} puedeVender={perfil.esDisenador || perfil.esVendedor} busy={busy} hacer={hacer} id={id} />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

/* Ficha técnica del producto del catálogo (lo cargado en Configurar productos → Ficha de diseño).
   Solo lectura, para que el diseñador tenga a la vista avíos, costuras, material, tallas y notas. */
function FichaProductoBloque({ f }) {
  const [abierta, setAbierta] = useState(true);
  const base = (api.defaults?.baseURL || '').replace(/\/api\/?$/, '');
  const dib = f.dibujoUrl ? (f.dibujoUrl.startsWith('http') ? f.dibujoUrl : base + f.dibujoUrl) : null;
  return (
    <section className={ZONA}>
      <div className={`${TIT_ZONA} flex flex-wrap items-center justify-between gap-2`}>
        <span>Ficha técnica del producto <small>del configurador · avíos, costuras, material, tallas</small></span>
        <button type="button" onClick={() => setAbierta(v => !v)} className={BTN_SECUNDARIO}>{abierta ? 'Ocultar' : 'Ver'}</button>
      </div>
      {abierta && (
        <div className="grid md:grid-cols-[auto_1fr] gap-4 text-xs">
          {dib && <a href={dib} target="_blank" rel="noreferrer" title="Abrir el dibujo"><img src={dib} alt="" className="w-40 max-h-40 object-contain rounded-lg border border-slate-200 bg-white" /></a>}
          <div className="space-y-3 min-w-0">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {f.ref && <Info l="Referencia" v={f.ref} />}{f.marca && <Info l="Marca" v={f.marca} />}{f.material && <Info l="Material" v={f.material} />}{f.tallas && <Info l="Tallas" v={f.tallas} />}{f.marcacion && <Info l="Marcación" v={f.marcacion} />}
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <div className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1">Avíos</div>
                {f.avios.length ? (
                  <table className="w-full"><tbody>{f.avios.map((a, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1 pr-2 font-bold text-slate-800">{a.nombre}</td><td className="py-1 pr-2 text-slate-600 whitespace-nowrap">{a.cantidad ?? ''} {a.unidad}/prenda</td><td className="py-1 pr-2 text-slate-600">{a.medida || ''}</td><td className="py-1 text-slate-500">{a.nota || ''}</td></tr>)}</tbody></table>
                ) : <div className="text-slate-400">Sin avíos cargados en el configurador.</div>}
              </div>
              <div>
                <div className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1">Costuras (ISO 4915)</div>
                {f.costuras.length ? (
                  <table className="w-full"><tbody>{f.costuras.map((c, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1 pr-2 font-bold text-slate-800">{i + 1}. {c.union}{c.piezas ? <span className="font-normal text-slate-500"> · {c.piezas}</span> : null}</td><td className="py-1 text-slate-600">{c.codigoISO || 'Sin costura'}{c.nombre ? ` · ${c.nombre}` : ''}{c.maquina ? ` · ${c.maquina}` : ''}{c.tiempoMin != null ? ` · ${c.tiempoMin} min` : ''}</td></tr>)}</tbody></table>
                ) : <div className="text-slate-400">Sin costuras cargadas en el configurador.</div>}
              </div>
            </div>
            {f.notas.length > 0 && <ul className="list-disc pl-5 text-slate-700">{f.notas.map((n, i) => <li key={i}>{n.etiqueta ? <b>{n.etiqueta}: </b> : null}{n.valor}</li>)}</ul>}
          </div>
        </div>
      )}
    </section>
  );
}

/* Estado de UN servicio en la pantalla de Diseño: pill, tipo de trabajo, diseñador, fechas, y las
   acciones del diseñador (tomar el trabajo, aceptar un cambio del vendedor) + seguimiento en planta. */
function EstadoParteDiseno({ pa, user, perfil, busy, bloqueada, enProduccion = [], onAbrirFicha, onTomar, onAceptar, onEnviarTizada = null }) {
    const esMia = pa.DisenadorID && pa.DisenadorID === user?.id;
    const [dialogo, preguntar] = useConfirmar();   // confirmación con el estilo del sistema (06/10; antes window.confirm)
    return (
        <div className={`bg-white border rounded-lg p-2 text-xs space-y-1 ${pa.Modificada ? 'border-fuchsia-300' : 'border-slate-200'}`}>
            <div className="flex flex-wrap items-center gap-1.5"><span className="font-black text-slate-800">{pa.Nombre}</span><Pastilla e={pa.Estado} mapa={ESTADO_PARTE} />{pa.Modificada ? <PastillaModificada /> : null}</div>
            <div className="text-slate-600">
                {pa.TipoTrabajo ? <>{TIPO_TRABAJO[pa.TipoTrabajo]} · </> : null}
                {pa.DisenadorNombre ? <>Diseñador: <b>{pa.DisenadorNombre}</b></> : pa.Estado === 'INGRESADO' ? 'El vendedor todavía no lo envió a Diseño.' : pa.Estado === 'ENVIADO_DISENO' ? 'Nadie lo tomó todavía.' : null}
            </div>
            <div className="text-[10px] text-slate-400">
                {pa.FechaEnvioDiseno && <span>Enviado {fmtFechaHora(pa.FechaEnvioDiseno)} </span>}
                {pa.FechaInicioDiseno && <span>· Iniciado {fmtFechaHora(pa.FechaInicioDiseno)} </span>}
                {pa.FechaDisenado && <span>· Diseñado {fmtFechaHora(pa.FechaDisenado)}</span>}
            </div>
            {enProduccion.length > 0 && (
                <div className="border border-slate-200 rounded-lg p-2 space-y-1">
                    <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Ya es pedido — el diseño sigue en producción</div>
                    {enProduccion.map(o => {
                        const et = ETAPA_PRODUCCION[o.Etapa] || { txt: 'No queda diseño pendiente', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
                        return (
                            <div key={o.OrdenID} className="flex flex-wrap items-center gap-2">
                                <span className="font-mono font-bold text-slate-700">{o.CodigoOrden}</span>
                                <span className={`${PASTILLA} ${et.cls}`}>{et.txt}</span>
                                <button type="button" onClick={() => onAbrirFicha?.({ id: o.OrdenID, area: o.AreaID, codigo: o.CodigoOrden, cliente: o.Cliente })} className="text-brand-cyan font-bold hover:underline">Abrir la ficha de la orden</button>
                            </div>
                        );
                    })}
                </div>
            )}
            {pa.Modificada ? (
                <div className="border border-fuchsia-200 rounded-lg p-2">
                    <div className="font-black text-fuchsia-700">El vendedor cambió este servicio el {fmtFechaHora(pa.ModificadaFecha)}:</div>
                    <div className="text-slate-700 whitespace-pre-line">{pa.ModificadaDetalle}</div>
                    {!bloqueada && (esMia || perfil.esAdmin) && pa.DisenadorID
                        ? <button disabled={busy} onClick={onAceptar} className={`${BTN_PRIMARIO} mt-2`}><CheckCircle2 size={12} /> Acepto el cambio (estoy al tanto)</button>
                        : !bloqueada && !pa.DisenadorID && pa.Estado === 'DISENADO' && perfil.esVendedor
                            ? <button disabled={busy} onClick={onAceptar} className={`${BTN_PRIMARIO} mt-2`}><CheckCircle2 size={12} /> Confirmo el cambio: el diseño pronto sigue sirviendo</button>
                            : <div className="text-[11px] text-slate-500 mt-1">{pa.DisenadorID ? `Lo tiene que aceptar ${pa.DisenadorNombre || 'el diseñador'}.` : 'Lo acepta el diseñador que tome el trabajo.'} Mientras tanto el producto no se puede convertir en pedido.</div>}
                </div>
            ) : null}
            {/* Con molde de TIZADA PRO: "Enviar a TIZADA PRO" en vez de tomar; si ya lo tomaron, lo manda quien lo tomó (o un admin) */}
            {!bloqueada && perfil.esDisenador && onEnviarTizada && (pa.Estado === 'ENVIADO_DISENO' || (pa.Estado === 'DISENO_INICIADO' && (esMia || perfil.esAdmin)))
                ? <button disabled={busy} onClick={onEnviarTizada} className={BTN_PRIMARIO} title="Revisa arte y datos, y lo manda a TIZADA PRO; la tizada vuelve sola como diseño pronto"><Send size={12} /> Enviar a TIZADA PRO</button>
                : !bloqueada && perfil.esDisenador && pa.Estado === 'ENVIADO_DISENO' && <button disabled={busy} onClick={onTomar} className={BTN_PRIMARIO}>Tomar este trabajo</button>}
            {/* Rehacer: con la tizada ya hecha (Diseñado) se puede volver a mandar; la nueva reemplaza al diseño pronto actual */}
            {!bloqueada && perfil.esDisenador && onEnviarTizada && pa.Estado === 'DISENADO' && (esMia || perfil.esAdmin || !pa.DisenadorID) && (
                <button disabled={busy} className={BTN_SECUNDARIO} title="Vuelve a mandar diseños, arte y lista a TIZADA PRO; cuando vuelve, la tizada nueva reemplaza a la actual"
                    onClick={async () => { if (await preguntar({ Icono: RefreshCw, titulo: 'Rehacer la tizada', texto: 'Se manda de nuevo a TIZADA PRO con los diseños, el arte y la lista de talles que estén guardados ahora.', nota: 'Cuando vuelva, la tizada nueva reemplaza a los archivos de diseño pronto actuales.', boton: 'Mandarla' })) onEnviarTizada(); }}>
                    <RefreshCw size={12} /> Rehacer la tizada en TIZADA PRO
                </button>
            )}
            {dialogo}
        </div>
    );
}

/* Tabla de servicios de UN producto. vista "cliente" (pestaña del producto): servicio, archivos
   del cliente y estado con "Enviar a Diseño". vista "diseno" (pantalla de Diseño): además la
   columna del diseño pronto, y los archivos del cliente en solo lectura. */
function TablaServicios({ vista, s, p, id, user, perfil, busy, abierta, telas: telasSB, archivosDe, hacer, subir, onAbrirFicha, faltaSubl = null, partes = null, titulo = null }) {
    // F1: si la producción principal del producto no es sublimación, las telas de cada archivo son las del área del producto
    const areaPrincipal = p.Config?.TecnicaPrincipal || 'SB';
    const [telasArea, setTelasArea] = useState(null);
    useEffect(() => {
        let vivo = true;
        if (areaPrincipal === 'SB') { setTelasArea(null); return undefined; }
        svc.materialesPrincipal(areaPrincipal).then(l => { if (vivo) setTelasArea(l); }).catch(() => { if (vivo) setTelasArea([]); });
        return () => { vivo = false; };
    }, [areaPrincipal]);
    const telas = telasArea || telasSB;
    const conv = s.Conversion.find(c => c.ProductoSolID === p.ProductoSolID) || {};
    const bloqueada = !abierta || !!p.PedidoNoDocERP;
    const esDiseno = vista === 'diseno';
    // La tela de cada archivo de la sublimación se elige entre las telas que el vendedor puso en
    // "Piezas y telas"; si no cargó nada (o no coinciden por nombre), queda el catálogo completo.
    const elegidas = new Set((p.Datos?.sublimacion?.piezas || []).map(z => normTxt(z.telaNombre)).filter(Boolean));
    const telasElegidas = telas.filter(t => elegidas.has(normTxt(t.Material)));
    const telasPrincipal = telasElegidas.length ? telasElegidas : telas;
    return (
        // Tema claro (06/10): el encabezado de grupo (cliente / diseñador) con el título como el de las zonas; antes, Barlow
        // en mayúsculas, amarillo el del cliente y celeste el del diseñador, y cada columna con su tinte (fp-tabla-serv).
        // En la vista de Diseño, una línea separa lo del cliente de lo del diseñador.
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
            <table className={`w-full text-xs ${esDiseno ? 'min-w-[760px] [&_td:nth-child(2)]:border-l [&_td:nth-child(2)]:border-slate-200' : 'min-w-[560px]'}`}>
                <thead>
                    <tr className="bg-slate-50 text-left [&>th]:px-3 [&>th]:py-2.5 [&>th]:text-sm [&>th]:font-black [&>th]:text-slate-800 [&_small]:ml-2 [&_small]:text-xs [&_small]:font-medium [&_small]:text-slate-400">
                        {esDiseno
                            ? <><th>Solicitud del cliente <small>solo lectura</small></th><th className="border-l border-slate-200">Diseñador <small>lo que va a producción</small></th></>
                            : <th colSpan={2}>{titulo || 'Producción principal'} <small>lo que pidió y mandó · el diseño lo sigue Diseño desde su bandeja</small></th>}
                    </tr>
                    <tr className="border-t border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-400 text-left">
                        <th className={`px-3 py-2 ${esDiseno ? 'w-[34%]' : 'w-[45%]'}`}>{esDiseno ? 'Servicio y archivos del cliente' : 'Servicio'}</th>
                        {!esDiseno && <th className="px-3 py-2">Archivos del cliente</th>}
                        {esDiseno && <th className="px-3 py-2">Diseño pronto (lo que va a producción)</th>}
                    </tr>
                </thead>
                <tbody>
                    {(partes || p.Partes).map(pa => (
                        <FilaServicio key={pa.ParteID} vista={vista} pa={pa} user={user} perfil={perfil} busy={busy} bloqueada={bloqueada} telas={telasPrincipal}
                            archivosProducto={pa.Tipo === 'PRINCIPAL' ? archivosDe(a => a.ProductoSolID === p.ProductoSolID && !a.ParteID) : []}
                            enProduccion={(conv.disenoProduccion || []).filter(o => o.AreaID === ({ BORDADO: 'EMB', TPU: 'TPU' })[pa.Tipo])} onAbrirFicha={onAbrirFicha}
                            archivos={archivosDe(a => a.ParteID === pa.ParteID)} faltaEnvio={pa.Tipo === 'PRINCIPAL' ? faltaSubl : null}
                            onEnviar={(tt) => hacer(() => svc.enviarADiseno(pa.ParteID, tt), `${NOMBRE_PARTE[pa.Tipo]} enviado a la bandeja de Diseño.`)}
                            onTomar={() => hacer(() => svc.tomar(pa.ParteID), 'Trabajo tomado: quedó a tu nombre.')}
                            onAceptar={() => hacer(() => svc.aceptarCambio(pa.ParteID), 'Cambio aceptado.')}
                            onSubir={(files, campos) => subir(files, { ...campos, ParteID: pa.ParteID }, pa.Tipo)}
                            onQuitar={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Archivo quitado.')}
                            onDeshacerDisenado={(lista) => hacer(async () => { for (const a of lista) await svc.quitarArchivo(id, a.ArchivoID); }, `${pa.Nombre}: volvió a "Ingresado". Ahora se puede enviar a Diseño.`)}
                            onProduccion={(a, datos) => hacer(() => svc.definirProduccionArchivo(id, a.ArchivoID, datos), 'Tela y copias guardadas.')}
                            tizada={(s.Tizadas || []).find(t => t.ParteID === pa.ParteID) || null}
                            onVincularTizada={(trabajoId, forzar) => hacer(() => svc.vincularTizada(pa.ParteID, trabajoId, forzar), 'Tizada vinculada. Ahora subí el PDF de cada hoja.')} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function FilaServicio({ vista = 'cliente', pa, user, perfil, busy, bloqueada, telas, archivos, onEnviar, onTomar, onAceptar, onSubir, onQuitar, onProduccion, enProduccion = [], onAbrirFicha, tizada = null, onVincularTizada, faltaEnvio = null, onDeshacerDisenado, archivosProducto = [] }) {
    const [tipoTrabajo, setTipoTrabajo] = useState(pa.ArteOrigen === 'CLIENTE' ? 'REVISAR' : 'DESDE_CERO');
    const [dialogo, preguntar] = useConfirmar();   // confirmaciones con el estilo del sistema (06/10; antes window.confirm)
    const esDiseno = vista === 'diseno';
    const esPrincipal = pa.Tipo === 'PRINCIPAL';
    const esMia = pa.DisenadorID && pa.DisenadorID === user?.id;
    const puedeDisenar = !bloqueada && (esMia || (perfil.esAdmin && pa.DisenadorID)) && ['DISENO_INICIADO', 'DISENADO'].includes(pa.Estado);
    // RN-SOL.20: arte listo del cliente en un servicio adicional → el vendedor adjunta el diseño pronto sin pasar por Diseño
    const vendedorDirecto = !bloqueada && perfil.esVendedor && !esPrincipal && !pa.DisenadorID && ['INGRESADO', 'DISENADO'].includes(pa.Estado);
    const puedeSubirPronto = puedeDisenar || vendedorDirecto;
    const prontos = archivos.filter(a => a.Rol === 'DISENO_PRONTO');
    const otros = archivos.filter(a => a.Rol !== 'DISENO_PRONTO');
    const d = pa.Datos || {};

    const celdaServicio = (
        <td className="px-3 py-3 space-y-0.5">
            <div className="font-black text-slate-800">{pa.Nombre}</div>
            {pa.IncluidoEnProducto ? <div className="text-[10px] font-bold text-slate-400">Incluido en el producto</div> : null}
            {pa.CantidadTotal != null && <div className="text-slate-600">{pa.CantidadTotal} en total{pa.PorPrenda != null ? ` · ${pa.PorPrenda} por prenda` : ''}</div>}
            {pa.Ubicacion && <div className="text-slate-600">Dónde va: {pa.Ubicacion}</div>}
            {d.variante && <div className="text-slate-600">{d.variante}</div>}
            {d.material && <div className="text-slate-600">{d.material}</div>}
            {d.origenPrendas && <div className="text-slate-600">Prendas: {d.origenPrendas}</div>}
            {!esPrincipal && <div className="text-slate-500">{pa.ArteOrigen === 'CLIENTE' ? 'El arte viene listo del cliente' : 'El arte se diseña en la empresa'}</div>}
            {pa.Observaciones && <div className="text-slate-500 whitespace-pre-line pt-1">Indicaciones: {pa.Observaciones}</div>}
            {!esDiseno && (
                <div className="pt-1.5 flex flex-wrap items-center gap-1.5">
                    <Pastilla e={pa.Estado} mapa={ESTADO_PARTE} />{pa.Modificada ? <PastillaModificada /> : null}
                    {pa.DisenadorNombre && <span className="text-[10px] text-slate-500">{pa.DisenadorNombre}</span>}
                    {!bloqueada && perfil.esVendedor && pa.Estado === 'INGRESADO' && (faltaEnvio
                        ? <span className="text-[10px] font-bold text-amber-700 inline-flex items-center gap-1" title={faltaEnvio}><AlertTriangle size={11} /> Para enviar a Diseño, completá "Piezas y telas"</span>
                        : <>
                            <Selector value={tipoTrabajo} onChange={e => setTipoTrabajo(e.target.value)} claseBoton={claseSel('border border-slate-200 rounded-lg px-1.5 py-1 text-[11px]')} anchoLista={240}>
                                {Object.entries(TIPO_TRABAJO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                            </Selector>
                            <button disabled={busy} onClick={() => onEnviar(tipoTrabajo)} className={BTN_PRIMARIO}><Send size={12} /> Enviar a Diseño</button>
                        </>)}
                    {/* "Diseñado" sin pasar por Diseño (RN-SOL.20): el vendedor adjuntó el diseño pronto. Deshacerlo = quitar ese archivo. */}
                    {!bloqueada && perfil.esVendedor && pa.Estado === 'DISENADO' && !pa.DisenadorID && prontos.length > 0 && (
                        <button type="button" disabled={busy} className={BTN_SECUNDARIO} title="Quedó Diseñado porque se adjuntó un diseño pronto sin pasar por Diseño. Al deshacerlo se quita ese archivo y el servicio vuelve a Ingresado."
                            onClick={async () => { if (await preguntar({ Icono: RotateCcw, titulo: 'Deshacer "Diseñado"', peligro: true, boton: 'Quitar y volver a Ingresado', texto: `${pa.Nombre} quedó "Diseñado" porque se adjuntó ${prontos.length === 1 ? `"${prontos[0].NombreOriginal}"` : prontos.length + ' archivos'} como diseño pronto sin pasar por Diseño. Se quita ${prontos.length === 1 ? 'ese archivo' : 'esos archivos'} y el servicio vuelve a "Ingresado". Queda en el historial.` })) onDeshacerDisenado?.(prontos); }}>
                            <Trash2 size={11} /> Deshacer "Diseñado"
                        </button>
                    )}
                </div>
            )}
        </td>
    );

    // Vista Diseño: el servicio y TODOS los archivos del cliente (arte, bocetos, referencias y, en la
    // producción principal, la planilla de talles) en una sola celda, con miniatura y link para abrirlos.
    const celdaServicioArchivos = (
        <td className="px-3 py-3 space-y-1">
            <div className="font-black text-slate-800">{pa.Nombre}</div>
            {pa.CantidadTotal != null && <div className="text-slate-600">{pa.CantidadTotal} en total{pa.PorPrenda != null ? ` · ${pa.PorPrenda} por prenda` : ''}</div>}
            {pa.Ubicacion && <div className="text-slate-600">Dónde va: {pa.Ubicacion}</div>}
            {d.variante && <div className="text-slate-600">{d.variante}</div>}
            {d.material && <div className="text-slate-600">{d.material}</div>}
            {d.origenPrendas && <div className="text-slate-600">Prendas: {d.origenPrendas}</div>}
            {!esPrincipal && <div className="text-slate-500">{pa.ArteOrigen === 'CLIENTE' ? 'El arte viene listo del cliente' : 'El arte se diseña en la empresa'}</div>}
            {pa.Observaciones && <div className="text-slate-500 whitespace-pre-line">Indicaciones: {pa.Observaciones}</div>}
            <div className="pt-2">
                <div className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1">Archivos del cliente</div>
                <ArchivosCelda archivos={[...otros, ...archivosProducto]} vacio="Sin archivos" conRol />
            </div>
        </td>
    );

    // Archivos del cliente: el vendedor los carga en la pestaña del producto; en "Diseño" se ven nomás
    const celdaCliente = (
        <td className="px-3 py-3">
            <ArchivosCelda archivos={otros} vacio="Sin archivos" puedeQuitar={!esDiseno && !bloqueada && perfil.esVendedor} onQuitar={onQuitar} conRol />
            {!esDiseno && !bloqueada && perfil.esVendedor && <div className="mt-1.5"><BotonSubir busy={busy} roles={ROLES_PARTE} onFiles={(files, Rol) => onSubir(files, { Rol })} /></div>}
        </td>
    );

    const celdaDiseno = (
        <td className="px-3 py-3">
            {!prontos.length && <div className="text-slate-400">{['BORDADO', 'TPU'].includes(pa.Tipo) ? 'Sin archivo (es opcional)' : 'Todavía no hay archivo'}</div>}
            {esPrincipal && <TizadaBloque pa={pa} tizada={tizada} prontos={prontos} puede={puedeDisenar} busy={busy} onVincular={onVincularTizada} onSubirHoja={(files, hoja) => onSubir(files, { Rol: 'DISENO_PRONTO', TizadaID: tizada.TizadaID, TizadaHoja: hoja.archivo })} />}
            {esPrincipal && !tizada && <div className="text-[10px] text-slate-500 mb-1">Si la tizada no sale de TizadaPro, subí acá el archivo que se imprime en sublimación (uno o varios). Cada archivo lleva su tela y sus copias.</div>}
            {['BORDADO', 'TPU'].includes(pa.Tipo) && (
                <div className="text-[10px] text-slate-500 mb-1">
                    {pa.Tipo === 'BORDADO'
                        ? 'Lo que subas acá viaja como logo / boceto de referencia. La matriz (ponchado) se sube después desde la ficha de la orden, en el área de Bordado.'
                        : 'Lo que subas acá viaja como boceto de referencia. El boceto de producción, la aprobación del cliente y el arte se hacen después desde la ficha de la orden, en el área de TPU.'}
                </div>
            )}
            <ul className="space-y-2">
                {prontos.map(a => (
                    <li key={a.ArchivoID} className="bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
                        <Miniatura a={a} tam={44} />
                    <a href={a.UrlDrive} target="_blank" rel="noreferrer" className="font-bold text-brand-cyan hover:underline inline-flex items-center gap-1 break-all flex-1 min-w-0"><FileText size={12} /> {a.NombreOriginal}</a>
                        <div className="text-[10px] text-slate-500">{a.AnchoM && a.AltoM ? `${Number(a.AnchoM).toFixed(2)} × ${Number(a.AltoM).toFixed(2)} m · ` : ''}{a.UsuarioNombre || ''} · {fmtFechaHora(a.FechaSubida)}</div>
                        {esPrincipal && <TelaCopias a={a} telas={telas} puede={puedeDisenar} busy={busy} onGuardar={(datos) => onProduccion(a, datos)} />}
                        {pa.Tipo === 'DTF' && <TelaCopias soloCopias a={a} telas={[]} puede={puedeSubirPronto} busy={busy} onGuardar={(datos) => onProduccion(a, datos)} />}
                        {puedeSubirPronto && (
                            <div className="mt-1 flex flex-wrap items-center gap-3">
                                <BotonArchivo etiqueta="Sustituir por el archivo corregido" chico onFiles={(files) => onSubir(files, { Rol: 'DISENO_PRONTO', ReemplazaA: a.ArchivoID })} />
                                {(prontos.length > 1 || !pa.DisenadorID) && <button type="button" disabled={busy} onClick={async () => { if (await preguntar({ Icono: Trash2, titulo: 'Quitar el archivo', peligro: true, boton: 'Quitar', texto: prontos.length > 1 ? `"${a.NombreOriginal}" sale del diseño pronto de ${pa.Nombre}: no va a ir a producción. Queda registrado en el historial.` : `"${a.NombreOriginal}" es el único diseño pronto de ${pa.Nombre}: el servicio vuelve a "Ingresado" y se puede enviar a Diseño. Queda registrado en el historial.` })) onQuitar(a); }} className="text-rose-600 font-bold hover:underline inline-flex items-center gap-0.5"><Trash2 size={11} /> {prontos.length > 1 ? 'Quitar este archivo' : 'Quitar (vuelve a Ingresado)'}</button>}
                            </div>
                        )}
                    </li>
                ))}
            </ul>
            {puedeSubirPronto && (
                <div className="mt-2 space-y-1">
                    {esPrincipal && <div className="text-[10px] text-slate-500">Después de subir, elegí la tela y las copias en cada archivo.</div>}
                    <BotonArchivo busy={busy} multiple primario onFiles={(files) => onSubir(files, { Rol: 'DISENO_PRONTO' })}
                        etiqueta={vendedorDirecto && !puedeDisenar ? 'Adjuntar diseño pronto (arte listo del cliente, sin pasar por Diseño)' : (esPrincipal ? (prontos.length ? 'Agregar otra tizada / archivo de impresión' : 'Subir la tizada / archivo de impresión (marca el servicio como Diseñado)') : (prontos.length ? 'Agregar otro archivo de diseño pronto' : 'Subir diseño pronto (marca el servicio como Diseñado)'))} />
                </div>
            )}
        </td>
    );

    const estadoBase = (
        <>
            <div className="flex flex-wrap items-center gap-1"><Pastilla e={pa.Estado} mapa={ESTADO_PARTE} />{pa.Modificada ? <PastillaModificada /> : null}</div>
            {pa.TipoTrabajo && <div className="text-slate-500">{TIPO_TRABAJO[pa.TipoTrabajo]}</div>}
            {pa.DisenadorNombre && <div className="text-slate-600">Diseñador: <b>{pa.DisenadorNombre}</b></div>}
            {pa.FechaEnvioDiseno && <div className="text-[10px] text-slate-400">Enviado a diseño {fmtFechaHora(pa.FechaEnvioDiseno)}</div>}
            {pa.FechaInicioDiseno && <div className="text-[10px] text-slate-400">Diseño iniciado {fmtFechaHora(pa.FechaInicioDiseno)}</div>}
            {pa.FechaDisenado && <div className="text-[10px] text-slate-400">Diseñado {fmtFechaHora(pa.FechaDisenado)}</div>}
        </>
    );

    return (
        <tr className={`align-top border-t border-slate-200 ${pa.Modificada ? 'bg-fuchsia-50/40' : ''}`}>
            {esDiseno ? celdaServicioArchivos : <>{celdaServicio}{celdaCliente}</>}
            {esDiseno ? celdaDiseno : null}
            {dialogo}
        </tr>
    );
}

// Tela y copias de UN archivo de la producción principal. Las carga el diseñador; el archivo
// es siempre normal (sin escala ni raport).
/* Tizada de TizadaPro vinculada a la producción principal. TizadaPro genera la tizada
   (una hoja PDF por tela, con ancho y consumo); acá se elige cuál es y se sube A MANO el
   PDF de cada hoja, porque TizadaPro no expone los archivos. La tela, el ancho y los metros
   de cada PDF salen de la hoja vinculada (no se mide el archivo). */
/* Piezas y telas de la sublimación: para un producto del catálogo con molde de TizadaPro, el
   vendedor elige el MODELO (los modelos que el producto ofrece) y, pieza por pieza, la TELA
   (entre las que el producto ofrece; una pieza con tela fija en el molde no se elige) y el
   ARTE del cliente que va en esa pieza. Es lo que el diseñador necesita para armar la tizada;
   hasta que está completo, la producción principal no se manda a Diseño. */
function PiezasTelasBloque({ id, p, busy, puede, hacer, artes = [], onEstado, plano = false, conTizada = false }) {
    const zona = plano ? 'pt-3 mt-3 border-t border-slate-200' : ZONA;
    const tit = plano ? SUBTIT : TIT_ZONA;
    const [info, setInfo] = useState(null);      // respuesta de moldeDelProducto
    const [modelo, setModelo] = useState('');
    const [piezas, setPiezas] = useState({});    // pieza → { telaProIdProducto, archivoId, nota }
    const [editando, setEditando] = useState(false);
    const guardado = p.Datos?.sublimacion || null;

    useEffect(() => {
        let vivo = true;
        svc.moldeDelProducto(id, p.ProductoSolID).then(r => {
            if (!vivo) return;
            setInfo(r); onEstado?.({ aplica: !!r.aplica });
            const m = r.elegido?.modeloClave || r.modelos?.find(x => x.esDefault)?.clave || r.modelos?.[0]?.clave || '';
            setModelo(m);
            const ini = {};
            (r.elegido?.piezas || []).forEach(z => { ini[z.pieza] = { telaProIdProducto: z.telaProIdProducto || '', archivoId: z.archivoId || '', nota: z.nota || '' }; });
            setPiezas(ini);
            setEditando(!r.elegido);
        }).catch(() => { if (vivo) { setInfo({ aplica: false }); onEstado?.({ aplica: false }); } });
        return () => { vivo = false; };
    }, [id, p.ProductoSolID, guardado?.fecha]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!info) return null;
    if (!info.aplica) {
        // F1: producto del catálogo sin molde (windflag, funda, cuadro): archivo pronto a medida fija
        if (info.molde && info.molde !== 'OBLIGATORIO') return (
            <div className={plano ? 'pt-3 mt-3 border-t border-slate-200 text-xs text-slate-600' : 'text-xs text-slate-600'}>
                <span className="font-black text-slate-700">Sin molde:</span> {info.motivo}
            </div>
        );
        return null;
    }
    const mod = info.modelos.find(m => m.clave === modelo) || info.modelos[0];
    const telaDefault = info.telas.find(t => t.esDefault) || info.telas[0];
    const set = (pieza, campo, v) => setPiezas(prev => ({ ...prev, [pieza]: { ...(prev[pieza] || {}), [campo]: v } }));
    const todasEn = (v) => setPiezas(prev => { const n = { ...prev }; (mod?.piezas || []).forEach(z => { if (!z.telaFija) n[z.pieza] = { ...(n[z.pieza] || {}), telaProIdProducto: v }; }); return n; });
    const guardar = () => hacer(() => svc.guardarSublimacion(id, p.ProductoSolID, {
        modeloClave: mod.clave,
        piezas: (mod?.piezas || []).map(z => ({ pieza: z.pieza, ...(piezas[z.pieza] || {}) })),
    }), 'Piezas y telas guardadas.').then(ok => { if (ok) setEditando(false); });

    const Silueta = ({ z }) => z.svgPath
        ? <svg viewBox="0 0 100 100" className="w-8 h-8 shrink-0"><path d={z.svgPath} fill="#c7d2fe" stroke="#4f46e5" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>
        : <span className="w-8 h-8 shrink-0 rounded border border-dashed border-slate-300 inline-block" />;

    // Vista resumen (ya guardado y no editando)
    if (!editando && guardado) {
        return (
            <section className={zona}>
                <div className={`${tit} flex flex-wrap items-center justify-between gap-2`}>
                    <span>{plano ? '2 · ' : ''}Piezas y telas <small>modelo {guardado.modeloNombre} · {conTizada ? 'TIZADA PRO la usa para armar la tizada' : 'para el diseñador'}</small></span>
                    <span className="flex items-center gap-2">
                        {guardado.completo ? <span className="text-[10px] font-black uppercase text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Completo</span> : <span className="text-[10px] font-black uppercase text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={12} /> Faltan telas</span>}
                        {puede && <button type="button" disabled={busy} onClick={() => setEditando(true)} className={BTN_SECUNDARIO}><Pencil size={11} /> Cambiar</button>}
                    </span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    {guardado.piezas.map(z => {
                        const det = mod?.piezas.find(x => x.pieza === z.pieza);
                        return (
                            <div key={z.pieza} className="flex items-center gap-2 border border-slate-200 rounded-lg px-2 py-1.5 bg-white">
                                {(() => { const arte = z.archivoId ? artes.find(a => a.ArchivoID === z.archivoId) : null; return arte ? <Miniatura a={arte} tam={40} /> : det ? <Silueta z={det} /> : null; })()}
                                <div className="min-w-0">
                                    <div className="font-black text-slate-800 truncate">{z.generico || z.pieza}{z.generico && z.generico !== z.pieza ? <span className="font-normal text-slate-400"> · {z.pieza}</span> : null}</div>
                                    <div className={z.telaNombre ? 'text-slate-700' : 'text-rose-600 font-bold'}>{z.telaNombre || 'Sin tela'}{z.fija ? <span className="text-[10px] text-slate-400"> · fija del molde</span> : null}</div>
                                    {(!conTizada || z.archivoNombre || z.nota) && <div className="text-[10px] text-slate-500 truncate">{z.archivoNombre ? <>Arte: {z.archivoNombre}</> : conTizada ? null : 'Sin arte asignado'}{z.nota ? <>{z.archivoNombre ? ' · ' : ''}{z.nota}</> : null}</div>}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </section>
        );
    }

    if (!puede) return (
        <section className={zona}>
            <div className={tit}>{plano ? '2 · ' : ''}Piezas y telas <small>para el diseñador</small></div>
            <div className="text-xs text-amber-700">El vendedor todavía no cargó el modelo ni la tela de cada pieza.</div>
        </section>
    );

    return (
        <section className={zona}>
            <div className={tit}>{plano ? '2 · ' : ''}Piezas y telas <small>{conTizada
                ? 'qué tela lleva cada pieza · TIZADA PRO la usa para armar la tizada (vale para todos los diseños; el arte va por diseño en el paso 3)'
                : 'qué tela y qué arte lleva cada pieza · lo lee el diseñador para armar la tizada'}</small></div>
            <div className="flex flex-wrap items-end gap-3 mb-3 text-xs">
                <label className="min-w-[220px]">
                    <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Modelo <span className="font-normal normal-case">(molde {info.moldeNombre})</span></div>
                    <Selector value={mod?.clave || ''} onChange={e => setModelo(e.target.value)} claseBoton={claseSel(SEL_CAMPO)} disabled={info.modelos.length <= 1} anchoLista={300}>
                        {info.modelos.map(m => <option key={m.clave} value={m.clave}>{m.nombre}{m.esDefault ? ' ★' : ''} · {m.piezas.length} piezas</option>)}
                    </Selector>
                </label>
                {info.telas.length > 0 && (
                    <label className="min-w-[220px]">
                        <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Poner todas las piezas en</div>
                        <Selector value="" onChange={e => { if (e.target.value) todasEn(e.target.value); }} claseBoton={claseSel(SEL_CAMPO)} anchoLista={260}>
                            <option value="">Elegir una tela…</option>
                            {info.telas.map(t => <option key={t.proIdProducto} value={t.proIdProducto}>{t.nombre}</option>)}
                        </Selector>
                    </label>
                )}
                {!info.telas.length && <div className="text-rose-600 font-bold">El molde no tiene telas que existan en nuestro catálogo: revisá TizadaPro y Configurar productos.</div>}
                {info.telas.length > 0 && info.telasDelMolde && <div className="text-[10px] text-slate-500 pb-1.5">El producto no recorta telas en Configurar productos: se ofrecen todas las que admite el molde ({info.telas.length}).</div>}
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-xs min-w-[640px]">
                    <thead>
                        <tr className="bg-slate-50 text-[9px] font-black uppercase tracking-wide text-slate-500 text-left">
                            <th className="px-2 py-1.5 w-[26%]">Pieza</th>
                            <th className="px-2 py-1.5 w-[28%]">Tela</th>
                            {!conTizada && <th className="px-2 py-1.5 w-[28%]">Arte del cliente</th>}
                            <th className="px-2 py-1.5">Nota</th>
                        </tr>
                    </thead>
                    <tbody>
                        {(mod?.piezas || []).map(z => {
                            const v = piezas[z.pieza] || {};
                            return (
                                <tr key={z.pieza} className="border-t border-slate-100 align-middle">
                                    <td className="px-2 py-1.5">
                                        <div className="flex items-center gap-2">
                                            <Silueta z={z} />
                                            <div className="min-w-0">
                                                <div className="font-black text-slate-800">{z.generico || z.pieza}</div>
                                                {z.generico && z.generico !== z.pieza ? <div className="text-[10px] text-slate-400">{z.pieza}</div> : null}
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-2 py-1.5">
                                        {z.telaFija
                                            ? <div className="text-slate-700">{z.telaFija.nombre} <span className="text-[10px] text-slate-400">· fija del molde</span></div>
                                            : (
                                                <Selector value={v.telaProIdProducto || ''} onChange={e => set(z.pieza, 'telaProIdProducto', e.target.value)} claseBoton={claseSel(SEL_CAMPO + (!v.telaProIdProducto ? ' border-rose-300' : ''))} anchoLista={260}>
                                                    <option value="">Elegir tela…</option>
                                                    {info.telas.map(t => <option key={t.proIdProducto} value={t.proIdProducto}>{t.nombre}{telaDefault?.proIdProducto === t.proIdProducto ? ' ★' : ''}</option>)}
                                                </Selector>
                                            )}
                                    </td>
                                    {!conTizada && <td className="px-2 py-1.5">
                                        <Selector value={v.archivoId || ''} onChange={e => set(z.pieza, 'archivoId', e.target.value)} claseBoton={claseSel(SEL_CAMPO)} anchoLista={280}>
                                            <option value="">Sin arte (lo diseña el taller)</option>
                                            {artes.map(a => <option key={a.ArchivoID} value={a.ArchivoID}>{a.NombreOriginal}</option>)}
                                        </Selector>
                                    </td>}
                                    <td className="px-2 py-1.5"><input value={v.nota || ''} onChange={e => set(z.pieza, 'nota', e.target.value)} placeholder="Ej: color, ubicación del arte" className={INPUT} maxLength={200} /></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {!conTizada && !artes.length && <div className="text-[10px] text-slate-500 mt-1">Para asignar un arte por pieza, subilo primero como "Arte del cliente" en el paso 1 de la producción principal (arriba).</div>}
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy || !mod} onClick={guardar} className={BTN_PRIMARIO}><CheckCircle2 size={12} /> Guardar piezas y telas</button>
                {guardado && <button type="button" disabled={busy} onClick={() => setEditando(false)} className={BTN_SECUNDARIO}>Cancelar</button>}
                <span className="text-[10px] text-slate-500">Hasta que cada pieza tenga su tela, la producción principal no se puede enviar a Diseño.</span>
            </div>
        </section>
    );
}

function TizadaBloque({ pa, tizada, prontos, puede, busy, onVincular, onSubirHoja }) {
    const [abierto, setAbierto] = useState(false);
    const [lista, setLista] = useState(null);      // { moldeRef, trabajos, totalSinFiltro }
    const [cargando, setCargando] = useState(false);
    const [todas, setTodas] = useState(false);
    const [error, setError] = useState(null);
    const cargar = async (verTodas) => {
        setCargando(true); setError(null);
        try { setLista(await svc.tizadasTizadaPro(pa.ParteID, verTodas)); }
        catch (e) { setError(errorDe(e)); setLista(null); }
        finally { setCargando(false); }
    };
    const abrir = () => { setAbierto(true); setTodas(false); cargar(false); };
    const elegir = async (t) => {
        const ok = await onVincular(t.trabajoId, lista?.moldeRef && t.moldeRef && lista.moldeRef !== t.moldeRef);
        if (ok !== false) setAbierto(false);
    };
    const res = tizada?.Resultado || null;
    const hojaSubida = (h) => prontos.find(a => a.TizadaID === tizada.TizadaID && a.TizadaHoja === h.archivo);
    const fmtM = (cm) => (cm ? (Number(cm) / 100).toFixed(2) + ' m' : '—');

    return (
        <div className="mb-2 rounded-lg border border-brand-cyan/30 bg-brand-cyan/5 px-2.5 py-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="text-[10px] font-black uppercase tracking-wide text-brand-cyan">Tizada (TizadaPro)</div>
                {puede && !abierto && (
                    <button type="button" disabled={busy} onClick={abrir} className="text-[11px] font-bold text-brand-cyan hover:underline">
                        {tizada ? 'Cambiar tizada' : 'Vincular tizada de TizadaPro'}
                    </button>
                )}
            </div>

            {!tizada && !abierto && <div className="text-[11px] text-slate-500 mt-1">Todavía no hay una tizada vinculada. {puede ? 'Generala en TizadaPro y después vinculala acá.' : 'La vincula el diseñador que tiene el trabajo.'}</div>}

            {tizada && res && (
                <div className="mt-1 space-y-1.5">
                    <div className="text-[11px] text-slate-700"><b>{tizada.MoldeNombre || res.molde}</b> · trabajo {tizada.TrabajoRef || tizada.TrabajoID} · {tizada.Piezas ?? res.piezas ?? '?'} piezas · {fmtFechaHora(tizada.FechaTizada)} · vinculó {tizada.UsuarioNombre || ''}</div>
                    <ul className="space-y-1">
                        {(res.hojas || []).map(h => {
                            const a = hojaSubida(h);
                            return (
                                <li key={h.archivo} className={`rounded-md border px-2 py-1.5 text-[11px] ${a ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                        <span><b>{h.material || h.tela}</b> · {fmtM(h.consumoCm)} de largo × {fmtM(h.anchoCm)} de ancho · {h.paginas} {h.paginas === 1 ? 'página' : 'páginas'}{h.aprovechamiento != null ? ` · ${h.aprovechamiento}% aprovechado` : ''}</span>
                                        {a ? <span className="font-black text-emerald-700">✓ PDF subido: {a.NombreOriginal}</span>
                                            : puede ? <BotonArchivo chico primario busy={busy} etiqueta={`Subir el PDF de esta hoja (${h.archivo})`} onFiles={(files) => onSubirHoja(files, h)} />
                                                : <span className="font-bold text-amber-700">Falta el PDF</span>}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                    {res.avisos?.length > 0 && <div className="text-[10px] text-amber-700">Avisos de TizadaPro: {res.avisos.join(' · ')}</div>}
                </div>
            )}

            {abierto && (
                <div className="mt-2 bg-white border border-slate-200 rounded-md p-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap mb-1.5">
                        <div className="text-[11px] font-bold text-slate-700">Tizadas terminadas en TizadaPro{lista?.moldeRef && !todas ? ' · solo del molde de este producto' : ''}</div>
                        <div className="flex items-center gap-2">
                            {lista?.moldeRef && <button type="button" onClick={() => { setTodas(!todas); cargar(!todas); }} className="text-[10px] font-bold text-slate-500 hover:underline">{todas ? 'Solo las del molde del producto' : `Ver todas (${lista.totalSinFiltro})`}</button>}
                            <button type="button" onClick={() => cargar(todas)} className="text-[10px] font-bold text-slate-500 hover:underline">↻ Actualizar</button>
                            <button type="button" onClick={() => setAbierto(false)} className="text-[10px] font-bold text-slate-400 hover:text-slate-600">Cancelar</button>
                        </div>
                    </div>
                    {cargando && <div className="text-[11px] text-slate-400 py-2">Leyendo TizadaPro…</div>}
                    {error && <div className="text-[11px] text-rose-700 font-bold py-1">{error}</div>}
                    {!cargando && !error && lista && lista.trabajos.length === 0 && (
                        <div className="text-[11px] text-slate-500 py-1">No hay tizadas terminadas{lista.moldeRef && !todas ? ' de este molde' : ''} en los últimos 15 días. Generala en TizadaPro y tocá ↻ Actualizar.</div>
                    )}
                    {!cargando && !error && lista && lista.trabajos.length > 0 && (
                        <ul className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                            {lista.trabajos.map(t => (
                                <li key={t.trabajoId} className="py-1.5 flex items-center justify-between gap-2 flex-wrap">
                                    <div className="text-[11px]">
                                        <div className="font-bold text-slate-700">{t.molde} <span className="font-normal text-slate-400">· {t.ref || t.trabajoId} · {fmtFechaHora(t.fecha)}</span></div>
                                        <div className="text-slate-500">{t.piezas ?? '?'} piezas · {t.hojas.map(h => `${h.material || h.tela} ${fmtM(h.consumoCm)}`).join(' · ')}</div>
                                        {t.hojas.some(h => !h.codArticulo) && <div className="text-rose-600 font-bold">Tiene una tela que no está en el catálogo de Sublimación.</div>}
                                    </div>
                                    <button type="button" disabled={busy || t.hojas.some(h => !h.codArticulo)} onClick={() => elegir(t)}
                                        className="text-[11px] font-black px-2.5 py-1 rounded-full bg-brand-cyan text-white disabled:opacity-50">
                                        {lista.moldeRef && t.moldeRef && lista.moldeRef !== t.moldeRef ? 'Usar igual (otro molde)' : 'Usar esta tizada'}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
        </div>
    );
}

function TelaCopias({ a, telas, puede, busy, onGuardar, soloCopias }) {
    const [copias, setCopias] = useState(a.Copias || 1);
    useEffect(() => { setCopias(a.Copias || 1); }, [a.Copias]);
    if (!puede && soloCopias) return <div className="text-[11px] mt-0.5 text-slate-700">{a.Copias || 1} {(a.Copias || 1) === 1 ? 'copia' : 'copias'}{a.AltoM ? ` · ${(Number(a.AltoM) * (a.Copias || 1)).toFixed(2)} m de film` : ''}</div>;
    if (!puede) {
        return (
            <div className={`text-[11px] mt-0.5 ${a.Material ? 'text-slate-700' : 'text-rose-600 font-bold'}`}>
                {a.Material ? <>Tela: <b>{a.Material}</b> · {a.Copias || 1} {(a.Copias || 1) === 1 ? 'copia' : 'copias'}</> : 'Falta elegir la tela (la elige el diseñador que tiene el trabajo)'}
            </div>
        );
    }
    const guardarCopias = () => { const n = parseInt(copias, 10); if (n >= 1 && n !== (a.Copias || 1)) onGuardar({ Copias: n }); else setCopias(a.Copias || 1); };
    return (
        <div className="flex flex-wrap items-end gap-1 mt-1">
            {!soloCopias && <label className={`text-[10px] ${a.Material ? 'text-slate-500' : 'text-rose-600 font-bold'}`}>{a.Material ? 'Tela de este archivo' : 'Falta elegir la tela de este archivo'}
                <Selector value={a.CodArticulo || ''} disabled={busy} onChange={e => { if (e.target.value) onGuardar({ CodArticulo: e.target.value, Copias: parseInt(copias, 10) || 1 }); }}
                    claseBoton={claseSel(`border rounded-lg px-2 py-1 text-xs max-w-[200px] font-normal ${a.Material ? 'border-slate-200' : 'border-rose-300'}`)} anchoLista={260}>
                    <option value="">Elegir la tela…</option>
                    {a.CodArticulo && !telas.some(t => t.CodArticulo === a.CodArticulo) && <option value={a.CodArticulo}>{a.Material}</option>}
                    {telas.map(t => <option key={t.CodArticulo} value={t.CodArticulo}>{t.Material}</option>)}
                </Selector>
            </label>}
            <label className="text-[10px] text-slate-500">{soloCopias ? 'Copias de este archivo' : 'Copias'}
                <input type="number" min="1" step="1" value={copias} disabled={busy} onChange={e => setCopias(e.target.value)} onBlur={guardarCopias}
                    className="block w-14 border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white text-slate-800" />
            </label>
            <span className="text-[10px] text-slate-400 pb-1">{soloCopias && a.AltoM ? `= ${(Number(a.AltoM) * (parseInt(copias, 10) || 1)).toFixed(2)} m de film · ` : ''}Se guarda solo al cambiar</span>
        </div>
    );
}

// Miniatura de un archivo de Drive. Si Drive no la da (archivo sin compartir, formato sin vista previa
// o todavía subiendo), muestra la extensión. El clic abre SIEMPRE el archivo real.
const driveIdDe = (url) => { const m = String(url || '').match(/\/d\/([a-zA-Z0-9_-]{10,})|[?&]id=([a-zA-Z0-9_-]{10,})/); return m ? (m[1] || m[2]) : null; };
function Miniatura({ a, tam = 64 }) {
    const [error, setError] = useState(false);
    const idDrive = driveIdDe(a.UrlDrive);
    const src = idDrive && !error ? `https://drive.google.com/thumbnail?id=${idDrive}&sz=w300` : null;
    const ext = (String(a.NombreOriginal || '').split('.').pop() || '').toUpperCase().slice(0, 4);
    return (
        // Tema claro (06/10): antes fp-mini / fp-mini-ext de fichaPedido.css, con los colores del tema oscuro
        <a href={a.UrlDrive} target="_blank" rel="noreferrer" style={{ width: tam, height: tam }} title={`Abrir "${a.NombreOriginal}"`}
            className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 transition-colors hover:border-brand-cyan">
            {src ? <img src={src} alt="" loading="lazy" onError={() => setError(true)} className="h-full w-full bg-white object-cover" /> : <span className="text-[11px] font-black text-slate-400">{ext || <FileText size={16} />}</span>}
        </a>
    );
}

// Quitar un archivo de la solicitud: la confirmación (06/10; antes window.confirm)
const quitarArchivo = (a) => ({ Icono: Trash2, titulo: 'Quitar el archivo', peligro: true, boton: 'Quitar', texto: `"${a.NombreOriginal}" sale de la solicitud. Queda registrado en el historial.` });

function ArchivosCelda({ archivos, vacio, puedeQuitar, onQuitar, conRol }) {
    const [dialogo, preguntar] = useConfirmar();
    if (!archivos.length) return <div className="text-slate-400">{vacio}</div>;
    return (
        <>
        <ul className="space-y-1.5">
            {archivos.map(a => (
                <li key={a.ArchivoID} className="flex items-start gap-2">
                    <Miniatura a={a} />
                    <div className="min-w-0">
                    <a href={a.UrlDrive} target="_blank" rel="noreferrer" className="font-bold text-brand-cyan hover:underline inline-flex items-center gap-1 break-all">{a.NombreOriginal}</a>
                    <div className="text-[10px] text-slate-500">
                        {conRol || a.Rol ? (ROL_ARCHIVO[a.Rol] || a.Rol) : ''} · {a.UsuarioNombre || ''} · {fmtFechaHora(a.FechaSubida)}
                        {puedeQuitar && onQuitar && <button onClick={async () => { if (await preguntar(quitarArchivo(a))) onQuitar(a); }} className="ml-2 text-rose-600 hover:underline inline-flex items-center gap-0.5"><Trash2 size={11} /> Quitar</button>}
                    </div>
                    </div>
                </li>
            ))}
        </ul>
        {dialogo}
        </>
    );
}

// Conversión del producto en pedido de producción: qué falta, el botón, y cómo quedó.
function Conversion({ s, p, pedido, faltantes, avisos = [], checklist, puedeVender, busy, hacer, id }) {
    const navigate = useNavigate();
    const usaTelaCliente = !!p.Datos?.corte?.activo && p.Datos.corte.origenTela === 'TELA CLIENTE';
    const [bobinas, setBobinas] = useState(null);         // null = todavía no se pidieron
    const [bobinaId, setBobinaId] = useState('');
    useEffect(() => {
        if (usaTelaCliente && puedeVender && !p.PedidoNoDocERP) svc.bobinas(id).then(setBobinas).catch(() => setBobinas([]));
    }, [usaTelaCliente, puedeVender, p.PedidoNoDocERP, id]);
    const [dialogo, preguntar] = useConfirmar();   // confirmación con el estilo del sistema (06/10; antes window.confirm)
    if (s.Estado === 'CANCELADA') return null;
    const creado = pedido && ['PASANDO_ARCHIVOS', 'CREADO', 'ERROR_ARCHIVOS'].includes(pedido.estado);
    const convertir = async () => {
        const ok = await preguntar({
            Icono: Factory, titulo: 'Crear el pedido de producción', boton: 'Crear el pedido',
            texto: `Producto "${p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? (p.ProductoNombre || p.ProIdProducto) : 'personalizado del cliente'}" (${p.Cantidad} prendas). Entra a producción igual que si lo cargaras en "Ventas → Pedido de prenda": se crean las órdenes de cada área y se les pasan los archivos de diseño pronto.`,
            nota: 'No se puede deshacer desde acá.',
        });
        if (!ok) return;
        hacer(() => svc.convertir(id, p.ProductoSolID, usaTelaCliente ? bobinaId : null));
    };

    if (creado || p.PedidoNoDocERP) {
        const arch = pedido?.archivos || [];
        const subidos = arch.filter(a => a.subido).length;
        const mal = pedido?.estado === 'ERROR_ARCHIVOS' || pedido?.archivosColgados;
        return (
            <div className={`rounded-xl border p-3 text-xs space-y-1 ${mal ? 'border-rose-200 bg-rose-50/60' : 'border-emerald-200 bg-emerald-50/60'}`}>
                <div className={`font-black flex items-center gap-1 ${mal ? 'text-rose-800' : 'text-emerald-800'}`}>
                    {pedido?.estado === 'PASANDO_ARCHIVOS' && !pedido.archivosColgados ? <Loader2 size={13} className="animate-spin" /> : mal ? <AlertTriangle size={13} /> : <CheckCircle2 size={13} />}
                    Pedido {pedido?.noDocERP || p.PedidoNoDocERP}{pedido ? ` — ${pedido.archivosColgados ? 'el pase de archivos quedó cortado a mitad de camino' : ESTADO_PEDIDO[pedido.estado]}` : ''}
                </div>
                {pedido?.codigosOrden?.length ? <div className="text-slate-700">Órdenes: <b>{pedido.codigosOrden.join(' · ')}</b></div> : null}
                {arch.length ? <div className="text-slate-600">Archivos en producción: {subidos} de {arch.length}</div> : null}
                {mal && (
                    <>
                        <ul className="list-disc pl-5 text-slate-700">{arch.filter(a => !a.subido).map((a, k) => <li key={k}>"{a.nombre}"{a.error ? `: ${a.error}` : ''}</li>)}</ul>
                        <div className="text-slate-600">Las órdenes que esperan estos archivos siguen en "Cargando…" y producción no las ve.</div>
                        {puedeVender && <button disabled={busy} onClick={() => hacer(() => svc.reintentarArchivos(id, p.ProductoSolID), 'Reintentando el pase de archivos a producción…')} className={BTN_PRIMARIO}><RefreshCw size={12} /> Volver a pasar los archivos que faltan</button>}
                        {/* Recuperar: si el archivo estaba mal (ej. tizada de 2 páginas), se rehace y se pasa a las órdenes que lo esperaban
                            (reactiva las que canceló la limpieza automática; un lugar por archivo). services/solicitudesVendedorRecuperar.js */}
                        {puedeVender && (
                            <div className="mt-2 border border-slate-200 rounded-lg p-2 space-y-1.5">
                                <div className="font-black text-slate-700">Si el archivo estaba mal: rehacerlo y pasarlo a este pedido</div>
                                <div className="text-[11px] text-slate-600">1) Rehacé el archivo{p.Config?.TizadaProMoldeRef ? ' (la tizada en TIZADA PRO)' : ' (subí el diseño pronto corregido en la pantalla de Diseño)'} y esperá que quede cargado. 2) Pasalo al pedido: se pone en las órdenes que lo esperaban, un archivo por mesa, y si la limpieza automática había cancelado alguna, se reactiva.</div>
                                <div className="flex flex-wrap gap-2">
                                    {p.Config?.TizadaProMoldeRef && (
                                        <button disabled={busy} className={BTN_SECUNDARIO} onClick={async () => { if (await preguntar({ Icono: Send, titulo: 'Rehacer la tizada', texto: 'Se manda de nuevo a TIZADA PRO con los diseños, el arte y la lista guardados.', nota: 'Cuando vuelva, la tizada nueva reemplaza a los diseños prontos de la solicitud. Todavía no toca el pedido.', boton: 'Mandarla' })) hacer(async () => { const r = await svc.tizadaProEnviar(id, p.ProductoSolID, false); if (r.Estado === 'RECHAZADO') toast.error(`TIZADA no lo acepta: ${r.mensaje || 'mirá las alarmas en el bloque de TIZADA PRO'}.`); else toast.success(`Mandado a TIZADA PRO (${r.Referencia}). Cuando diga "Tizada cargada", pasala al pedido.`); }); }}>
                                            <Send size={12} /> 1. Rehacer la tizada en TIZADA PRO
                                        </button>
                                    )}
                                    <button disabled={busy} className={BTN_PRIMARIO} onClick={async () => { if (await preguntar({ Icono: RefreshCw, titulo: 'Pasar la tizada nueva al pedido', texto: `Se pasan los archivos de diseño pronto actuales de la producción principal al pedido ${pedido?.noDocERP || ''}: van a las órdenes que los esperaban, un archivo por mesa. Si la limpieza automática canceló alguna, se reactiva.`, nota: 'Antes se controla que cada PDF tenga 1 página.', boton: 'Pasarlos' })) hacer(async () => { const r = await svc.recuperarArchivos(id, p.ProductoSolID); toast.success(`Pasando a producción: ${(r.ordenes || []).map(o => `${o.codigo}${o.reactivada ? ' (reactivada)' : ''} · ${o.archivos} archivo(s)`).join(' · ')}`); }); }}>
                                        <RefreshCw size={12} /> 2. Pasar la tizada nueva al pedido
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        );
    }

    return (
        <div className="text-xs space-y-2">
            {dialogo}
            <EstadoProduccionPanel ch={checklist || { listo: faltantes.length === 0, faltan: faltantes, ok: [], luego: [] }} />
            {faltantes.length ? (
                <>
                    <div className="mt-2 text-[11px] text-slate-600 bg-white border border-slate-200 rounded-lg p-2">
                        <b>Dónde se completa cada cosa:</b> la <b>tela y las copias</b> las carga el diseñador en esta misma tabla, columna "Diseño pronto", debajo de cada archivo (se guardan solas al cambiar).
                        Los <b>datos de un servicio</b> (tipo / variante, material, cantidades) se cargan en
                        {' '}{puedeVender ? <button type="button" onClick={() => navigate(`/ventas/solicitudes/${id}/editar`)} className="text-brand-cyan font-bold hover:underline">Editar solicitud</button> : <b>Editar solicitud</b>}
                        {' '}y se guardan con "Guardar cambios de la solicitud". Los <b>archivos</b> se guardan solos al subirlos.
                    </div>
                </>
            ) : null}

            {avisos.length > 0 && (
                <div className="mt-2 bg-white border border-sky-200 rounded-lg p-2">
                    <div className="font-black text-sky-800">No frena la conversión — esto se termina después, en producción:</div>
                    <ul className="list-disc pl-5 text-slate-700 space-y-0.5">{avisos.map((a, k) => <li key={k}>{a}</li>)}</ul>
                </div>
            )}

            {pedido && ['RECHAZADO', 'ERROR'].includes(pedido.estado) && (
                <div className="mt-2 bg-white border border-rose-200 rounded-lg p-2">
                    <div className="font-black text-rose-700">{ESTADO_PEDIDO[pedido.estado]}</div>
                    <ul className="list-disc pl-5 text-slate-700">{pedido.errores.map((e, k) => <li key={k}>{e.mensaje}</li>)}</ul>
                    <div className="text-slate-500 mt-1">No se creó ninguna orden. Corregí y volvé a convertir.</div>
                </div>
            )}

            {puedeVender && usaTelaCliente && (
                <label className="block mt-2 text-[11px] font-bold text-slate-700">Bobina de tela del cliente (se le descuentan los metros del pedido)
                    <Selector value={bobinaId} onChange={e => setBobinaId(e.target.value)} claseBoton={claseSel('mt-1 w-full max-w-xl border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-normal')} anchoLista={520}>
                        <option value="">{bobinas === null ? 'Cargando bobinas…' : bobinas.length ? 'Elegir la bobina…' : 'El cliente no tiene bobinas con metros disponibles'}</option>
                        {(bobinas || []).map(b => <option key={b.BobinaID} value={b.BobinaID}>{(b.DescripcionTela || 'Tela sin descripción').trim()} · {b.CodigoEtiqueta} · {Number(b.MetrosRestantes).toFixed(2)} m de largo · {Number(b.AnchoReal ?? b.Ancho ?? 0).toFixed(2)} m de ancho</option>)}
                    </Selector>
                </label>
            )}

            {puedeVender && (
                <button disabled={busy || faltantes.length > 0 || (usaTelaCliente && !bobinaId)} onClick={convertir} className={`${BTN_PRIMARIO} mt-2`} title={faltantes.length ? 'Primero completá lo que falta' : ''}>
                    Convertir en pedido de producción
                </button>
            )}
        </div>
    );
}

function ListaArchivos({ titulo, archivos, puedeQuitar, onQuitar, onSustituir, destacado }) {
    const [dialogo, preguntar] = useConfirmar();
    if (!archivos.length) return destacado ? <p className="text-[11px] text-slate-400">Diseño pronto: todavía no hay archivo.</p> : null;
    return (
        <div>
            <div className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1">{titulo}</div>
            <ul className="space-y-1">
                {archivos.map(a => (
                    <li key={a.ArchivoID} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${destacado ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50'}`}>
                        <a href={a.UrlDrive} target="_blank" rel="noreferrer" className="font-bold text-brand-cyan hover:underline inline-flex items-center gap-1 break-all"><FileText size={12} /> {a.NombreOriginal}</a>
                        <span className="text-[10px] text-slate-500 flex items-center gap-2">
                            {ROL_ARCHIVO[a.Rol] || a.Rol}{a.AnchoM && a.AltoM ? ` · ${Number(a.AnchoM).toFixed(2)} × ${Number(a.AltoM).toFixed(2)} m` : ''} · {a.UsuarioNombre || ''} · {fmtFechaHora(a.FechaSubida)}
                            {onSustituir && <BotonArchivo etiqueta="Sustituir por el archivo corregido" chico onFiles={(files) => onSustituir(a, files)} />}
                            {puedeQuitar && onQuitar && <button onClick={async () => { if (await preguntar(quitarArchivo(a))) onQuitar(a); }} className="text-rose-600 hover:underline inline-flex items-center gap-0.5"><Trash2 size={11} /> Quitar</button>}
                        </span>
                    </li>
                ))}
            </ul>
            {dialogo}
        </div>
    );
}

function BotonArchivo({ etiqueta, onFiles, busy, multiple, primario, chico }) {
    const ref = useRef(null);
    return (
        <>
            <input ref={ref} type="file" hidden multiple={!!multiple} onChange={e => { const fs = e.target.files; if (fs?.length) onFiles(fs); e.target.value = ''; }} />
            <button type="button" disabled={busy} onClick={() => ref.current?.click()} className={chico ? 'text-brand-cyan font-bold hover:underline inline-flex items-center gap-0.5' : (primario ? BTN_PRIMARIO : BTN_SECUNDARIO)}><Upload size={chico ? 11 : 12} /> {etiqueta}</button>
        </>
    );
}

function BotonSubir({ roles, onFiles, busy }) {
    const [rol, setRol] = useState(roles[0]);
    return (
        <span className="inline-flex items-center gap-1">
            <Selector value={rol} onChange={e => setRol(e.target.value)} claseBoton={claseSel('border border-slate-200 rounded-lg px-2 py-1.5 text-xs')} anchoLista={260}>
                {roles.map(r => <option key={r} value={r}>{ROL_ARCHIVO[r]}</option>)}
            </Selector>
            <BotonArchivo busy={busy} multiple etiqueta="Adjuntar archivo" onFiles={(files) => onFiles(files, rol)} />
        </span>
    );
}

function PrecioSena({ s, puede, busy, hacer }) {
    const [editando, setEditando] = useState(false);
    const [f, setF] = useState({});
    const [sena, setSena] = useState({ SenaVia: '', SenaMonto: '', SenaReferencia: '' });
    const abrir = () => { setF({ ModoCobro: s.ModoCobro || 'PRECIO_ESTABLECIDO', PrecioPactado: s.PrecioPactado ?? '', MonIdMoneda: s.MonIdMoneda || 1, RequiereSena: !!s.RequiereSena, SenaMontoRequerido: s.SenaMontoRequerido ?? '' }); setEditando(true); };

    return (
        <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
                <h2 className="text-[10px] font-black uppercase tracking-wide text-slate-500">Precio pactado y seña</h2>
                {puede && !editando && <button onClick={abrir} className="text-xs font-bold text-brand-cyan hover:underline">{s.ModoCobro ? 'Cambiar' : 'Cargar precio pactado'}</button>}
            </div>

            {!editando ? (
                <div className="grid grid-cols-2 gap-3 text-xs">
                    <Info l="Cómo se cobra" v={!s.ModoCobro ? <span className="text-rose-600 font-bold">Sin pactar</span> : s.ModoCobro === 'POR_AREA' ? 'Se factura por cada área' : 'Precio establecido (todo incluido)'} />
                    <Info l="Precio de la solicitud" v={s.ModoCobro === 'PRECIO_ESTABLECIDO' ? <b>{plata(s.PrecioPactado, s.MonIdMoneda)}</b> : '—'} />
                    <Info l="Seña" v={!s.RequiereSena ? 'No requiere' : <>Requiere <b>{plata(s.SenaMontoRequerido, s.MonIdMoneda)}</b></>} />
                    {s.RequiereSena ? <Info l="Estado de la seña" v={s.SenaConfirmada ? <span className="text-emerald-700 font-bold">Confirmada</span> : <span className="text-rose-600 font-bold">Sin confirmar — frena la conversión a pedido</span>} /> : null}
                </div>
            ) : (
                <div className="space-y-2">
                    <Campo label="Cómo se cobra">
                        <Selector value={f.ModoCobro} onChange={e => setF(x => ({ ...x, ModoCobro: e.target.value }))} claseBoton={claseSel(SEL_CAMPO)} anchoLista={320}>
                            <option value="PRECIO_ESTABLECIDO">Precio establecido (un total, todo incluido)</option>
                            <option value="POR_AREA">Facturar por cada área</option>
                        </Selector>
                    </Campo>
                    <div className="grid grid-cols-3 gap-2">
                        <Campo label="Moneda"><Selector value={String(f.MonIdMoneda)} onChange={e => setF(x => ({ ...x, MonIdMoneda: Number(e.target.value) }))} claseBoton={claseSel(SEL_CAMPO)}>{Object.entries(MONEDA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Selector></Campo>
                        {f.ModoCobro === 'PRECIO_ESTABLECIDO' && <div className="col-span-2"><Campo label="Precio de la solicitud entera"><input type="number" min="0" step="0.01" value={f.PrecioPactado} onChange={e => setF(x => ({ ...x, PrecioPactado: e.target.value }))} className={INPUT} /></Campo></div>}
                    </div>
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700"><input type="checkbox" checked={f.RequiereSena} onChange={e => setF(x => ({ ...x, RequiereSena: e.target.checked }))} /> Requiere seña inicial</label>
                    {f.RequiereSena && <Campo label="Monto de la seña requerida"><input type="number" min="0" step="0.01" value={f.SenaMontoRequerido} onChange={e => setF(x => ({ ...x, SenaMontoRequerido: e.target.value }))} className={INPUT} /></Campo>}
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setEditando(false)} className={BTN_SECUNDARIO}>Descartar</button>
                        <button disabled={busy} onClick={async () => { if (await hacer(() => svc.guardarPrecio(s.SolicitudID, f), 'Precio pactado guardado.')) setEditando(false); }} className={BTN_PRIMARIO}>Guardar precio pactado</button>
                    </div>
                </div>
            )}

            {s.RequiereSena && s.SenaConfirmada ? (
                <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-slate-700">
                    <b>{plata(s.SenaMonto, s.MonIdMoneda)}</b> por {s.SenaVia} · ref. {s.SenaReferencia}<br />
                    Confirmó {s.SenaConfirmadaPorNombre || '—'} el {fmtFechaHora(s.SenaFechaConfirma)}
                </div>
            ) : null}

            {puede && s.RequiereSena && !editando ? (
                <div className="border-t border-slate-100 pt-3 space-y-2">
                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">{s.SenaConfirmada ? 'Corregir los datos de la seña' : 'Confirmar la seña'}</div>
                    <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">Esto es solo un dato de la solicitud: <b>no ingresa plata en la cuenta del cliente</b>. El saldo lo ingresan Administración y Caja.</p>
                    <Campo label="Vía de entrada del dinero"><input value={sena.SenaVia} onChange={e => setSena(x => ({ ...x, SenaVia: e.target.value }))} placeholder="Ej: transferencia BROU, efectivo en caja, Mercado Pago" className={INPUT} /></Campo>
                    <div className="grid grid-cols-2 gap-2">
                        <Campo label="Monto"><input type="number" min="0" step="0.01" value={sena.SenaMonto} onChange={e => setSena(x => ({ ...x, SenaMonto: e.target.value }))} className={INPUT} /></Campo>
                        <Campo label="Referencia del pago"><input value={sena.SenaReferencia} onChange={e => setSena(x => ({ ...x, SenaReferencia: e.target.value }))} className={INPUT} /></Campo>
                    </div>
                    <button disabled={busy} onClick={async () => { if (await hacer(() => svc.confirmarSena(s.SolicitudID, sena), 'Seña confirmada en la solicitud.')) setSena({ SenaVia: '', SenaMonto: '', SenaReferencia: '' }); }} className={BTN_PRIMARIO}><CheckCircle2 size={12} /> {s.SenaConfirmada ? 'Guardar corrección de la seña' : 'Confirmar seña'}</button>
                </div>
            ) : null}
        </section>
    );
}

function Interacciones({ s, puede, busy, hacer, subir }) {
    const [texto, setTexto] = useState('');
    const [files, setFiles] = useState([]);
    const ref = useRef(null);
    const lista = s.Eventos.filter(e => e.Tipo === 'INTERACCION');

    const registrar = async () => {
        let eventoId = null;
        const ok = await hacer(async () => { eventoId = (await svc.agregarInteraccion(s.SolicitudID, texto.trim())).EventoID; }, 'Interacción registrada.');
        if (!ok) return;
        if (files.length && eventoId) await subir(files, { Rol: 'REFERENCIA', EventoID: eventoId });
        setTexto(''); setFiles([]);
    };

    return (
        <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <h2 className="text-[10px] font-black uppercase tracking-wide text-slate-500 flex items-center gap-1"><MessageSquare size={12} /> Interacciones con el cliente</h2>
            {puede && (
                <div className="space-y-2">
                    <textarea rows={3} value={texto} onChange={e => setTexto(e.target.value)} placeholder="Qué pidió, aclaró o aprobó el cliente…" className={INPUT} />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-[11px] text-slate-500">
                            <input ref={ref} type="file" hidden multiple onChange={e => { setFiles(Array.from(e.target.files || [])); e.target.value = ''; }} />
                            <button type="button" onClick={() => ref.current?.click()} className="text-brand-cyan font-bold hover:underline inline-flex items-center gap-1"><Paperclip size={12} /> {files.length ? `${files.length} archivo(s) para adjuntar` : 'Adjuntar archivos a la interacción'}</button>
                        </span>
                        <button disabled={busy || !texto.trim()} onClick={registrar} className={BTN_PRIMARIO}>Registrar interacción</button>
                    </div>
                </div>
            )}
            {lista.length === 0 ? <p className="text-xs text-slate-400">Todavía no hay interacciones registradas.</p> : (
                <ul className="space-y-2">
                    {lista.map(ev => (
                        <li key={ev.EventoID} className="text-xs bg-slate-50 rounded-lg p-2">
                            <div className="text-[10px] text-slate-400">{fmtFechaHora(ev.Fecha)} · <b className="text-slate-600">{ev.UsuarioNombre}</b></div>
                            <div className="text-slate-700 whitespace-pre-line">{ev.Texto}</div>
                            {s.Archivos.filter(a => a.EventoID === ev.EventoID && a.Vigente).map(a => <a key={a.ArchivoID} href={a.UrlDrive} target="_blank" rel="noreferrer" className="block text-brand-cyan font-bold hover:underline mt-1"><FileText size={11} className="inline" /> {a.NombreOriginal}</a>)}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

// Ficha de ingreso a producción (cabecera): muestra, plazo, dónde se cose, indicaciones, notas internas.
function FichaIngreso({ s }) {
    const f = s.Ficha || {};
    const mu = f.muestra || {};
    const si = (v) => (v ? <span className="text-emerald-700 font-bold">Sí</span> : <span className="text-rose-600 font-bold">No</span>);
    return (
        <div className="border-t border-slate-100 pt-3">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 mb-2">Ficha de ingreso a producción</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <Info l="Dónde se cose" v={f.dondeSeCose === 'EXTERNO' ? `Taller externo${f.tallerExterno ? `: ${f.tallerExterno}` : ' (sin nombre)'}` : 'Nuestro taller'} />
                {mu.ofrecida && <Info l="Muestra" v={<>Ofrecida · {RESPUESTA_MUESTRA[mu.respuesta] || <span className="text-rose-600 font-bold">respuesta sin registrar</span>}{mu.respuesta !== 'RECHAZO' && <> · aprobada: {si(mu.aprobada)}</>}</>} />}
                <Info l="Fecha que necesita el cliente" v={s.FechaEntrega ? `${fmtFecha(s.FechaEntrega)}${s.FechaEntregaHasta ? ` → ${fmtFecha(s.FechaEntregaHasta)}` : ''}` : <span className="text-rose-600 font-bold">Sin fecha</span>} />
                {f.indicaciones && <div className="col-span-2"><Info l="Indicaciones del cliente" v={<span className="whitespace-pre-line">{f.indicaciones}</span>} /></div>}
                {f.notasInternas && <div className="col-span-full"><Info l="Notas internas (taller)" v={<span className="whitespace-pre-line">{f.notasInternas}</span>} /></div>}
            </div>
        </div>
    );
}

// Datos de la ficha por producto: cómo se define, producto nuevo, medidas / talles, especificaciones, diseño.
function DatosProducto({ d }) {
    const e = d.espec || {};
    const dis = d.diseno || {};
    const marcas = [d.productoNuevo && 'Producto nuevo', d.produccionGrande && 'Producción grande', d.muestraFisica && 'Muestra física o molde del cliente', d.requiereMuestra && (d.muestraAprobada ? 'Muestra: aprobada por el cliente' : 'Muestra: requiere confección, SIN aprobar'), d.tablaEstandar && 'Tabla de medidas estándar del taller', d.personalizacion && (d.listaCerrada ? 'Nombres y números: lista cerrada' : 'Nombres y números: lista SIN cerrar')].filter(Boolean);
    return (
        <>
            {d.tipoTrabajo && <Info l="Tipo de trabajo" v={d.tipoTrabajo} />}
            <Info l="Cómo se define" v={d.comoSeDefine === 'MEDIDA' ? 'Por medidas en cm' : 'Por talle'} />
            {marcas.length > 0 && <Info l="Marcas" v={marcas.join(' · ')} />}
            {d.comoSeDefine === 'MEDIDA' ? (
                <>
                    <Info l="Medidas y cantidad por medida" v={d.medidas ? <span className="whitespace-pre-line">{d.medidas}</span> : <span className="text-rose-600">Sin cargar</span>} />
                    <Info l="Terminación / costura" v={d.terminacion || <span className="text-rose-600">Sin cargar</span>} />
                </>
            ) : (
                <>
                    {d.notaTalles && <Info l="Nota sobre los talles" v={d.notaTalles} />}
                    {d.medidasPrenda && <Info l="Medidas de la prenda" v={<span className="whitespace-pre-line">{d.medidasPrenda}</span>} />}
                </>
            )}
            {d.productoNuevo && (
                <div className="col-span-full grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-50 rounded-lg p-2">
                    <Info l="Costuras" v={e.costuras || '—'} /><Info l="Terminaciones" v={e.terminaciones || '—'} /><Info l="Avíos y accesorios" v={e.avios || '—'} />
                    <Info l="Tela e insumos" v={<>{e.tela || '—'}{e.provee ? <div className="text-[10px] text-slate-500">provee: {e.provee === 'TALLER' ? 'el taller' : 'el cliente'}</div> : null}</>} />
                </div>
            )}
            {dis.origen && <Info l="Diseño" v={dis.origen === 'NO' ? 'No lleva diseño' : dis.origen === 'CLIENTE' ? <>Lo entrega el cliente · archivo verificado: {dis.verificado ? 'sí' : 'no'}</> : <>Lo hace el taller · propuesta aprobada por escrito: {dis.aprobado ? 'sí' : 'no'}</>} />}
        </>
    );
}

// ¿Se llega a la fecha que pide el cliente? Recorre los sectores por los que va a pasar el pedido,
// en orden, sobre la cola REAL de cada uno (el mismo motor de Planificación), y compara la última
// fecha contra la fecha de entrega. Es una estimación: no crea nada ni reserva capacidad.
const VEREDICTO = {
    SI: { txt: 'Se llega', cls: 'bg-emerald-50 text-emerald-800 border-emerald-300' },
    RIESGO: { txt: 'Justo — en riesgo', cls: 'bg-amber-50 text-amber-800 border-amber-300' },
    NO: { txt: 'NO se llega', cls: 'bg-rose-50 text-rose-800 border-rose-300' },
    SIN_FECHA: { txt: 'Falta la fecha de entrega para comparar', cls: 'bg-slate-50 text-slate-700 border-slate-300' },
    SIN_DATOS: { txt: 'No se pudo proyectar ningún sector', cls: 'bg-slate-50 text-slate-700 border-slate-300' },
};
function PanelPlazo({ s, id }) {
    const [r, setR] = useState(null);
    const [busy, setBusy] = useState(false);
    const calcular = async () => { setBusy(true); try { setR(await svc.estimarPlazo(id)); } catch (e) { toast.error(errorDe(e)); } finally { setBusy(false); } };
    useEffect(() => { if (s.FechaEntrega) calcular(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id, s.FechaEntrega]);
    const v = r ? (VEREDICTO[r.veredicto] || VEREDICTO.SIN_DATOS) : null;
    const f = (d) => (d ? d.split('-').reverse().join('/') : '—');
    return (
        <div className="border-t border-slate-100 pt-3 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 flex items-center gap-1"><CalendarClock size={12} /> ¿Se llega a la fecha de entrega? — carga real de cada sector</div>
                <button onClick={calcular} disabled={busy} className={BTN_SECUNDARIO}>{busy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {r ? 'Recalcular' : 'Calcular con la carga de hoy'}</button>
            </div>
            {!r && !busy && <div className="text-slate-500">{s.FechaEntrega ? 'Calculando…' : 'Cargá la fecha que necesita el cliente (Editar solicitud) y se calcula solo.'}</div>}
            {r && (
                <>
                    <div className={`rounded-xl border p-3 ${v.cls}`}>
                        <div className="text-sm font-black">{v.txt}{r.margenDias !== null && r.veredicto !== 'SIN_FECHA' ? ` · ${r.margenDias >= 0 ? `${r.margenDias} día${r.margenDias === 1 ? '' : 's'} de margen` : `${-r.margenDias} día${-r.margenDias === 1 ? '' : 's'} tarde`}` : ''}</div>
                        <div className="mt-0.5">Entrando hoy al final de la cola de cada sector, el pedido terminaría el <b>{f(r.fechaEstimadaFin)}</b>{r.fechaEntrega ? <> · el cliente lo necesita el <b>{f(r.fechaEntrega)}</b></> : null}.</div>
                        {r.sinProyeccion.length > 0 && <div className="mt-1 text-[11px]">Sin proyectar (no tienen cargada la velocidad de sus máquinas en Configuración → Equipos): <b>{r.sinProyeccion.join(', ')}</b>. La fecha de arriba no los cuenta.</div>}
                        <div className="mt-1 text-[11px] opacity-80">Es una estimación con la cola de hoy: no reserva lugar.</div>
                    </div>
                    {r.productos.map(p => (
                        <div key={p.productoSolId} className="overflow-x-auto">
                            {r.productos.length > 1 && <div className="font-bold text-slate-700 mb-1">{p.nombre} · {p.prendas} prendas → {f(p.fechaEstimadaFin)}</div>}
                            <table className="w-full text-[11px]">
                                <thead><tr className="text-[9px] font-black uppercase text-slate-400 text-left"><th className="py-1 pr-2">Sector</th><th className="py-1 pr-2">Trabajo de este pedido</th><th className="py-1 pr-2">Cola actual del sector</th><th className="py-1 pr-2">Empieza después de</th><th className="py-1">Terminaría</th></tr></thead>
                                <tbody>
                                    {p.sectores.map(x => (
                                        <tr key={x.area} className="border-t border-slate-100">
                                            <td className="py-1 pr-2 font-bold text-slate-800">{x.nombre}</td>
                                            <td className="py-1 pr-2 text-slate-600">{x.nota}{x.estimada ? <span className="text-amber-700"> (estimado)</span> : null}</td>
                                            <td className="py-1 pr-2 text-slate-600">{x.tieneCapacidad && x.carga ? `${x.carga.ordenes} órdenes · ${Math.round(x.carga.pendiente)} ${x.carga.unidad || ''} pendientes · ${x.carga.capacidadDia != null ? `${Math.round(x.carga.capacidadDia)} ${x.carga.unidad || ''}/día` : ''}` : <span className="text-rose-600">sin capacidad cargada</span>}</td>
                                            <td className="py-1 pr-2 text-slate-500">{x.empiezaDespuesDe.length ? x.empiezaDespuesDe.join(' y ') : 'hoy'}</td>
                                            <td className={`py-1 font-bold ${x.fechaEstimada && r.fechaEntrega && x.fechaEstimada > r.fechaEntrega ? 'text-rose-700' : 'text-slate-800'}`}>{x.fechaEstimada ? f(x.fechaEstimada) : '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                </>
            )}
        </div>
    );
}
