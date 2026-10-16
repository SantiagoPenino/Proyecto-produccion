import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, ArrowLeftRight, Ban, CalendarClock, CheckCircle2, ClipboardList, Factory, FileText, History, Loader2, MessageSquare, Paperclip, Pencil, Plus, Printer, RefreshCw, RotateCcw, Send, Shirt, Trash2, Upload, X } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { fileService } from '../../../client-portal/api/fileService';
import api from '../../../services/apiClient';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFecha, fmtFechaHora } from '../../../utils/fechas';
import { PIDE_APROBACION_ESCRITA, PIDE_MUESTRA_APROBADA, RESPUESTA_MUESTRA } from './checklistSolicitud';
import SolicitudVendedorForm from './SolicitudVendedorForm';   // [FASE 2 15/10] embebido: se edita en el lugar
import OrderDetailModal from '../../production/components/OrderDetailModal';
import {
    BTN_PELIGRO, BTN_PRIMARIO, BTN_SECUNDARIO, Campo, ESTADO_PARTE, ESTADO_SOLICITUD, INPUT, Info, MONEDA, MotivoModal,
    NOMBRE_PARTE, ROL_ARCHIVO, Checklist, SEL_CAMPO, TIPO_TRABAJO, VisorPdf, claseSel, errorDe, plata, useConfirmar,
    Ventana, BTN_GRANDE_SI, BTN_GRANDE_NO, Miniatura, usePiezasArte, piezaDelArte, TarjetaPieza, PiezaConArte,
    BuscadorCliente, avisarGuardado, BotonAyuda,
} from './solicitudesComunes';
import Selector from '../../ui/Selector';
import SelectorFecha from '../../ui/SelectorFecha';
import EstadoProduccionPanel from './EstadoProduccionPanel';
import TizadaProBloque from './TizadaProBloque';
import { HojaMedidas } from '../ConfiguradorMedidas';   // [MEDIDAS]
import { REFRESCAR_SI_MAS_DE_MS, cargarPerfil, perfilPrecargado, tomarPrecarga, verPrecarga } from './solicitudPrecarga';
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

// Hacer una acción o subir archivos sobre la solicitud, con el aviso y la recarga de siempre. Lo usan el detalle y el
// pedido que el cliente arma en la Tienda del portal (client-portal/modulos/PedidoTiendaView.jsx).
export function useAccionesSolicitud(id, cargar) {
    const [busy, setBusy] = useState(false);
    const [subida, setSubida] = useState(null);           // { nombre, pct }
    const hacer = async (fn, okMsg) => {
        setBusy(true);
        try { await fn(); if (okMsg) toast.success(okMsg); await cargar(); return true; }
        catch (e) { toast.error(errorDe(e)); return false; }
        finally { setBusy(false); }
    };
    // Devuelve lo que se subió ({ ArchivoID, … } de cada archivo), por si quien llama tiene que usarlo (portal a medida)
    const subir = async (files, campos, tipoParte) => {
        const lista = Array.from(files || []);
        if (!lista.length) return [];
        setBusy(true);
        const hechos = [];
        try {
            for (const f of lista) {
                const medida = campos.Rol === 'DISENO_PRONTO' && !campos.TizadaID ? await medirDisenoPronto(f, tipoParte) : {};
                setSubida({ nombre: f.name, pct: 0 });
                hechos.push(await svc.subirArchivo(id, f, { ...campos, ...medida }, (loaded, total) => setSubida({ nombre: f.name, pct: total ? Math.round((loaded / total) * 100) : 0 })));
            }
            toast.success(lista.length === 1 ? 'Archivo guardado.' : `${lista.length} archivos guardados.`);
        } catch (e) { toast.error(errorDe(e)); }
        finally { setSubida(null); setBusy(false); await cargar(); }
        return hechos;
    };
    return { busy, subida, hacer, subir };
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
    // Lo que la lista pidió al pasar el mouse (solicitudPrecarga.js): acá solo se LEE (el render de montaje puede
    // repetirse); se consume en el efecto, una sola vez.
    const [s, setS] = useState(verPrecarga(id)?.data ?? null);
    const [perfil, setPerfil] = useState(() => perfilPrecargado() || { esVendedor: false, esDisenador: false, esAdmin: false });
    // Si abrió sin datos (entrada directa por la URL), el contenido entra con un fundido después del esqueleto.
    const conEsqueleto = useRef(!s);
    const precargaUsada = useRef(false);
    const [cancelando, setCancelando] = useState(false);
    const [tab, setTab] = useState(null);                 // 'resumen' | 'prod-<id>' | 'precio' | 'interacciones' | 'historial'
    const [telas, setTelas] = useState([]);               // telas de sublimación (las elige el diseñador por archivo)
    const [ficha, setFicha] = useState(null);             // orden de producción abierta en su ficha (la misma del ojito)
    const [generandoFicha, setGenerandoFicha] = useState(false);
    const [pdf, setPdf] = useState(null);                 // ficha del pedido generada (Blob) → visor
    // [FASE 2 15/10] Qué se está editando en el lugar (ya no hay "Editar solicitud"): 'nuevo' | ProductoSolID ("Cambiar producto").
    // La identificación, la cantidad y el precio se guardan solos (guardado automático, 15/10).
    const [editando, setEditando] = useState(null);
    const [irAlUltimo, setIrAlUltimo] = useState(false);  // después de agregar un producto, se abre su pestaña
    useEffect(() => {
        if (!irAlUltimo || !s?.Productos?.length) return;
        setTab(`prod-${s.Productos[s.Productos.length - 1].ProductoSolID}`);
        setIrAlUltimo(false);
    }, [s]);   // eslint-disable-line react-hooks/exhaustive-deps
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
        // [15/10] Nueva solicitud (sin id): la misma pantalla, todavía sin nada que traer
        if (!id) { cargarPerfil().then(setPerfil).catch(() => { }); return; }
        if (!precargaUsada.current) {   // StrictMode repite el efecto: la carga inicial va una sola vez
            precargaUsada.current = true;
            const pre = tomarPrecarga(id);
            if (pre?.data) { if (Date.now() - pre.at > REFRESCAR_SI_MAS_DE_MS) cargar(); }   // ya está en pantalla; si es vieja se refresca por detrás
            else if (pre) pre.p.then(setS).catch(() => cargar());
            else cargar();
        }
        cargarPerfil().then(setPerfil).catch(() => { });
        svc.materialesPrincipal().then(setTelas).catch(() => setTelas([]));
    }, [id, cargar]);

    // Mientras un pedido está pasando sus archivos a producción, se refresca solo.
    const pasando = !!s?.Conversion?.some(c => ['PROCESANDO', 'PASANDO_ARCHIVOS'].includes(c.pedido?.estado) && !c.pedido?.archivosColgados);
    useEffect(() => {
        if (!pasando) return undefined;
        const t = setInterval(cargar, 5000);
        return () => clearInterval(t);
    }, [pasando, cargar]);

    const { busy, subida, hacer, subir } = useAccionesSolicitud(id, cargar);
    // [GUARDADO AUTOMÁTICO 15/10] Cada dato se guarda solo (sin "Editar" ni "Guardar"): avisa al indicador "Guardado" del
    // encabezado y recarga la solicitud. Devuelve si se guardó; si no, el campo vuelve a lo guardado y el motivo queda arriba.
    const autoGuardar = useCallback(async (fn) => {
        avisarGuardado('guardando');
        try { await fn(); await cargar(); avisarGuardado('ok'); return true; }
        catch (e) { avisarGuardado('error', errorDe(e)); toast.error(errorDe(e)); return false; }
    }, [cargar]);
    const guardarDato = (datos) => autoGuardar(() => svc.guardarDatos(id, datos));

    // [15/10] Nueva solicitud: la MISMA pantalla (encabezado y pestañas), con Identificación y Producto para completar en el
    // Resumen. Al crearla queda en la solicitud (las demás pestañas se habilitan: arte, lista, precio y seña…).
    if (!id) {
        const PESTANAS_NUEVA = ['Resumen', 'Producto 1', 'Precio y seña', 'Interacciones', 'Historial'];
        return (
            <div className="p-3 md:p-6 space-y-4 animate-entrar-pagina">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                        <ClipboardList size={30} className="mt-1 shrink-0 text-brand-cyan" aria-hidden="true" />
                        <div className="min-w-0">
                            <span className={`${PASTILLA} bg-sky-50 text-sky-700`}>Nueva</span>
                            <h1 className="mt-1 text-2xl font-black leading-tight text-slate-800">Nueva solicitud</h1>
                            <p className="text-sm text-slate-500">El cliente y el producto. Al crearla seguís acá: el arte, la lista de jugadores, los extras y el precio.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" onClick={() => navigate('/ventas/solicitudes')} className={BTN_SECUNDARIO}><ArrowLeft size={14} /> Volver</button>
                        <BotonAyuda guia="vendedores" />
                    </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl">
                    <div className="flex flex-wrap gap-1 border-b border-slate-200 px-2">
                        {PESTANAS_NUEVA.map((t, i) => (
                            <span key={t} title={i ? 'Se habilita al crear la solicitud' : undefined}
                                className={`-mb-px inline-flex items-center border-b-2 px-3 py-2.5 text-sm font-bold ${i ? 'border-transparent text-slate-300 cursor-not-allowed' : 'border-brand-cyan text-brand-cyan'}`}>{t}</span>
                        ))}
                    </div>
                    <div className="p-4">
                        <SolicitudVendedorForm embebido={{ id: null, bloques: [1, 3], onCancelar: () => navigate('/ventas/solicitudes') }} />
                    </div>
                </div>
            </div>
        );
    }

    if (!s) return <EsqueletoDetalle />;

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
    // [FASE 2 15/10] Editar en el lugar: el mismo formulario, embebido (sus reglas y su guardado); al guardar se recarga
    const editor = (cfg) => (
        <SolicitudVendedorForm key={JSON.stringify(cfg)} embebido={{ id, ...cfg,
            onListo: async () => { if (cfg.nuevoProducto) setIrAlUltimo(true); setEditando(null); await cargar(); },
            onCancelar: () => setEditando(null) }} />
    );

    // Tema claro, como la lista de solicitudes y la Bandeja de Diseño (06/10), y a todo el ancho como ellas (antes
    // max-w-7xl centrado). Antes iba dentro de .fp-oscuro, el tema oscuro de Solicitudes (fichaPedido.css).
    return (
        <>
        <div className={`p-3 md:p-6 space-y-4 ${conEsqueleto.current ? 'animate-entrar-pagina' : ''}`}>
            {/* Encabezado como el de las otras pantallas: ícono de Lucide en brand-cyan y sin fondo, título grande */}
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                    <ClipboardList size={30} className="mt-1 shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><Pastilla e={s.Estado} mapa={ESTADO_SOLICITUD} />
                            {abierta && s.Conversion.some(c => c.checklist) && <PastillaIngreso listo={s.Conversion.every(c => !c.checklist || c.checklist.listo)} faltan={s.Conversion.reduce((n, c) => n + (c.checklist?.faltan?.length || 0), 0)} />}
                            <span className="text-xs text-slate-400">Solicitud #{s.SolicitudID} · {fmtFechaHora(s.FechaSolicitud)}</span>
                            {puedeVender && <IndicadorGuardado />}</div>
                        <h1 className="mt-1 text-2xl font-black leading-tight text-slate-800">{s.NombreTrabajo}</h1>
                        <p className="text-sm text-slate-500">{s.ClienteNombre}{s.ClienteCodigo ? <span className="text-xs text-slate-400"> · {s.ClienteCodigo}</span> : null} · vendedor <b className="text-slate-700">{capitalizar(s.VendedorNombre) || '—'}</b></p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => navigate(perfil.esVendedor ? '/ventas/solicitudes' : '/ventas/bandeja-diseno')} className={BTN_SECUNDARIO}><ArrowLeft size={14} /> Volver</button>
                    <button onClick={cargar} className={BTN_SECUNDARIO} title="Actualizar"><RefreshCw size={14} /></button>
                    {/* Sin acceso a Diseño desde la solicitud (14/10): el trabajo de Diseño se abre solo desde la Bandeja de Diseño */}
                    <button onClick={abrirFicha} disabled={generandoFicha} className={BTN_PRIMARIO} title="Todo lo de la solicitud y de Diseño en un solo PDF, con los archivos en miniatura. Es la misma ficha que se adjunta al pedido al convertir.">{generandoFicha ? <Loader2 size={14} className="animate-spin" /> : <Printer size={14} />} Ficha del pedido (PDF)</button>
                    {/* [FASE 2 15/10] Sin "Editar solicitud": la identificación se edita en Resumen y cada producto en su pestaña */}
                    {puedeVender && <button onClick={() => setCancelando(true)} className={BTN_PELIGRO}><Ban size={14} /> Cancelar solicitud</button>}
                    {/* [AYUDA 15/10] la guía del que la mira: vendedor en su solicitud; un diseñador que no vende, la suya */}
                    <BotonAyuda guia={perfil.esDisenador && !perfil.esVendedor ? 'disenadores' : 'vendedores'} />
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
            {/* 15/10: cómo se cobra, el precio y la seña en UNA tarjeta (antes tres) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <Dato l="Precio" v={!s.ModoCobro ? <span className="text-rose-600">Sin pactar</span> : (
                    <span className="flex flex-wrap items-baseline gap-x-1.5">
                        <span>{s.ModoCobro === 'PRECIO_ESTABLECIDO' ? plata(s.PrecioPactado, s.MonIdMoneda) : 'Por cada área'}</span>
                        <span className="text-xs font-semibold text-slate-500">{s.ModoCobro === 'PRECIO_ESTABLECIDO' ? '· precio establecido' : ''}</span>
                        <span className="text-xs font-semibold">· {!s.RequiereSena ? <span className="text-slate-500">sin seña</span>
                            : s.SenaConfirmada ? <span className="text-emerald-700">seña {plata(s.SenaMonto, s.MonIdMoneda)} confirmada</span>
                                : <span className="text-rose-600">seña {plata(s.SenaMontoRequerido, s.MonIdMoneda)} sin confirmar</span>}</span>
                    </span>
                )} />
                <Dato l="Entrega que necesita el cliente" v={s.FechaEntrega ? `${fmtFecha(s.FechaEntrega)}${s.FechaEntregaHasta ? ` → ${fmtFecha(s.FechaEntregaHasta)}` : ''}` : <span className="text-rose-600">Sin fecha</span>} />
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
                    {/* [FASE 2 15/10] otro producto: se carga acá mismo (antes, en "Editar solicitud") */}
                    {puedeVender && (
                        <button type="button" onClick={() => setEditando('nuevo')} disabled={editando === 'nuevo'}
                            className="-mb-px ml-auto inline-flex items-center gap-1 border-b-2 border-transparent px-3 py-2.5 text-sm font-bold text-brand-cyan hover:underline disabled:opacity-50">
                            <Plus size={14} /> Agregar producto
                        </button>
                    )}
                </div>

                <div className="p-4">
                    {editando === 'nuevo' && (
                        <div className="space-y-2">
                            <p className="text-xs text-slate-500">Producto nuevo de la solicitud: elegilo y guardá; después se carga su arte en su pestaña.</p>
                            {editor({ bloques: [3, 7], nuevoProducto: true })}
                        </div>
                    )}
                    {editando !== 'nuevo' && tabActual === 'resumen' && (
                        <div className="space-y-3 text-sm">
                            {/* [GUARDADO AUTOMÁTICO 15/10] La identificación se edita acá y se guarda sola (antes, "Editar" y "Guardar") */}
                            <Identificacion s={s} puede={puedeVender} guardarDato={guardarDato} />
                            {s.PreNumero && <Info l="Presupuesto del que salió" v={<><b className="font-mono">{s.PreNumero}</b>{s.Presupuesto ? ` · ${s.Presupuesto.Moneda} ${Number(s.Presupuesto.Total || 0).toLocaleString('es-UY', { minimumFractionDigits: 2 })} · ${s.Presupuesto.Estado} · emitido ${fmtFechaHora(s.Presupuesto.FechaEmision)}` : ''}</>} />}
                            {s.Observaciones && <Info l="Observaciones generales" v={<span className="whitespace-pre-line">{s.Observaciones}</span>} />}
                            {/* 15/10: sin "Solicitud del cliente" de cada producto (ocupaba lugar; se edita con "Cambiar producto" en su
                                pestaña y está en la ficha PDF). Sigue en la pantalla de Diseño. */}
                            <FichaIngreso s={s} />
                            {abierta && s.Productos.some(p => !p.PedidoNoDocERP) && <PanelPlazo s={s} id={id} />}
                            {/* 15/10: sin "Archivos generales de la solicitud" (explicación y botón): todo se adjunta en la pestaña del producto.
                                Si una solicitud vieja ya tiene, se ven (y se pueden quitar): igual viajan al pedido al convertir. */}
                            {archivosDe(a => !a.ProductoSolID && !a.ParteID && !a.EventoID).length > 0 && (
                                <div className="border-t border-slate-100 pt-3">
                                    <ListaArchivos titulo="Adjuntos generales" archivos={archivosDe(a => !a.ProductoSolID && !a.ParteID && !a.EventoID)} puedeQuitar={puedeVender} onQuitar={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Archivo quitado.')} />
                                </div>
                            )}
                        </div>
                    )}

                    {editando !== 'nuevo' && s.Productos.map((p, i) => tabActual === `prod-${p.ProductoSolID}` && (
                        <ProductoTab key={p.ProductoSolID} s={s} p={p} n={i + 1} id={id} user={user} perfil={perfil} busy={busy} abierta={abierta} puedeVender={puedeVender}
                            telas={telas} archivosDe={archivosDe} hacer={hacer} subir={subir} onAbrirFicha={setFicha} conSolicitudCliente={false}
                            // [FASE 2 15/10] los datos del producto se editan acá (sin TIZADA PRO, también sus extras)
                            onEditar={puedeVender && !p.PedidoNoDocERP ? () => setEditando(p.ProductoSolID) : null}
                            // [GUARDADO AUTOMÁTICO 15/10] la cantidad se cambia en la tarjeta del producto y se guarda sola
                            onCantidad={puedeVender && !p.PedidoNoDocERP ? (c) => guardarDato({ Productos: [{ ProductoSolID: p.ProductoSolID, Cantidad: c }] }) : null}
                            // con TIZADA PRO los extras van en la tabla del arte: el editor no muestra "Servicios y extras"
                            editor={editando === p.ProductoSolID ? editor({ bloques: p.Config?.TizadaProMoldeRef ? [3] : [3, 7], productoSolId: p.ProductoSolID }) : null} />
                    ))}

                    {editando !== 'nuevo' && tabActual === 'precio' && <PrecioSena s={s} puede={puedeVender} busy={busy} hacer={hacer} autoGuardar={autoGuardar} />}
                    {editando !== 'nuevo' && tabActual === 'interacciones' && <Interacciones s={s} puede={abierta && (perfil.esVendedor || perfil.esDisenador)} busy={busy} hacer={hacer} subir={subir} />}
                    {editando !== 'nuevo' && tabActual === 'historial' && (
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

// ── [GUARDADO AUTOMÁTICO 15/10] ─────────────────────────────────────────────────────────────────────────────────────
// Un solo aviso arriba, como Google Docs: "Guardando…", "Guardado" o por qué no se guardó. Lo alimenta avisarGuardado
// (solicitudesComunes): los datos de la solicitud, la cantidad, el precio y el arte y la lista de TIZADA PRO.
function IndicadorGuardado() {
    const [g, setG] = useState({ pendientes: 0, error: null, hora: null });
    useEffect(() => {
        const alAvisar = (e) => {
            const { estado, mensaje } = e.detail || {};
            setG(x => (estado === 'guardando' ? { ...x, pendientes: x.pendientes + 1 }
                : { pendientes: Math.max(0, x.pendientes - 1), error: estado === 'error' ? (mensaje || 'Error inesperado') : null, hora: estado === 'ok' ? new Date() : x.hora }));
        };
        window.addEventListener('solicitud:guardado', alAvisar);
        return () => window.removeEventListener('solicitud:guardado', alAvisar);
    }, []);
    if (g.pendientes > 0) return <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><Loader2 size={12} className="animate-spin" /> Guardando…</span>;
    if (g.error) return <span className="inline-flex max-w-[420px] items-center gap-1 truncate text-xs font-semibold text-rose-600" title={g.error}><AlertTriangle size={12} className="shrink-0" /> No se guardó: {g.error}</span>;
    return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700" title="Cada cambio se guarda solo">
            <CheckCircle2 size={12} /> Guardado{g.hora ? ` · ${g.hora.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}` : ''}
        </span>
    );
}

// Un campo que se guarda solo al dejarlo (y con Enter, salvo un texto largo). onGuardar(valor) devuelve si se guardó:
// si no, el campo vuelve a lo guardado.
function CampoAuto({ valor, onGuardar, largo = false, tipo = 'text', className = INPUT, ...resto }) {
    const [v, setV] = useState(valor ?? '');
    useEffect(() => { setV(valor ?? ''); }, [valor]);
    const salir = async () => {
        if (String(v).trim() === String(valor ?? '').trim()) return;
        if (!(await onGuardar(String(v).trim()))) setV(valor ?? '');
    };
    return largo
        ? <textarea rows={3} value={v} onChange={e => setV(e.target.value)} onBlur={salir} className={className} {...resto} />
        : <input type={tipo} value={v} onChange={e => setV(e.target.value)} onBlur={salir} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} className={className} {...resto} />;
}

// Una fecha que se guarda al elegirla (o al borrarla). valor: 'AAAA-MM-DD' o ''.
function FechaAuto({ valor, onGuardar, ...resto }) {
    const [v, setV] = useState(valor || '');
    useEffect(() => { setV(valor || ''); }, [valor]);
    return (
        <SelectorFecha vaciable className="!rounded-lg" value={v} {...resto}
            onChange={async (e) => { const n = e.target.value || ''; if (n === v) return; setV(n); if (!(await onGuardar(n || null))) setV(valor || ''); }} />
    );
}

// El cliente: "Cambiar cliente" abre el buscador y el elegido se guarda en el momento.
function ClienteAuto({ s, onGuardar }) {
    const [cambiando, setCambiando] = useState(false);
    return (
        <div className="space-y-1">
            <BuscadorCliente cliente={cambiando ? null : { CodCliente: s.CodCliente, Nombre: s.ClienteNombre, Codigo: s.ClienteCodigo }}
                onPick={async (c) => { if (!c) { setCambiando(true); return; } if (await onGuardar(c.CodCliente)) setCambiando(false); }} />
            {cambiando && <button type="button" onClick={() => setCambiando(false)} className="text-xs font-bold text-slate-500 hover:underline">Dejar a {s.ClienteNombre}</button>}
        </div>
    );
}

const CampoDiv = ({ label, children }) => (
    <div className="block text-xs">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wide">{label}</span>
        <div className="mt-1">{children}</div>
    </div>
);

// Identificación sin "Editar" ni "Guardar": cada dato se guarda al dejar el campo (la fecha, al elegirla). Quien no la
// puede editar (Diseño, o la solicitud cerrada) la ve como texto.
function Identificacion({ s, puede, guardarDato }) {
    const dia = (v) => (v ? String(v).slice(0, 10) : '');
    if (!puede) {
        return (
            <section className={`${ZONA} space-y-3`}>
                <span className="text-sm font-black text-slate-800">Identificación</span>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                    <Info l="Cliente" v={<>{s.ClienteNombre}{s.ClienteCodigo ? <span className="text-slate-400"> · {s.ClienteCodigo}</span> : null}</>} />
                    <Info l="Nombre del trabajo" v={s.NombreTrabajo} />
                    <Info l="Fecha que necesita el cliente" v={s.FechaEntrega ? `${fmtFecha(s.FechaEntrega)}${s.FechaEntregaHasta ? ` → ${fmtFecha(s.FechaEntregaHasta)}` : ''}` : <span className="text-rose-600 font-bold">Sin fecha</span>} />
                    <Info l="Vendedor" v={capitalizar(s.VendedorNombre) || '—'} />
                </div>
                <Info l="Qué pide el cliente" v={<span className="whitespace-pre-line">{s.Detalle}</span>} />
            </section>
        );
    }
    return (
        <section className={`${ZONA} space-y-3`}>
            <span className="text-sm font-black text-slate-800">Identificación</span>
            <div className="grid gap-3 md:grid-cols-2">
                <CampoDiv label="Cliente"><ClienteAuto s={s} onGuardar={(c) => guardarDato({ CodCliente: c })} /></CampoDiv>
                <Campo label="Nombre del trabajo"><CampoAuto valor={s.NombreTrabajo} onGuardar={(v) => guardarDato({ NombreTrabajo: v })} placeholder="Ej: Buzos egresados 3ºB" /></Campo>
                <div className="grid grid-cols-2 gap-3">
                    <CampoDiv label="Fecha que necesita el cliente"><FechaAuto aria-label="Fecha que necesita el cliente" valor={dia(s.FechaEntrega)} onGuardar={(v) => guardarDato({ FechaEntrega: v })} /></CampoDiv>
                    <CampoDiv label="Hasta (si es un rango)"><FechaAuto aria-label="Hasta (si es un rango)" valor={dia(s.FechaEntregaHasta)} min={dia(s.FechaEntrega) || undefined} onGuardar={(v) => guardarDato({ FechaEntregaHasta: v })} /></CampoDiv>
                </div>
                <CampoDiv label="Vendedor"><div className="py-1.5 text-sm text-slate-700">{capitalizar(s.VendedorNombre) || '—'}</div></CampoDiv>
            </div>
            <Campo label="Qué pide el cliente"><CampoAuto largo valor={s.Detalle} onGuardar={(v) => guardarDato({ Detalle: v })} placeholder="Ej: 22 buzos canguro azul marino con escudo bordado y apodo en la espalda" /></Campo>
        </section>
    );
}

// La cantidad de prendas en la tarjeta del producto, con las reglas del producto (paquete fijo / mínimo; las vuelve a
// mirar el servidor). Si la lista de jugadores no suma lo mismo, lo dice "Estado para producción".
function CantidadAuto({ p, onGuardar }) {
    const fija = Number(p.Catalogo?.fija) || 0, min = Number(p.Catalogo?.minima) || 0;
    return (
        <span className="inline-flex items-center gap-1">
            <CampoAuto tipo="number" min={fija || min || 1} step={fija || 1} valor={String(p.Cantidad ?? '')} onGuardar={onGuardar} aria-label="Cantidad de prendas"
                className="w-16 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-bold text-slate-800 outline-none focus:border-brand-cyan" />
            prendas{fija ? <span className="text-slate-400"> (paquetes de {fija})</span> : min ? <span className="text-slate-400"> (mínimo {min})</span> : null}
        </span>
    );
}

// Mientras carga: la misma forma que la pantalla (encabezado, datos, pestañas), para que no quede en blanco y después
// aparezca todo de golpe. Antes era un spinner solo en una pantalla vacía.
const Hueso = ({ className = '' }) => <div className={`rounded-md bg-slate-200/70 ${className}`} />;
function EsqueletoDetalle() {
    return (
        <div className="p-3 md:p-6 animate-aparecer-demorado" aria-busy="true" aria-label="Cargando la solicitud">
            <div className="space-y-4 animate-pulse">
                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                        <Hueso className="mt-1 h-[30px] w-[30px]" />
                        <div className="space-y-2">
                            <Hueso className="h-4 w-48" />
                            <Hueso className="h-7 w-72" />
                            <Hueso className="h-4 w-56" />
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {['w-20', 'w-10', 'w-36', 'w-44', 'w-32'].map((w, i) => <Hueso key={i} className={`h-9 ${w}`} />)}
                    </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {[0, 1, 2].map(i => (
                        <div key={i} className="rounded-xl border border-slate-200 bg-white px-3 py-2 space-y-1.5">
                            <Hueso className="h-2.5 w-24" />
                            <Hueso className="h-4 w-32" />
                        </div>
                    ))}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white">
                    <div className="flex gap-4 border-b border-slate-200 px-5 py-3">
                        {['w-20', 'w-36', 'w-24', 'w-28', 'w-20'].map((w, i) => <Hueso key={i} className={`h-4 ${w}`} />)}
                    </div>
                    <div className="space-y-3 p-4">
                        <Hueso className="h-4 w-64" />
                        <Hueso className="h-24 w-full" />
                        <Hueso className="h-40 w-full" />
                    </div>
                </div>
            </div>
        </div>
    );
}

// "Solicitud del cliente" de un producto: corte, costura, cómo se define, diseño… lo que cargó el vendedor en el formulario.
// Solo en la pantalla de Diseño (15/10: en la solicitud del vendedor ya no va, ni en el producto ni en el Resumen).
function SolicitudCliente({ p }) {
    return (
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
    );
}

// La foto del producto del catálogo (la ruta /uploads/… es del backend), igual que las tarjetas del formulario
const fotoProducto = (p) => {
    const f = p.Catalogo?.foto;
    if (!f) return null;
    return f.startsWith('http') ? f : `${(api.defaults?.baseURL || '').replace(/\/api\/?$/, '')}${f}`;
};

// Una pestaña por producto: datos del producto + tabla de servicios (una fila por servicio) + conversión a pedido.
// conSolicitudCliente: el recuadro "Solicitud del cliente" arriba (solo la pantalla de Diseño; la solicitud del vendedor no lo muestra)
// onEditar / editor (fase 2, 15/10): "Cambiar producto" y el formulario embebido que se abre acá (solicitud del vendedor)
// onCantidad (guardado automático, 15/10): la cantidad de prendas se cambia en la tarjeta y se guarda al dejar el campo
export function ProductoTab({ s, p, n, id, user, perfil, busy, abierta, puedeVender, telas, archivosDe, hacer, subir, onAbrirFicha, conSolicitudCliente = true, onEditar = null, editor = null, onCantidad = null }) {
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
    // [ENVIAR A DISEÑO 12/10] un solo botón por producto: ventana con lo que se envía (todo tildado)
    const [enviandoDiseno, setEnviandoDiseno] = useState(false);
    const sinEnviar = p.Partes.filter(pa => pa.Estado === 'INGRESADO');

    return (
        // Producto a la izquierda y "Estado para producción" a la derecha, pegado al bajar; hasta 1100 px, uno abajo del otro
        <div className="grid grid-cols-1 items-start gap-5 min-[1101px]:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
                {/* [15/10] Tarjeta del producto, como la Tienda: foto, nombre, código y familia, prendas y precio de catálogo */}
                <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
                        {fotoProducto(p) ? <img src={fotoProducto(p)} alt="" className="h-full w-full object-contain" /> : <Shirt size={22} className="text-slate-300" aria-hidden="true" />}
                    </div>
                    <div className="min-w-0">
                        <h2 className="truncate text-sm font-black text-slate-800">Producto {n}: {p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? (p.ProductoNombre || `Producto ${p.ProIdProducto}`) : 'Producto personalizado del cliente'}</h2>
                        {p.Catalogo && (p.Catalogo.codigo || p.Catalogo.familia) ? <p className="text-[11px] text-slate-400">{[p.Catalogo.codigo, p.Catalogo.familia].filter(Boolean).join(' · ')}</p> : null}
                        <p className="text-xs text-slate-600">{onCantidad && !editor ? <CantidadAuto p={p} onGuardar={onCantidad} /> : <><b>{p.Cantidad}</b> prendas</>}{p.Catalogo?.precio != null ? <> · {p.Catalogo.moneda === 'USD' ? 'US$' : '$'} {Number(p.Catalogo.precio).toLocaleString('es-UY', { maximumFractionDigits: 2 })} c/u <span className="text-slate-400">(catálogo)</span></> : null}</p>
                    </div>
                </div>
                <span className="flex items-center gap-2">
                    {p.PedidoNoDocERP ? <span className="text-[10px] font-black uppercase text-emerald-700">Pedido {p.PedidoNoDocERP} · {fmtFechaHora(p.FechaConversion)}</span> : null}
                    {onEditar && !editor && <button type="button" onClick={onEditar} className={BTN_SECUNDARIO} title="Elegir otro producto del catálogo (pide confirmación), los accesorios y quién aporta el diseño">
                        <ArrowLeftRight size={12} /> {p.Config?.TizadaProMoldeRef ? 'Cambiar producto' : 'Cambiar producto o extras'}</button>}
                </span>
            </div>
            {editor}

            {/* En la solicitud del vendedor va en el Resumen (14/10); en la pantalla de Diseño ("Lo que llegó de la solicitud") sigue acá */}
            {conSolicitudCliente && <SolicitudCliente p={p} />}

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

            {/* [ENVIAR A DISEÑO 12/10] UN botón para todo el producto (antes, uno por servicio) */}
            {puedeVender && !p.PedidoNoDocERP && sinEnviar.length > 0 && (
                <section className={`${ZONA} flex flex-wrap items-center justify-between gap-3`}>
                    <div className="text-xs text-slate-600">Sin enviar a Diseño: <b>{sinEnviar.map(pa => NOMBRE_PARTE[pa.Tipo] || pa.Tipo).join(' · ')}</b></div>
                    <button type="button" disabled={busy} onClick={() => setEnviandoDiseno(true)} className={BTN_PRIMARIO}><Send size={12} /> Enviar a Diseño…</button>
                </section>
            )}
            {enviandoDiseno && (
                <EnviarADisenoModal p={p} partes={sinEnviar} faltaSubl={faltaSubl} hacer={hacer} onClose={() => setEnviandoDiseno(false)}
                    sinArte={new Set(p.TipoFabricacion === 'PRODUCTO_TERMINADO' && p.Config?.TizadaProMoldeRef
                        ? sinEnviar.filter(pa => ['BORDADO', 'DTF', 'TPU'].includes(pa.Tipo) && !archivosDe(a => a.ParteID === pa.ParteID && a.Rol === 'ARTE_CLIENTE').length).map(pa => pa.ParteID)
                        : [])} />
            )}

        </div>
            <aside className="min-[1101px]:sticky min-[1101px]:top-4 min-[1101px]:max-h-[calc(100vh-2rem)] min-[1101px]:overflow-y-auto">
                <Conversion s={s} p={p} pedido={conv.pedido} faltantes={faltantes} avisos={conv.avisos || []} checklist={conv.checklist} puedeVender={perfil.esVendedor} puedeConvertir={false} busy={busy} hacer={hacer} id={id} />
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

/* [ENVIAR A DISEÑO 12/10] Ventana del botón único: cada servicio sin enviar, tildado, con su tipo de trabajo.
   Se envían de a uno; si alguno no puede, se dice por qué y los demás igual salen.
   [15/10] Sin "Generar ya la tizada": desde la solicitud del vendedor NO sale nada a TIZADA PRO. Queda en la bandeja de
   Diseño y la tizada la manda el diseñador desde su pantalla (Tizada: false, aunque el .env diga AL_ENVIAR_A_DISENO).
   La Tienda del cliente sigue mandándola sola (pedidoPortalService). */
// sinArte (15/10): con TIZADA PRO, los bordado / DTF / TPU sin ningún archivo de arte (no salen: el servidor también los frena)
function EnviarADisenoModal({ p, partes, faltaSubl, sinArte = new Set(), hacer, onClose }) {
    const conTizada = p.TipoFabricacion === 'PRODUCTO_TERMINADO' && !!p.Config?.TizadaProMoldeRef;
    const faltaDe = (pa) => (pa.Tipo === 'PRINCIPAL' ? faltaSubl
        : sinArte.has(pa.ParteID) ? `falta el arte. Subí el arte del producto y elegí qué objetos van en ${(NOMBRE_PARTE[pa.Tipo] || pa.Tipo).toLowerCase()} (o subí su archivo aparte en la tabla del arte).` : null);
    const [sel, setSel] = useState(() => Object.fromEntries(partes.map(pa => [pa.ParteID, {
        on: !faltaDe(pa), tipo: pa.ArteOrigen === 'CLIENTE' ? 'REVISAR' : 'DESDE_CERO',
    }])));
    const [enviando, setEnviando] = useState(false);
    const [resultado, setResultado] = useState(null);   // [{ nombre, ok, texto }]
    const set = (id, c) => setSel(x => ({ ...x, [id]: { ...x[id], ...c } }));
    // la principal primero (si TIZADA no la acepta, se ve arriba)
    const orden = [...partes].sort((a, b) => (a.Tipo === 'PRINCIPAL' ? -1 : b.Tipo === 'PRINCIPAL' ? 1 : 0));
    const elegidas = orden.filter(pa => sel[pa.ParteID]?.on);
    const enviar = async () => {
        setEnviando(true);
        // La lista de jugadores se guarda sola (como la Tienda): lo que quede pendiente se guarda antes de enviar
        const pendientes = [];
        window.dispatchEvent(new CustomEvent('pedido-tienda:guardar', { detail: { pendientes } }));
        await Promise.all(pendientes);
        const res = [];
        for (const pa of elegidas) {
            const nombre = NOMBRE_PARTE[pa.Tipo] || pa.Tipo;
            const s = sel[pa.ParteID];
            const conTz = pa.Tipo === 'PRINCIPAL' && conTizada;
            try {
                await svc.enviarADiseno(pa.ParteID, s.tipo, false);
                res.push({ nombre, ok: true, texto: conTz ? 'Enviado a la bandeja de Diseño. El diseñador lo revisa y manda la tizada a TIZADA PRO.' : 'Enviado a la bandeja de Diseño.' });
            } catch (e) { res.push({ nombre, ok: false, error: true, texto: errorDe(e) }); }
        }
        setResultado(res);
        setEnviando(false);
        await hacer(async () => { });   // recarga la solicitud
    };
    const pie = resultado
        ? <button type="button" data-autofocus onClick={onClose} className={BTN_GRANDE_SI}>Listo</button>
        : <>
            <button type="button" onClick={onClose} disabled={enviando} className={BTN_GRANDE_NO}>Cancelar</button>
            <button type="button" data-autofocus onClick={enviar} disabled={enviando || !elegidas.length} className={BTN_GRANDE_SI}>
                {enviando ? <><Loader2 size={14} className="animate-spin" /> Enviando…</> : <><Send size={14} /> Enviar {elegidas.length === 1 ? '1 servicio' : `${elegidas.length} servicios`} a Diseño</>}
            </button>
        </>;
    return (
        <Ventana Icono={Send} titulo="Enviar a Diseño" onClose={() => !enviando && onClose()} pie={pie}>
            {resultado ? (
                <ul className="space-y-2 text-sm">
                    {resultado.map((r, k) => (
                        <li key={k} className={`flex items-start gap-2 rounded-xl border px-3 py-2 ${r.error ? 'border-rose-200 bg-rose-50' : r.ok ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                            {r.ok ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5 shrink-0" /> : <AlertTriangle size={16} className={`${r.error ? 'text-rose-600' : 'text-amber-600'} mt-0.5 shrink-0`} />}
                            <span><b>{r.nombre}</b>{r.error ? ': no se envió. ' : ': '}{r.texto}</span>
                        </li>
                    ))}
                </ul>
            ) : (
                <div className="space-y-2 text-sm">
                    <p className="text-slate-600">Tildá lo que se envía a la bandeja de Diseño.</p>
                    {orden.map(pa => {
                        const s = sel[pa.ParteID];
                        const falta = faltaDe(pa);
                        return (
                            <div key={pa.ParteID} className={`rounded-xl border px-3 py-2.5 ${s.on ? 'border-brand-cyan/40 bg-brand-cyan/5' : 'border-slate-200'}`}>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                                    <label className="flex items-center gap-2 font-bold text-slate-800 min-w-[220px] cursor-pointer">
                                        <input type="checkbox" checked={s.on} disabled={enviando || !!falta} onChange={e => set(pa.ParteID, { on: e.target.checked })} className="h-4 w-4 accent-brand-cyan" />
                                        {NOMBRE_PARTE[pa.Tipo] || pa.Tipo}
                                    </label>
                                    {s.on && (
                                        <Selector value={s.tipo} disabled={enviando} onChange={e => set(pa.ParteID, { tipo: e.target.value })} claseBoton={claseSel('border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white')} anchoLista={240}>
                                            {Object.entries(TIPO_TRABAJO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                                        </Selector>
                                    )}
                                </div>
                                {falta && <div className="mt-1 text-[11px] font-bold text-amber-700 flex items-center gap-1"><AlertTriangle size={12} /> Todavía no se puede: {falta}</div>}
                                {pa.Tipo === 'PRINCIPAL' && conTizada && s.on && (
                                    <p className="mt-1.5 ml-6 text-xs text-slate-500">Queda en la bandeja de Diseño: la tizada en TIZADA PRO la manda el diseñador.</p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </Ventana>
    );
}

/* Producción principal (sublimación) en la pestaña del producto: UN contenedor con todo lo que
   Diseño necesita, en el orden en que el vendedor lo carga: arte del cliente → piezas y telas →
   planilla de talles y nombres → Enviar a Diseño (al final, y trabado hasta que esté todo). */
// cliente = el pedido que arma el cliente en la Tienda del portal (PedidoTiendaView): sin lo interno de Diseño.
// extraMedio = lo que esa pantalla pone entre el arte y la lista de jugadores. porArte = lo que pone dentro de la
// pestaña de cada arte (los extras de esa camiseta), ver TizadaProBloque.
export function PrincipalBloque({ p, pa, id, perfil, busy, abierta, puedeVender, arte, planillas, artes, faltaEnvio, onEstadoSubl, hacer, subir, cliente = false, extraMedio = null, porArte = null, extrasPortal = null }) {
    const bloqueada = !abierta || !!p.PedidoNoDocERP;
    const puede = puedeVender && !p.PedidoNoDocERP;
    const d = pa.Datos || {};
    const Sub = ({ children }) => <div className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1">{children}</div>;
    // Con molde de TIZADA PRO: el arte es UN archivo por diseño (todas las piezas); diseños + lista de jugadores = paso 3
    const conTizada = p.TipoFabricacion === 'PRODUCTO_TERMINADO' && !!p.Config?.TizadaProMoldeRef;
    // [COMO LA TIENDA 14/10] Con molde de TIZADA PRO el vendedor ve lo mismo que el cliente en la Tienda: arranca en
    // "1 · Arte del cliente" y termina en la lista, sin el encabezado ni la línea de estado de abajo (el estado y lo que
    // falta para Diseño se ven en "Estado para producción", al costado). Las indicaciones para Diseño, solo si hay.
    const comoTienda = cliente || conTizada;
    const estadoPills = <>
        <Pastilla e={pa.Estado} mapa={ESTADO_PARTE} />{pa.Modificada ? <PastillaModificada /> : null}
        {d.disenoAutomatico ? <span className="px-2 py-0.5 rounded-full border text-[10px] font-black bg-emerald-100 text-emerald-700 border-emerald-200 normal-case tracking-normal" title={`Lo hizo ${d.disenoAutomatico.sistema} (${d.disenoAutomatico.referencia})`}>Diseño automático · {d.disenoAutomatico.sistema}</span> : null}
    </>;
    return (
        <section className={ZONA}>
            {/* Portal (cliente) y vendedor con TIZADA PRO: sin el encabezado interno (estado, diseñador, indicaciones para Diseño) */}
            {!comoTienda && <div className={`${TIT_ZONA} flex flex-wrap items-center justify-between gap-2`}>
                <span>Producción principal ({nombrePrincipal(p)}) <small>{p.Config?.Molde === 'NO' ? 'arte → con eso se envía a Diseño' : conTizada ? 'arte · telas por pieza · diseños y lista de jugadores → TIZADA PRO arma la tizada' : 'arte · telas por pieza · planilla de talles → con eso se envía a Diseño'}</small></span>
                <span className="flex items-center gap-1.5">{estadoPills}
                    {pa.DisenadorNombre ? <span className="text-[11px] font-bold text-slate-600 normal-case tracking-normal">{pa.Estado === 'DISENADO' ? 'Diseñó' : 'Lo tiene'} <b>{pa.DisenadorNombre}</b></span>
                        : pa.Estado === 'ENVIADO_DISENO' ? <span className="text-[11px] font-bold text-slate-500 normal-case tracking-normal">nadie lo tomó todavía</span> : null}</span>
            </div>}
            {comoTienda && !cliente && pa.Observaciones ? <div className="text-xs text-slate-500 whitespace-pre-line">Indicaciones para Diseño: {pa.Observaciones}</div> : null}
            {!comoTienda && <div className="grid md:grid-cols-2 gap-3 text-xs">
                <div className="space-y-0.5">
                    {pa.IncluidoEnProducto ? <div className="text-[10px] font-bold text-slate-400">Incluido en el producto</div> : null}
                    {d.variante && <div className="text-slate-600">{d.variante}</div>}
                    {d.material && <div className="text-slate-600">{d.material}</div>}
                    {pa.Observaciones ? <div className="text-slate-500 whitespace-pre-line">Indicaciones: {pa.Observaciones}</div> : <div className="text-slate-400">Sin indicaciones para Diseño.</div>}
                </div>
                {!conTizada && <div>
                    <Sub>1 · Arte del cliente <span className="normal-case font-normal">{conTizada
                        ? '(UN archivo .ai o .pdf por diseño — jugador, alternativa… — con todas las piezas: se elige en el paso 3)'
                        : '(escudos, logos, bocetos: después se asigna a cada pieza)'}</span></Sub>
                    <ArchivosCelda archivos={arte} vacio="Sin archivos" puedeQuitar={puede} onQuitar={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Archivo quitado.')} conRol />
                    {puede && <div className="mt-1.5"><BotonSubir busy={busy} roles={ROLES_PARTE} onFiles={(files, Rol) => subir(files, { Rol, ParteID: pa.ParteID }, pa.Tipo)} /></div>}
                </div>}
            </div>}

            {p.TipoFabricacion === 'PRODUCTO_TERMINADO' && !conTizada && <PiezasTelasBloque plano id={id} p={p} busy={busy} puede={puede} hacer={hacer} artes={artes} onEstado={onEstadoSubl} conTizada={conTizada} cliente={cliente} />}

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
                <TizadaProBloque id={id} p={p} puede={puede && !bloqueada} onCargado={() => hacer(async () => { })} numero={3} cliente={cliente} porArte={porArte}
                    subirArchivos={subir} extrasPortal={extrasPortal}
                    // [ARTE ARRIBA 12/10] arriba el arte (de quién es + editables, se leen solos), en el medio Piezas y telas
                    // Portal: las telas van en la pestaña de cada arte; "Piezas y telas" aparece solo si falta completar la base.
                    // Vendedor (como la Tienda): igual, pero completa queda en una línea (modelo y telas) con "Cambiar".
                    medio={<>
                        {p.TipoFabricacion === 'PRODUCTO_TERMINADO' && (!cliente || !p.Datos?.sublimacion?.completo) ? <PiezasTelasBloque plano id={id} p={p} busy={busy} puede={puede} hacer={hacer} artes={artes} onEstado={onEstadoSubl} conTizada cliente={cliente} comoTienda /> : null}
                        {extraMedio}
                    </>}
                    onQuitarArte={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Arte quitado.')}
                    onPlanillaArchivo={(file) => subir([file], { Rol: 'PLANILLA', ProductoSolID: p.ProductoSolID })}
                    archivosArte={(() => {
                        // los demás archivos de la producción principal (bocetos, referencias…) y el botón de subir
                        const otros = arte.filter(a => !(a.Rol === 'ARTE_CLIENTE' && /\.(ai|pdf)$/i.test(a.NombreOriginal || '')));
                        return (
                            <div className="mt-2 space-y-1.5">
                                {otros.length > 0 && <ArchivosCelda archivos={otros} vacio="" puedeQuitar={puede} onQuitar={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Archivo quitado.')} conRol />}
                                {puede && <BotonSubir busy={busy} roles={ROLES_PARTE} onFiles={(files, Rol) => subir(files, { Rol, ParteID: pa.ParteID }, pa.Tipo)} />}
                            </div>
                        );
                    })()}
                    // La lista de jugadores reemplaza la nota de talles y "lleva nombres y números" (12/10). El Excel con el
                    // que se carga la lista queda adjunto solo; acá se ven las planillas del cliente que haya.
                    // Portal y vendedor: al lado de "Buscar archivo Excel", chico: el nombre (abre el archivo) y la ✕ para quitarlo
                    extra={planillas.length > 0 ? planillas.map(a => (
                        <span key={a.ArchivoID} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px]">
                            <FileText size={12} className="text-slate-400" />
                            <a href={a.UrlDrive} target="_blank" rel="noreferrer" className="font-bold text-brand-cyan hover:underline max-w-[220px] truncate" title={a.NombreOriginal}>{a.NombreOriginal}</a>
                            {puede && <button type="button" disabled={busy} title="Quitar la planilla adjunta (la lista no cambia)" onClick={() => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Planilla quitada.')} className="text-slate-400 hover:text-rose-600"><X size={12} /></button>}
                        </span>
                    )) : null} />
            )}

            {!comoTienda && <div className="pt-3 mt-3 border-t border-slate-200 flex flex-wrap items-center gap-2 text-xs">
                {pa.Estado === 'INGRESADO' ? (
                    !bloqueada && perfil.esVendedor && faltaEnvio
                        ? <span className="text-[11px] font-bold text-amber-700 inline-flex items-center gap-1"><AlertTriangle size={12} /> Todavía no se puede enviar a Diseño: {faltaEnvio}</span>
                        : <span className="text-slate-500">Todavía no se envió a Diseño{!bloqueada && perfil.esVendedor ? ' (botón "Enviar a Diseño…", abajo)' : ''}.</span>
                ) : (
                    <span className="text-slate-600">
                        {pa.TipoTrabajo ? <>{TIPO_TRABAJO[pa.TipoTrabajo]} · </> : null}
                        {pa.DisenadorNombre ? <>Diseñador: <b>{pa.DisenadorNombre}</b> · </> : null}
                        {pa.FechaDisenado ? <>Diseñado {fmtFechaHora(pa.FechaDisenado)}</> : pa.FechaInicioDiseno ? <>Diseño iniciado {fmtFechaHora(pa.FechaInicioDiseno)}</> : pa.FechaEnvioDiseno ? <>Enviado a Diseño {fmtFechaHora(pa.FechaEnvioDiseno)}</> : null}
                        <span className="text-slate-400"> · el trabajo lo sigue Diseño desde su bandeja</span>
                    </span>
                )}
            </div>}
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
            {s.Productos.map((p, i) => (
                <DisenoProducto key={p.ProductoSolID} s={s} p={p} i={i} id={id} user={user} perfil={perfil} busy={busy} abierta={abierta} telas={telas}
                    archivosDe={archivosDe} hacer={hacer} subir={subir} onAbrirFicha={onAbrirFicha} />
            ))}
        </div>
    );
}

/* [DISEÑO POR PESTAÑAS 12/10] Un producto en la pantalla de Diseño: arriba, siempre a la vista, el estado de cada
   servicio con sus acciones; abajo, en pestañas: TIZADA (arte, lista, envíos) · Archivos (de cada servicio) ·
   Piezas y telas · Ficha técnica (avíos, costuras) · Crear pedido. Abre en TIZADA si el producto tiene molde. */
function DisenoProducto({ s, p, i, id, user, perfil, busy, abierta, telas, archivosDe, hacer, subir, onAbrirFicha }) {
    const conv = s.Conversion.find(c => c.ProductoSolID === p.ProductoSolID) || {};
    // [CORREGIR EL DISEÑO 15/10] ya es pedido, con una corrección abierta: el diseñador vuelve a trabajar la tizada / el DTF
    const corrigiendo = corrigiendoDe(s, p);
    const bloqueada = corrigiendo ? !perfil.esDisenador : (!abierta || !!p.PedidoNoDocERP);
    const artes = archivosDe(a => a.Rol === 'ARTE_CLIENTE' && (a.ProductoSolID === p.ProductoSolID || p.Partes.some(pa => pa.ParteID === a.ParteID)));
    const conTizada = p.TipoFabricacion === 'PRODUCTO_TERMINADO' && !!p.Config?.TizadaProMoldeRef;
    const deCatalogo = p.TipoFabricacion === 'PRODUCTO_TERMINADO';
    const prontos = archivosDe(a => a.Rol === 'DISENO_PRONTO' && p.Partes.some(pa => pa.ParteID === a.ParteID)).length;
    // [15/10] "Enviar a TIZADA PRO" / "Rehacer la tizada" van abajo, en la pestaña TIZADA PRO, junto a "Revisar en TIZADA"
    // (antes, en la tarjeta de la producción principal). Mismas reglas: la manda un diseñador; si ya lo tomaron, quien lo
    // tomó (o un admin); rehacer, con la tizada ya hecha (Diseñado).
    const principalTz = conTizada ? p.Partes.find(x => x.Tipo === 'PRINCIPAL') : null;
    const esMiaTz = !!principalTz?.DisenadorID && principalTz.DisenadorID === user?.id;
    const mandarTizada = !principalTz || bloqueada || !perfil.esDisenador ? null
        : corrigiendo ? 'rehacer'
        : (principalTz.Estado === 'ENVIADO_DISENO' || (principalTz.Estado === 'DISENO_INICIADO' && (esMiaTz || perfil.esAdmin))) ? 'enviar'
            : (principalTz.Estado === 'DISENADO' && (esMiaTz || perfil.esAdmin || !principalTz.DisenadorID)) ? 'rehacer' : null;
    const nCorrecciones = eventosCorreccion(s, p).filter(e => /^Corrección del diseño abierta/.test(e.Texto || '')).length;
    const pestanas = [
        ...(conTizada ? [['tizada', 'TIZADA PRO']] : []),
        ['archivos', `Archivos${prontos ? ` · ${prontos} pronto${prontos === 1 ? '' : 's'}` : ''}`],
        ...(deCatalogo && !p.Config?.AMedida ? [['piezas', 'Piezas y telas']] : []),   // [A MEDIDA] una sola pieza: la medida va en TIZADA PRO
        ...(p.FichaProducto ? [['ficha', 'Ficha técnica']] : []),
        ['pedido', p.PedidoNoDocERP ? `Pedido ${p.PedidoNoDocERP}` : 'Crear pedido'],
        // [CORREGIR EL DISEÑO 15/10] el historial de las correcciones de este producto
        ...(p.PedidoNoDocERP ? [['correcciones', `Correcciones${nCorrecciones ? ` · ${nCorrecciones}` : ''}`]] : []),
    ];
    const [tab, setTab] = useState(pestanas[0][0]);
    const actual = pestanas.some(([k]) => k === tab) ? tab : pestanas[0][0];
    return (
                    <div className="space-y-3">
                        {/* Banda superior: el producto y, por cada servicio, su estado, el diseñador y las acciones (tomar, aceptar cambio) */}
                        <div className="border border-slate-200 rounded-xl p-3 bg-slate-50 space-y-2">
                            <h2 className="text-sm font-black text-slate-800">Producto {i + 1}: {p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? (p.ProductoNombre || `Producto ${p.ProIdProducto}`) : 'Producto personalizado del cliente'} <span className="font-bold text-slate-500">· {p.Cantidad} prendas</span>
                                {p.PedidoNoDocERP ? <span className="ml-2 text-[10px] font-black uppercase text-emerald-700">Pedido {p.PedidoNoDocERP}</span> : null}</h2>
                            <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-2">
                                {p.Partes.map(pa => (
                                    <EstadoParteDiseno key={pa.ParteID} pa={pa} user={user} perfil={perfil} busy={busy} bloqueada={bloqueada} onAbrirFicha={onAbrirFicha}
                                        enProduccion={(conv.disenoProduccion || []).filter(o => o.AreaID === ({ BORDADO: 'EMB', TPU: 'TPU' })[pa.Tipo])}
                                        onTomar={() => hacer(() => svc.tomar(pa.ParteID), 'Trabajo tomado: quedó a tu nombre.')}
                                        // Con molde de TIZADA PRO la principal no se "toma": se manda a TIZADA (abajo, pestaña TIZADA PRO)
                                        conTizada={pa.Tipo === 'PRINCIPAL' && conTizada}
                                        onAceptar={() => hacer(() => svc.aceptarCambio(pa.ParteID), 'Cambio aceptado.')} />
                                ))}
                            </div>
                        </div>
                        {p.PedidoNoDocERP && perfil.esDisenador && s.Estado !== 'CANCELADA' && <CorreccionDiseno s={s} p={p} id={id} busy={busy} hacer={hacer} corrigiendo={corrigiendo} />}
                        <div className="border border-slate-200 rounded-xl bg-white">
                            <div className="flex flex-wrap gap-1 border-b border-slate-200 px-2" role="tablist">
                                {pestanas.map(([k, t]) => (
                                    <button key={k} type="button" role="tab" aria-selected={actual === k} onClick={() => setTab(k)}
                                        className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-bold transition-colors ${actual === k ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'}`}>{t}</button>
                                ))}
                            </div>
                            <div className="p-3">
                                {actual === 'tizada' && (<>
                                    {/* TIZADA PRO: el diseñador elige la letra de nombre y número y genera la tizada (vuelve sola como diseño pronto) */}
                                    {p.TipoFabricacion === 'PRODUCTO_TERMINADO' && p.Config?.TizadaProMoldeRef && (() => {
                                        const pa = p.Partes.find(x => x.Tipo === 'PRINCIPAL');
                                        const esDis = perfil.esDisenador || perfil.esAdmin;
                                        const enviada = pa && pa.Estado !== 'INGRESADO';
                                        return (
                                            <section className={ZONA}>
                                                <TizadaProBloque id={id} p={p} modo="diseno" puede={esDis && !bloqueada} puedeGenerar={esDis && !bloqueada && enviada} mandar={mandarTizada}
                                                    motivoNoGenerar={!esDis ? 'La tizada la genera un diseñador.' : !enviada ? 'El vendedor todavía no tocó "Enviar a Diseño" en la solicitud.' : bloqueada ? 'La solicitud está cerrada o ya es pedido.' : null}
                                                    onCargado={() => hacer(async () => { })} />
                                            </section>
                                        );
                                    })()}
                                </>)}
                                {actual === 'archivos' && <TablaServicios vista="diseno" s={s} p={p} id={id} user={user} perfil={perfil} busy={busy} abierta={abierta} telas={telas} archivosDe={archivosDe} hacer={hacer} subir={subir} onAbrirFicha={onAbrirFicha} />}
                                {/* [CORREGIR EL DISEÑO 15/10] con una corrección abierta el diseñador puede corregir la tela de las piezas */}
                                {actual === 'piezas' && <PiezasTelasBloque id={id} p={p} busy={busy} puede={corrigiendo && perfil.esDisenador} hacer={hacer} artes={artes} />}
                                {actual === 'ficha' && <FichaProductoBloque f={p.FichaProducto} />}
                                {actual === 'correcciones' && <HistorialCorrecciones s={s} p={p} />}
                                {/* El pedido de producción lo crea el diseñador desde acá, con la tizada y los archivos ya cargados */}
                                {actual === 'pedido' && (
                                    <div className="max-w-3xl">
                                        <Conversion s={s} p={p} pedido={conv.pedido} faltantes={conv.faltantes || []} avisos={conv.avisos || []} checklist={conv.checklist} puedeVender={perfil.esDisenador || perfil.esVendedor} busy={busy} hacer={hacer} id={id} />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
    );
}

// ── [CORREGIR EL DISEÑO 15/10] ─────────────────────────────────────────────────────────────────────────────────────
// Un producto que ya es pedido y salió mal (la tizada o el DTF): se abre una corrección con el motivo, se rediseña (TIZADA
// PRO / Archivos) y lo nuevo va al MISMO pedido (services/solicitudesVendedorCorreccion.js). Acá: abrir, cancelar y ver
// qué le va a pasar a cada orden, y "Pasar al pedido" (lo hace el servidor con el plan que arma él mismo).
const corrigiendoDe = (s, p) => !!p.PedidoNoDocERP && !!p.Datos?.correccion?.activa && s.Estado !== 'CANCELADA';
const ACCION_CORRECCION = {
    REEMPLAZAR: { txt: 'Se cambia el archivo', cls: 'bg-emerald-50 text-emerald-700' },
    IMPRESA: { txt: 'Ya impresa: va por falla', cls: 'bg-sky-50 text-sky-700' },
    SACAR_DEL_ROLLO: { txt: 'La planta la saca del rollo', cls: 'bg-amber-50 text-amber-700' },
    REVISAR: { txt: 'Hablar con la planta', cls: 'bg-rose-50 text-rose-700' },
    SIN_CAMBIOS: { txt: 'Sin cambios', cls: 'bg-slate-100 text-slate-600' },
};
function CorreccionDiseno({ s, p, id, busy, hacer, corrigiendo }) {
    const [abriendo, setAbriendo] = useState(false);
    const [motivo, setMotivo] = useState('');
    const [plan, setPlan] = useState(null);
    const [dialogo, preguntar] = useConfirmar();
    const corr = p.Datos?.correccion || null;
    // el plan se vuelve a leer cuando cambian los diseños prontos (se rehizo la tizada, se subió o quitó un archivo)
    const clave = JSON.stringify([corrigiendo, s.Archivos.filter(a => a.Vigente && a.Rol === 'DISENO_PRONTO').map(a => [a.ArchivoID, a.Material, a.Copias])]);
    useEffect(() => {
        if (!corrigiendo) { setPlan(null); return undefined; }
        let vivo = true;
        svc.correccionPlan(id, p.ProductoSolID).then(r => { if (vivo) setPlan(r); }).catch(e => { if (vivo) setPlan({ error: errorDe(e) }); });
        return () => { vivo = false; };
    }, [clave]);   // eslint-disable-line react-hooks/exhaustive-deps
    // "Pasar al pedido": antes se dice orden por orden qué va a pasar
    const pasar = async () => {
        const de = (k) => plan.ordenes.filter(o => o.accion === k).map(o => o.Codigo);
        const cambia = de('REEMPLAZAR'), impresas = de('IMPRESA'), enRollo = de('SACAR_DEL_ROLLO');
        const ok = await preguntar({
            Icono: Send, titulo: `Pasar la corrección al pedido ${p.PedidoNoDocERP}`, boton: 'Pasar al pedido',
            texto: [cambia.length && `Se cambia el archivo en ${cambia.join(', ')}.`,
                impresas.length && `No se tocan las ya impresas (${impresas.join(', ')}): si hay que reimprimirlas, se reporta como falla en la planta.`,
                enRollo.length && `Quedan para después, cuando la planta las saque del rollo: ${enRollo.join(', ')}.`].filter(Boolean).join(' '),
            nota: 'Los archivos nuevos pasan a producción en unos segundos. Queda en el historial de la solicitud y de cada orden.',
        });
        if (!ok) return;
        await hacer(async () => {
            const r = await svc.correccionAplicar(id, p.ProductoSolID);
            toast.success(`Corrección pasada al pedido ${r.pedido}: ${(r.hechas || []).map(h => h.codigo).join(', ')}.${r.cerrada ? ' Corrección cerrada.' : ' Sigue abierta para lo que falta.'}`);
            if (r.noSe?.length) toast.error(`No se pudo: ${r.noSe.map(x => `${x.codigo} (${x.motivo})`).join(' · ')}`);
        });
    };

    if (!corrigiendo) {
        return (
            // 15/10: resaltado (antes texto chico gris): es lo primero que tiene que ver el diseñador en un producto que ya es pedido
            <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-brand-cyan/40 bg-cyan-50/70 p-4">
                <div className="flex min-w-0 items-start gap-2 text-sm font-bold text-slate-800">
                    <Factory size={18} className="mt-0.5 shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div>
                        Pedido {p.PedidoNoDocERP} ya está en producción. Si la tizada o el DTF salieron mal, se corrige desde acá y va al mismo pedido.
                        {corr?.ultimoPase && !corr.activa ? <div className="mt-1 text-xs font-normal text-slate-500">Última corrección ({fmtFechaHora(corr.ultimoPase.fecha)}{corr.ultimoPase.por ? `, ${corr.ultimoPase.por}` : ''}): {corr.ultimoPase.texto}</div> : null}
                    </div>
                </div>
                <button type="button" disabled={busy} onClick={() => setAbriendo(true)} className={BTN_PRIMARIO}><RotateCcw size={12} /> Corregir el diseño</button>
                {abriendo && (
                    <Ventana Icono={RotateCcw} titulo={`Corregir el diseño · pedido ${p.PedidoNoDocERP}`} onClose={() => setAbriendo(false)} chica
                        pie={<>
                            <button type="button" onClick={() => setAbriendo(false)} className={BTN_GRANDE_NO}>Cancelar</button>
                            <button type="button" data-autofocus disabled={!motivo.trim() || busy} className={BTN_GRANDE_SI}
                                onClick={async () => { if (await hacer(() => svc.correccionAbrir(id, p.ProductoSolID, motivo.trim()), 'Corrección abierta: ya podés cambiar la tizada y los archivos.')) { setAbriendo(false); setMotivo(''); } }}>Abrir la corrección</button>
                        </>}>
                        <div className="space-y-2 text-sm text-slate-600">
                            <p>Se vuelven a habilitar el arte, la lista, las telas, la tizada y los archivos de diseño pronto de este producto. <b>El pedido no se toca</b> hasta que lo pases.</p>
                            <p>Al pasarlo, cada orden de sublimación y de DTF: si no empezó, se le cambia el archivo; si está en un rollo sin imprimir, la planta la saca del rollo primero; si ya se imprimió, no se toca (si hay que reimprimirla, va por falla en la planta).</p>
                            <Campo label="Qué estaba mal (queda en el historial)"><textarea rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} className={INPUT} placeholder="Ej: el DTF salió con el film común y era dorado" /></Campo>
                        </div>
                    </Ventana>
                )}
            </section>
        );
    }
    return (
        <section className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/60 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="text-sm text-slate-700">
                    <b>Corrección del diseño abierta</b> sobre el pedido {p.PedidoNoDocERP}{corr?.por ? ` · la abrió ${corr.por}` : ''}{corr?.fecha ? ` el ${fmtFechaHora(corr.fecha)}` : ''}
                    <div className="text-xs text-slate-600">Motivo: {corr?.motivo}</div>
                    <div className="mt-1 text-xs text-slate-500">Cambiá lo que estaba mal en TIZADA PRO o en Archivos (abajo) y rehacé la tizada. Este cuadro muestra qué le va a pasar a cada orden del pedido.</div>
                </div>
                <button type="button" disabled={busy} className={BTN_SECUNDARIO}
                    onClick={async () => { if (await preguntar({ Icono: X, titulo: 'Cancelar la corrección', boton: 'Cancelar la corrección', peligro: true, texto: `El pedido ${p.PedidoNoDocERP} sigue como estaba. Si ya cambiaste diseños prontos en la solicitud, quedan ahí sin pasar al pedido.` })) hacer(() => svc.correccionCancelar(id, p.ProductoSolID), 'Corrección cancelada: el pedido sigue como estaba.'); }}>
                    Cancelar la corrección
                </button>
            </div>
            {!plan ? <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={12} className="animate-spin" /> Leyendo las órdenes del pedido…</div>
                : plan.error ? <div className="text-xs font-bold text-rose-700">{plan.error}</div>
                    : (
                        <>
                            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                                <table className="w-full min-w-[640px] text-xs">
                                    <thead><tr className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wide text-slate-500">
                                        <th className="px-2 py-2">Orden</th><th className="px-2 py-2">En la planta</th><th className="px-2 py-2">Qué va a pasar</th><th className="px-2 py-2">Archivos nuevos</th>
                                    </tr></thead>
                                    <tbody>
                                        {plan.ordenes.map(o => {
                                            const ac = ACCION_CORRECCION[o.accion] || ACCION_CORRECCION.SIN_CAMBIOS;
                                            return (
                                                <tr key={o.OrdenID} className="border-t border-slate-100 align-top">
                                                    <td className="px-2 py-2"><b className="font-mono">{o.Codigo}</b><div className="text-slate-500">{o.Material}</div></td>
                                                    <td className="px-2 py-2 text-slate-600">{o.EstadoenArea || o.Estado}{o.Rollo ? ` · lote ${o.Rollo}` : ''}{o.Impreso ? ' · impresa' : ''}</td>
                                                    <td className="px-2 py-2"><span className={`inline-block rounded-xl px-2 py-0.5 font-semibold ${ac.cls}`}>{ac.txt}</span><div className="mt-1 text-slate-500">{o.texto}</div></td>
                                                    <td className="px-2 py-2 text-slate-600">{o.archivos.length ? o.archivos.map(a => a.nombre).join(' · ') : '—'}</td>
                                                </tr>
                                            );
                                        })}
                                        {!plan.ordenes.length && <tr><td colSpan={4} className="px-2 py-3 text-slate-400">El pedido no tiene órdenes de sublimación ni de DTF.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                            {plan.sinOrden.map(a => <div key={a.ArchivoID} className="flex items-center gap-1 text-xs font-bold text-rose-700"><AlertTriangle size={12} /> {a.texto}</div>)}
                            {corr?.ultimoPase ? <div className="text-xs text-slate-500">Último pase ({fmtFechaHora(corr.ultimoPase.fecha)}): {corr.ultimoPase.texto}</div> : null}
                            <div className="flex flex-wrap items-center justify-end gap-2">
                                {!plan.nuevos && !plan.listo && <span className="text-xs text-slate-500">Todavía no hay archivos nuevos: rehacé la tizada o subí el archivo corregido.</span>}
                                {plan.nuevos > 0 && !plan.listo && <span className="text-xs text-slate-500">{plan.sinOrden.length || plan.ordenes.some(o => o.accion === 'REVISAR') ? 'Para pasarlo: que todos los archivos tengan su orden y que ninguna diga "Hablar con la planta".' : 'Esperá a que la planta saque del rollo las órdenes que están en un lote: después se pasa.'}</span>}
                                <button type="button" disabled={busy || !plan.listo} onClick={pasar} className={BTN_PRIMARIO}><Send size={12} /> Pasar al pedido</button>
                            </div>
                        </>
                    )}
            {dialogo}
        </section>
    );
}

// [CORREGIR EL DISEÑO 15/10] Historial de las correcciones del diseño de este producto: sale del Historial de la solicitud
// (abierta / pasada al pedido / cancelada, con el motivo y qué órdenes cambió). Lo más nuevo arriba.
const eventosCorreccion = (s, p) => (s.Eventos || []).filter(e => e.ProductoSolID === p.ProductoSolID && /^Corrección del diseño/.test(String(e.Texto || '')));
function HistorialCorrecciones({ s, p }) {
    const evs = eventosCorreccion(s, p);
    const tipo = (t) => (/^Corrección del diseño abierta/.test(t) ? { txt: 'Abierta', cls: 'bg-amber-50 text-amber-700' }
        : /^Corrección del diseño cancelada/.test(t) ? { txt: 'Cancelada', cls: 'bg-slate-100 text-slate-600' }
            : { txt: 'Pasada al pedido', cls: 'bg-emerald-50 text-emerald-700' });
    if (!evs.length) return <p className="text-sm text-slate-400">Este pedido todavía no tuvo correcciones del diseño.</p>;
    return (
        <ul className="space-y-2">
            {evs.map(ev => {
                const t = tipo(ev.Texto);
                const txt = String(ev.Texto).replace(/^Corrección del diseño /, '');
                return (
                    <li key={ev.EventoID} className="rounded-lg border border-slate-200 p-2.5 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-xl px-2 py-0.5 font-semibold ${t.cls}`}>{t.txt}</span>
                            <span className="text-slate-400">{fmtFechaHora(ev.Fecha)} · {ev.UsuarioNombre || '—'}</span>
                        </div>
                        <div className="mt-1 whitespace-pre-line text-slate-700">{txt.charAt(0).toUpperCase() + txt.slice(1)}</div>
                    </li>
                );
            })}
        </ul>
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
        <span>Ficha técnica del producto <small>del configurador · medidas, avíos, costuras, material, tallas</small></span>
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
                  <table className="w-full"><tbody>{f.avios.map((a, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1 pr-2 font-bold text-slate-800">{a.nombre}</td><td className="py-1 pr-2 text-slate-600 whitespace-nowrap">{(a.porTalle || []).length && ['u', 'par'].includes(a.unidad) ? 'según talle' : `${a.cantidad ?? ''} ${a.unidad}/prenda`}</td><td className="py-1 pr-2 text-slate-600">{a.medida || ''}</td><td className="py-1 text-slate-500">{a.nota || ''}</td></tr>)}</tbody></table>
                ) : <div className="text-slate-400">Sin avíos cargados en el configurador.</div>}
              </div>
              <div>
                <div className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1">Costuras (ISO 4915)</div>
                {f.costuras.length ? (
                  <table className="w-full"><tbody>{f.costuras.map((c, i) => <tr key={i} className="border-t border-slate-100"><td className="py-1 pr-2 font-bold text-slate-800">{i + 1}. {c.union}{c.piezas ? <span className="font-normal text-slate-500"> · {c.piezas}</span> : null}{c.avio ? <span className="font-normal text-slate-500"> · avío: {c.avio}</span> : null}</td><td className="py-1 text-slate-600">{c.codigoISO || 'Sin costura'}{c.nombre ? ` · ${c.nombre}` : ''}{c.maquina ? ` · ${c.maquina}` : ''}{c.tiempoMin != null ? ` · ${c.tiempoMin} min` : ''}</td></tr>)}</tbody></table>
                ) : <div className="text-slate-400">Sin costuras cargadas en el configurador.</div>}
              </div>
            </div>
            {/* [MEDIDAS] la hoja de medidas del configurador (el "cómo medir" ya viene resuelto) */}
            {(f.medidas || []).length > 0 && (
              <HojaMedidas medidas={f.medidas} medidasCat={[]}
                imagenUrl={f.medidasImagenUrl ? (f.medidasImagenUrl.startsWith('http') ? f.medidasImagenUrl : base + f.medidasImagenUrl) : null}
                ordenTalles={f.medidas.flatMap(m => m.talles.map(x => x.talle)).filter((x, i, l) => l.indexOf(x) === i)} />
            )}
            {f.notas.length > 0 && <ul className="list-disc pl-5 text-slate-700">{f.notas.map((n, i) => <li key={i}>{n.etiqueta ? <b>{n.etiqueta}: </b> : null}{n.valor}</li>)}</ul>}
          </div>
        </div>
      )}
    </section>
  );
}

/* Estado de UN servicio en la pantalla de Diseño: pill, tipo de trabajo, diseñador, fechas, y las
   acciones del diseñador (tomar el trabajo, aceptar un cambio del vendedor) + seguimiento en planta. */
// conTizada: producción principal con molde de TIZADA PRO; no se "toma" y la tizada se manda abajo (pestaña TIZADA PRO, 15/10)
function EstadoParteDiseno({ pa, user, perfil, busy, bloqueada, enProduccion = [], onAbrirFicha, onTomar, onAceptar, conTizada = false }) {
    const esMia = pa.DisenadorID && pa.DisenadorID === user?.id;
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
            {/* Con molde de TIZADA PRO no se toma: "Enviar a TIZADA PRO" / "Rehacer la tizada" están abajo, junto a "Revisar en TIZADA" (15/10) */}
            {!conTizada && !bloqueada && perfil.esDisenador && pa.Estado === 'ENVIADO_DISENO' && <button disabled={busy} onClick={onTomar} className={BTN_PRIMARIO}>Tomar este trabajo</button>}
        </div>
    );
}

/* Tabla de servicios de UN producto. vista "cliente" (pestaña del producto): servicio, archivos
   del cliente y estado con "Enviar a Diseño". vista "diseno" (pantalla de Diseño): además la
   columna del diseño pronto, y los archivos del cliente en solo lectura. */
export function TablaServicios({ vista, s, p, id, user, perfil, busy, abierta, telas: telasSB, archivosDe, hacer, subir, onAbrirFicha, faltaSubl = null, partes = null, titulo = null, subtitulo = null }) {
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
    // [CORREGIR EL DISEÑO 15/10] en la pantalla de Diseño, con una corrección abierta, se vuelven a subir los diseños prontos
    const corrigiendo = vista === 'diseno' && corrigiendoDe(s, p);
    const bloqueada = corrigiendo ? !perfil.esDisenador : (!abierta || !!p.PedidoNoDocERP);
    const esDiseno = vista === 'diseno';
    // La tela de cada archivo de la sublimación se elige entre las telas que el vendedor puso en
    // "Piezas y telas"; si no cargó nada (o no coinciden por nombre), queda el catálogo completo.
    const elegidas = new Set((p.Datos?.sublimacion?.piezas || []).map(z => normTxt(z.telaNombre)).filter(Boolean));
    const telasElegidas = telas.filter(t => elegidas.has(normTxt(t.Material)));
    const telasPrincipal = telasElegidas.length ? telasElegidas : telas;
    // [15/10] con molde de TIZADA PRO la tizada va por la pestaña TIZADA PRO: no se muestra el recuadro viejo "Tizada (TizadaPro)"
    const conTizadaPro = p.TipoFabricacion === 'PRODUCTO_TERMINADO' && !!p.Config?.TizadaProMoldeRef;
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
                            : <th colSpan={2}>{titulo || 'Producción principal'} <small>{subtitulo ?? 'lo que pidió y mandó · el diseño lo sigue Diseño desde su bandeja'}</small></th>}
                    </tr>
                    <tr className="border-t border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-400 text-left">
                        <th className={`px-3 py-2 ${esDiseno ? 'w-[34%]' : 'w-[45%]'}`}>{esDiseno ? 'Servicio y archivos del cliente' : 'Servicio'}</th>
                        {!esDiseno && <th className="px-3 py-2">Archivos del cliente</th>}
                        {esDiseno && <th className="px-3 py-2">Diseño pronto (lo que va a producción)</th>}
                    </tr>
                </thead>
                <tbody>
                    {(partes || p.Partes).map(pa => (
                        <FilaServicio key={pa.ParteID} vista={vista} pa={pa} user={user} perfil={perfil} busy={busy} bloqueada={bloqueada} corrigiendo={corrigiendo && ['PRINCIPAL', 'DTF'].includes(pa.Tipo)} telas={telasPrincipal}
                            archivosProducto={pa.Tipo === 'PRINCIPAL' ? archivosDe(a => a.ProductoSolID === p.ProductoSolID && !a.ParteID) : []}
                            enProduccion={(conv.disenoProduccion || []).filter(o => o.AreaID === ({ BORDADO: 'EMB', TPU: 'TPU' })[pa.Tipo])} onAbrirFicha={onAbrirFicha}
                            archivos={archivosDe(a => a.ParteID === pa.ParteID)} faltaEnvio={pa.Tipo === 'PRINCIPAL' ? faltaSubl : null}
                            onEnviar={(tt) => hacer(() => svc.enviarADiseno(pa.ParteID, tt, false), `${NOMBRE_PARTE[pa.Tipo]} enviado a la bandeja de Diseño.`)}
                            onTomar={() => hacer(() => svc.tomar(pa.ParteID), 'Trabajo tomado: quedó a tu nombre.')}
                            onAceptar={() => hacer(() => svc.aceptarCambio(pa.ParteID), 'Cambio aceptado.')}
                            onSubir={(files, campos) => subir(files, { ...campos, ParteID: pa.ParteID }, pa.Tipo)}
                            onQuitar={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Archivo quitado.')}
                            onDeshacerDisenado={(lista) => hacer(async () => { for (const a of lista) await svc.quitarArchivo(id, a.ArchivoID); }, `${pa.Nombre}: volvió a "Ingresado". Ahora se puede enviar a Diseño.`)}
                            onProduccion={(a, datos) => hacer(() => svc.definirProduccionArchivo(id, a.ArchivoID, datos), 'Tela y copias guardadas.')}
                            tizada={(s.Tizadas || []).find(t => t.ParteID === pa.ParteID) || null} conTizadaPro={conTizadaPro}
                            onVincularTizada={(trabajoId, forzar) => hacer(() => svc.vincularTizada(pa.ParteID, trabajoId, forzar), 'Tizada vinculada. Ahora subí el PDF de cada hoja.')} />
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function FilaServicio({ vista = 'cliente', pa, user, perfil, busy, bloqueada, corrigiendo = false, telas, archivos, onEnviar, onTomar, onAceptar, onSubir, onQuitar, onProduccion, enProduccion = [], onAbrirFicha, tizada = null, conTizadaPro = false, onVincularTizada, faltaEnvio = null, onDeshacerDisenado, archivosProducto = [] }) {
    const [tipoTrabajo, setTipoTrabajo] = useState(pa.ArteOrigen === 'CLIENTE' ? 'REVISAR' : 'DESDE_CERO');
    const [dialogo, preguntar] = useConfirmar();   // confirmaciones con el estilo del sistema (06/10; antes window.confirm)
    const esDiseno = vista === 'diseno';
    const esPrincipal = pa.Tipo === 'PRINCIPAL';
    const esMia = pa.DisenadorID && pa.DisenadorID === user?.id;
    // corrigiendo (15/10): con una corrección abierta, cualquier diseñador sube el diseño pronto corregido de la principal / DTF
    const puedeDisenar = (corrigiendo && perfil.esDisenador) || (!bloqueada && (esMia || (perfil.esAdmin && pa.DisenadorID)) && ['DISENO_INICIADO', 'DISENADO'].includes(pa.Estado));
    // RN-SOL.20: arte listo del cliente en un servicio adicional → el vendedor adjunta el diseño pronto sin pasar por Diseño.
    // 15/10: en la pantalla de Diseño el botón dice lo de siempre ("Subir diseño pronto"): "sin pasar por Diseño" confundía estando en Diseño.
    const vendedorDirecto = !bloqueada && perfil.esVendedor && !esPrincipal && !pa.DisenadorID && ['INGRESADO', 'DISENADO'].includes(pa.Estado);
    const puedeSubirPronto = puedeDisenar || vendedorDirecto;
    const prontos = archivos.filter(a => a.Rol === 'DISENO_PRONTO');
    const otros = archivos.filter(a => a.Rol !== 'DISENO_PRONTO');
    const d = pa.Datos || {};
    // [TIPO POR OBJETO 15/10] DTF: qué objeto va en cada film (el del archivo del objeto o, sin tipo propio, el del servicio).
    // Con más de uno, va un pliego por film y cada pliego lleva el suyo.
    const porFilm = pa.Tipo !== 'DTF' ? {} : otros.filter(a => a.Rol === 'ARTE_CLIENTE').reduce((m, a) => {
        const f = a.Material || d.material || 'sin film';
        return { ...m, [f]: [...(m[f] || []), String(a.NombreOriginal || '').replace(/^EDITABLE_/i, '').replace(/_DTF_A\d+\.png$/i, '').replace(/^[^_]+__/, '').replace(/_/g, ' ')] };
    }, {});
    const filmes = Object.keys(porFilm).filter(f => f !== 'sin film');
    const variosFilms = filmes.length > 1;
    const resumenFilms = variosFilms && (
        <div className="text-[11px] text-slate-600 pt-1">
            <div className="font-bold text-amber-700">Un pliego por film:</div>
            {Object.entries(porFilm).map(([f, objs]) => <div key={f}><b>{f}</b>: {objs.join(' · ')}</div>)}
        </div>
    );

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
            {resumenFilms}
            {pa.Observaciones && <div className="text-slate-500 whitespace-pre-line pt-1">Indicaciones: {pa.Observaciones}</div>}
            {!esDiseno && (
                <div className="pt-1.5 flex flex-wrap items-center gap-1.5">
                    <Pastilla e={pa.Estado} mapa={ESTADO_PARTE} />{pa.Modificada ? <PastillaModificada /> : null}
                    {pa.DisenadorNombre && <span className="text-[10px] text-slate-500">{pa.DisenadorNombre}</span>}
                    {!bloqueada && perfil.esVendedor && pa.Estado === 'INGRESADO' && vista !== 'cliente' && (faltaEnvio
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
            {resumenFilms}
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
            {/* El recuadro viejo (vincular a mano un trabajo de TizadaPro) solo sin molde de TIZADA PRO, o si ya tenía una vinculada */}
            {esPrincipal && (!conTizadaPro || tizada) && <TizadaBloque pa={pa} tizada={tizada} prontos={prontos} puede={puedeDisenar} busy={busy} onVincular={onVincularTizada} onSubirHoja={(files, hoja) => onSubir(files, { Rol: 'DISENO_PRONTO', TizadaID: tizada.TizadaID, TizadaHoja: hoja.archivo })} />}
            {esPrincipal && !tizada && <div className="text-[10px] text-slate-500 mb-1">{conTizadaPro
                ? 'La tizada de TIZADA PRO llega sola acá como diseño pronto (se manda desde la pestaña TIZADA PRO). Cada archivo lleva su tela y sus copias.'
                : 'Si la tizada no sale de TizadaPro, subí acá el archivo que se imprime en sublimación (uno o varios). Cada archivo lleva su tela y sus copias.'}</div>}
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
                        {pa.Tipo === 'DTF' && <TelaCopias soloCopias a={a} telas={[]} filmes={variosFilms ? filmes : null} filmServicio={d.material} puede={puedeSubirPronto} busy={busy} onGuardar={(datos) => onProduccion(a, datos)} />}
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
                        etiqueta={vendedorDirecto && !puedeDisenar && !esDiseno ? 'Adjuntar diseño pronto (arte listo del cliente, sin pasar por Diseño)' : (esPrincipal ? (prontos.length ? 'Agregar otra tizada / archivo de impresión' : 'Subir la tizada / archivo de impresión (marca el servicio como Diseñado)') : (prontos.length ? 'Agregar otro archivo de diseño pronto' : 'Subir diseño pronto (marca el servicio como Diseñado)'))} />
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
// cliente (pedido de la Tienda del portal): sin botón de guardar, cada cambio se guarda solo
// comoTienda (vendedor con TIZADA PRO, 14/10): igual que el portal; además, sin nada elegido arranca solo con el modelo y
// la tela por defecto (lo que hace el servidor al abrir el pedido de la Tienda) y, completa, queda en una línea.
function PiezasTelasBloque({ id, p, busy, puede, hacer, artes = [], onEstado, plano = false, conTizada = false, cliente = false, comoTienda = false }) {
    const zona = plano ? 'pt-3 mt-3 border-t border-slate-200' : ZONA;
    const tit = plano ? SUBTIT : TIT_ZONA;
    const tienda = cliente || comoTienda;
    const [info, setInfo] = useState(null);      // respuesta de moldeDelProducto
    const [modelo, setModelo] = useState('');
    const [piezas, setPiezas] = useState({});    // pieza → { telaProIdProducto, archivoId, nota }
    const [editando, setEditando] = useState(false);
    const arranco = useRef(false);               // el modelo y la tela de arranque se guardan una sola vez
    const [intento, setIntento] = useState(0);   // "Reintentar" cuando no se pudo leer el molde
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
            // Portal: sin nada elegido, cada pieza arranca con la tela del producto (la única o la marcada por defecto)
            const telaInicial = r.telas?.length === 1 ? r.telas[0] : r.telas?.find(t => t.esDefault);
            if (tienda && !r.elegido && telaInicial) (r.modelos?.find(x => x.clave === m)?.piezas || []).forEach(z => { if (!z.telaFija) ini[z.pieza] = { telaProIdProducto: telaInicial.proIdProducto }; });
            setPiezas(ini);
            // Vendedor como la Tienda: el modelo y la tela de arranque quedan guardados solos (sin tela por defecto, el
            // modelo nomás y las piezas quedan para elegir)
            if (comoTienda && !cliente && puede && r.aplica && !r.elegido && m && !arranco.current) {
                arranco.current = true;
                setEditando(false);
                hacer(() => svc.guardarSublimacion(id, p.ProductoSolID, {
                    modeloClave: m, parcial: !telaInicial,
                    piezas: (r.modelos.find(x => x.clave === m)?.piezas || []).map(z => ({ pieza: z.pieza, telaProIdProducto: z.telaFija ? null : (telaInicial?.proIdProducto || null) })),
                }));
                return;
            }
            // Portal: lo que el cliente está cambiando queda abierto aunque se recargue al guardar solo
            setEditando(e => (tienda && e ? true : !r.elegido));
        }).catch((e) => { if (vivo) { setInfo({ aplica: false, error: errorDe(e) }); onEstado?.({ aplica: false }); } });
        return () => { vivo = false; };
    }, [id, p.ProductoSolID, guardado?.fecha, intento]);   // eslint-disable-line react-hooks/exhaustive-deps
    // Portal: cada pieza con su vista del arte del cliente (el del primer diseño) y su tela a un toque
    const vistasArte = usePiezasArte(tienda ? id : null, tienda ? (p.Datos?.tizadaPro?.disenos || []).find(d => d.arteArchivoId)?.arteArchivoId : null);
    const [piezaAbierta, setPiezaAbierta] = useState(null);

    if (!info) return null;
    // El título en una línea (sin el margen de abajo) y las telas elegidas, para las vistas de una sola línea
    const titEnLinea = tit.replace(/\bmb-[\d.]+/, 'mb-0');
    const telasUsadas = [...new Set((guardado?.piezas || []).filter(z => !z.fija).map(z => z.telaNombre).filter(Boolean))];
    const modeloYTela = guardado ? <span className="text-slate-600">modelo <b>{guardado.modeloNombre}</b>{telasUsadas.length ? <> · tela <b>{telasUsadas.join(' · ')}</b></> : null}</span> : null;
    // No se pudo leer el molde (ej. la base de TIZADA PRO no responde): antes no se veía nada y no había dónde elegir el
    // modelo. Ahora se dice, con lo que ya estaba elegido, y se puede reintentar (14/10)
    if (info.error) return (
        <div className={`${plano ? 'pt-3 mt-3 border-t border-slate-200' : ''} flex flex-wrap items-center gap-2 text-xs`}>
            <span className={titEnLinea}>{plano ? '2 · ' : ''}Piezas y telas</span>
            {modeloYTela}
            <span className="text-amber-700 font-bold inline-flex items-center gap-1"><AlertTriangle size={12} /> {cliente ? 'No pudimos leer el molde del producto: probá de nuevo en un rato.' : `No se pudo leer el molde, así que no se puede cambiar el modelo ni las telas: ${info.error}`}</span>
            <button type="button" onClick={() => { setInfo(null); setIntento(n => n + 1); }} className={`${BTN_SECUNDARIO} ml-auto`}><RefreshCw size={11} /> Reintentar</button>
        </div>
    );
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
    // Portal: se guarda solo (parcial: lo que falte se ve como "Faltan telas")
    const autoguardar = (clave, pzs) => tienda && hacer(() => svc.guardarSublimacion(id, p.ProductoSolID, {
        modeloClave: clave, parcial: true,
        piezas: (info.modelos.find(m => m.clave === clave)?.piezas || []).map(z => ({ pieza: z.pieza, ...(pzs[z.pieza] || {}) })),
    }));
    const set = (pieza, campo, v, guardarYa = true) => {
        const n = { ...piezas, [pieza]: { ...(piezas[pieza] || {}), [campo]: v } };
        setPiezas(n);
        if (guardarYa) autoguardar(mod?.clave, n);
    };
    const todasEn = (v) => {
        const n = { ...piezas };
        (mod?.piezas || []).forEach(z => { if (!z.telaFija) n[z.pieza] = { ...(n[z.pieza] || {}), telaProIdProducto: v }; });
        setPiezas(n);
        autoguardar(mod?.clave, n);
    };
    // Portal: al cambiar de modelo, las piezas nuevas arrancan con la tela del producto y se guarda solo
    const cambiarModelo = (clave) => {
        setModelo(clave);
        if (!tienda) return;
        const n = { ...piezas };
        if (telaDefault) (info.modelos.find(m => m.clave === clave)?.piezas || []).forEach(z => { if (!z.telaFija && !n[z.pieza]?.telaProIdProducto) n[z.pieza] = { ...(n[z.pieza] || {}), telaProIdProducto: telaDefault.proIdProducto }; });
        setPiezas(n);
        autoguardar(clave, n);
    };
    const guardar = () => hacer(() => svc.guardarSublimacion(id, p.ProductoSolID, {
        modeloClave: mod.clave,
        piezas: (mod?.piezas || []).map(z => ({ pieza: z.pieza, ...(piezas[z.pieza] || {}) })),
    }), 'Piezas y telas guardadas.').then(ok => { if (ok) setEditando(false); });

    const Silueta = ({ z }) => z.svgPath
        ? <svg viewBox="0 0 100 100" className="w-8 h-8 shrink-0"><path d={z.svgPath} fill="#c7d2fe" stroke="#4f46e5" strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>
        : <span className="w-8 h-8 shrink-0 rounded border border-dashed border-slate-300 inline-block" />;

    // Vendedor como la Tienda: completa, en una línea (modelo y telas) con "Cambiar"; las telas de cada arte se ven y se
    // cambian en su pestaña (1 · Arte del cliente)
    if (comoTienda && !cliente && !editando && guardado?.completo) {
        return (
            <div className={`${zona} flex flex-wrap items-center gap-2 text-xs`}>
                <span className={titEnLinea}>{plano ? '2 · ' : ''}Piezas y telas</span>
                {modeloYTela}
                <span className="text-[10px] font-black uppercase text-emerald-700 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Completo</span>
                {puede && <button type="button" disabled={busy} onClick={() => setEditando(true)} className={`${BTN_SECUNDARIO} ml-auto`}><Pencil size={11} /> Cambiar</button>}
            </div>
        );
    }

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
                        const vista = tienda ? piezaDelArte(vistasArte, z.pieza, z.generico) : null;
                        // Portal y vendedor: tocar la pieza abre su tela ahí mismo (se guarda sola); las de tela fija del molde no
                        const tocable = tienda && puede && !z.fija && info.telas.length > 0;
                        const abierta = tocable && piezaAbierta === z.pieza;
                        return (
                            <TarjetaPieza key={z.pieza} titulo={z.generico || z.pieza} detalle={z.generico && z.generico !== z.pieza ? z.pieza : null}
                                figura={vista ? <PiezaConArte svgPath={det?.svgPath} vista={vista.vista} alt={z.pieza} />
                                    : (() => { const arte = z.archivoId ? artes.find(a => a.ArchivoID === z.archivoId) : null; return arte ? <Miniatura a={arte} tam={40} /> : det ? <Silueta z={det} /> : null; })()}
                                telaNombre={z.telaNombre} fija={z.fija} tocable={tocable} abierta={abierta} onAbrir={() => setPiezaAbierta(abierta ? null : z.pieza)}
                                telas={info.telas} telaId={piezas[z.pieza]?.telaProIdProducto} onElegir={(v) => { set(z.pieza, 'telaProIdProducto', v); setPiezaAbierta(null); }}
                                extra={(!conTizada || z.archivoNombre || z.nota) && <div className="text-[10px] text-slate-500 truncate">{z.archivoNombre ? <>Arte: {z.archivoNombre}</> : conTizada ? null : 'Sin arte asignado'}{z.nota ? <>{z.archivoNombre ? ' · ' : ''}{z.nota}</> : null}</div>} />
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
                    <Selector value={mod?.clave || ''} onChange={e => cambiarModelo(e.target.value)} claseBoton={claseSel(SEL_CAMPO)} disabled={info.modelos.length <= 1} anchoLista={300}>
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
                                    <td className="px-2 py-1.5"><input value={v.nota || ''} onChange={e => set(z.pieza, 'nota', e.target.value, false)} onBlur={() => autoguardar(mod?.clave, piezas)} placeholder="Ej: color, ubicación del arte" className={INPUT} maxLength={200} /></td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            {!conTizada && !artes.length && <div className="text-[10px] text-slate-500 mt-1">Para asignar un arte por pieza, subilo primero como "Arte del cliente" en el paso 1 de la producción principal (arriba).</div>}
            {tienda ? (guardado && <div className="mt-2"><button type="button" disabled={busy} onClick={() => setEditando(false)} className={BTN_SECUNDARIO}>Listo</button></div>) : (
            <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy || !mod} onClick={guardar} className={BTN_PRIMARIO}><CheckCircle2 size={12} /> Guardar piezas y telas</button>
                {guardado && <button type="button" disabled={busy} onClick={() => setEditando(false)} className={BTN_SECUNDARIO}>Cancelar</button>}
                <span className="text-[10px] text-slate-500">Hasta que cada pieza tenga su tela, la producción principal no se puede enviar a Diseño.</span>
            </div>)}
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

// filmes (DTF con objetos en más de un film, 15/10): los films para elegir el de ESTE pliego; filmServicio = el de por defecto
function TelaCopias({ a, telas, puede, busy, onGuardar, soloCopias, filmes = null, filmServicio = null }) {
    const [copias, setCopias] = useState(a.Copias || 1);
    useEffect(() => { setCopias(a.Copias || 1); }, [a.Copias]);
    const film = a.Material || filmServicio || '';
    const selectorFilm = filmes && (
        <label className={`text-[10px] ${film ? 'text-slate-500' : 'text-rose-600 font-bold'}`}>Film de este pliego
            <Selector value={film} disabled={busy || !puede} onChange={e => { if (e.target.value && e.target.value !== film) onGuardar({ Material: e.target.value === filmServicio ? '' : e.target.value, Copias: parseInt(copias, 10) || 1 }); }}
                claseBoton={claseSel('border border-slate-200 rounded-lg px-2 py-1 text-xs max-w-[220px] font-normal')} anchoLista={260}>
                {!film && <option value="">Elegir el film…</option>}
                {[...new Set([...filmes, ...(film ? [film] : [])])].map(f => <option key={f} value={f}>{f}{f === filmServicio ? ' (el del servicio)' : ''}</option>)}
            </Selector>
        </label>
    );
    if (!puede && soloCopias) return <div className="text-[11px] mt-0.5 text-slate-700">{filmes && film ? <>Film: <b>{film}</b> · </> : null}{a.Copias || 1} {(a.Copias || 1) === 1 ? 'copia' : 'copias'}{a.AltoM ? ` · ${(Number(a.AltoM) * (a.Copias || 1)).toFixed(2)} m de film` : ''}</div>;
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
            {selectorFilm}
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

// La miniatura de un archivo de Drive (Miniatura) está en solicitudesComunes: la usa también TizadaProBloque.

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
// puedeConvertir: el botón "Convertir en pedido de producción" (y la bobina). Desde la solicitud del vendedor NO (15/10):
// el vendedor solo envía a Diseño y el pedido lo crea Diseño desde su pantalla.
function Conversion({ s, p, pedido, faltantes, avisos = [], checklist, puedeVender, puedeConvertir = puedeVender, busy, hacer, id }) {
    const usaTelaCliente = !!p.Datos?.corte?.activo && p.Datos.corte.origenTela === 'TELA CLIENTE';
    const [bobinas, setBobinas] = useState(null);         // null = todavía no se pidieron
    const [bobinaId, setBobinaId] = useState('');
    useEffect(() => {
        if (usaTelaCliente && puedeConvertir && !p.PedidoNoDocERP) svc.bobinas(id).then(setBobinas).catch(() => setBobinas([]));
    }, [usaTelaCliente, puedeConvertir, p.PedidoNoDocERP, id]);
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
                {pedido?.codigosOrden?.length ? <div className="text-slate-700">Órdenes del pedido: <b>{pedido.codigosOrden.join(' · ')}</b></div> : null}
                {/* 15/10: qué tocó la última corrección del diseño (la lista de arriba es el pedido entero) */}
                {p.Datos?.correccion?.ultimoPase ? <div className="text-slate-700">Última corrección del diseño ({fmtFechaHora(p.Datos.correccion.ultimoPase.fecha)}): <b>{p.Datos.correccion.ultimoPase.texto}</b></div> : null}
                {arch.length ? <div className="text-slate-600">Archivos del pedido en producción: {subidos} de {arch.length}{pedido?.segundos != null ? ` · ${pedido.estado === 'PASANDO_ARCHIVOS' ? 'lleva' : 'tardó'} ${pedido.segundos < 60 ? `${pedido.segundos} s` : `${Math.floor(pedido.segundos / 60)} min ${pedido.segundos % 60} s`}` : ''}</div> : null}
                {/* Mientras pasa: qué está haciendo con cada archivo (se actualiza cada 5 s) */}
                {pedido?.estado === 'PASANDO_ARCHIVOS' && !pedido.archivosColgados && arch.length ? (
                    <ul className="space-y-0.5">
                        {arch.map((a, k) => (
                            <li key={k} className="flex items-center gap-1.5 text-[11px]">
                                {a.subido ? <CheckCircle2 size={11} className="text-emerald-600 shrink-0" /> : a.paso ? <Loader2 size={11} className="animate-spin text-sky-600 shrink-0" /> : a.error ? <AlertTriangle size={11} className="text-rose-600 shrink-0" /> : <span className="w-[11px] h-[11px] rounded-full border border-slate-300 shrink-0" />}
                                <span className="text-slate-700 truncate">{a.destino || a.nombre}</span>
                                <span className={a.subido ? 'text-emerald-700' : a.paso ? 'text-sky-700 font-bold' : a.error ? 'text-rose-700' : 'text-slate-400'}>
                                    — {a.subido ? 'listo' : a.paso ? `${a.paso}…` : a.error ? `falló: ${a.error}` : 'en espera'}
                                </span>
                            </li>
                        ))}
                    </ul>
                ) : null}
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
                        {/* [FASE 2 15/10] sin "Editar solicitud": la fecha y los datos se editan en el lugar */}
                        {p.Config?.TizadaProMoldeRef
                            ? <> El <b>tipo de cada extra</b> (bordado, DTF…) se elige en la tabla del arte, objeto por objeto; las <b>cantidades</b> salen de la lista de jugadores.</>
                            : <> Los <b>datos de un servicio</b> (tipo / variante, material, cantidades) se cargan con <b>"Cambiar producto o extras"</b>, arriba de esta pestaña.</>}
                        {' '}La <b>fecha</b> y el detalle, en <b>Resumen</b> → Identificación. Los <b>archivos</b> se guardan solos al subirlos.
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

            {puedeConvertir && usaTelaCliente && (
                <label className="block mt-2 text-[11px] font-bold text-slate-700">Bobina de tela del cliente (se le descuentan los metros del pedido)
                    <Selector value={bobinaId} onChange={e => setBobinaId(e.target.value)} claseBoton={claseSel('mt-1 w-full max-w-xl border border-slate-200 rounded-lg px-2 py-1.5 text-xs font-normal')} anchoLista={520}>
                        <option value="">{bobinas === null ? 'Cargando bobinas…' : bobinas.length ? 'Elegir la bobina…' : 'El cliente no tiene bobinas con metros disponibles'}</option>
                        {(bobinas || []).map(b => <option key={b.BobinaID} value={b.BobinaID}>{(b.DescripcionTela || 'Tela sin descripción').trim()} · {b.CodigoEtiqueta} · {Number(b.MetrosRestantes).toFixed(2)} m de largo · {Number(b.AnchoReal ?? b.Ancho ?? 0).toFixed(2)} m de ancho</option>)}
                    </Selector>
                </label>
            )}

            {puedeConvertir && (
                <button disabled={busy || faltantes.length > 0 || (usaTelaCliente && !bobinaId)} onClick={convertir} className={`${BTN_PRIMARIO} mt-2`} title={faltantes.length ? 'Primero completá lo que falta' : ''}>
                    Convertir en pedido de producción
                </button>
            )}
            {!puedeConvertir && puedeVender && <div className="mt-2 text-[11px] text-slate-500">El pedido de producción lo crea Diseño cuando termina. Desde acá se envía a Diseño.</div>}
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

// [GUARDADO AUTOMÁTICO 15/10] Sin "Cambiar" ni "Guardar precio pactado": cómo se cobra, la moneda y si se pide seña se
// guardan al elegirlos; el precio y el monto de la seña, al dejar el campo. Si falta un dato para poder guardar (el precio,
// el monto de la seña), se dice ahí mismo y no se guarda hasta completarlo. "Confirmar seña" sigue siendo un botón: es un
// hecho (entró la plata), no un dato.
function PrecioSena({ s, puede, busy, hacer, autoGuardar }) {
    const desdeS = () => ({ ModoCobro: s.ModoCobro || '', PrecioPactado: s.PrecioPactado ?? '', MonIdMoneda: s.MonIdMoneda || 1, RequiereSena: !!s.RequiereSena, SenaMontoRequerido: s.SenaMontoRequerido ?? '' });
    const norma = (x) => JSON.stringify([x.ModoCobro, x.ModoCobro === 'PRECIO_ESTABLECIDO' ? Number(x.PrecioPactado) || 0 : 0, Number(x.MonIdMoneda) || 1, !!x.RequiereSena, x.RequiereSena ? Number(x.SenaMontoRequerido) || 0 : 0]);
    const guardadoAhora = norma(desdeS());
    const [f, setF] = useState(desdeS);
    useEffect(() => { setF(desdeS()); }, [guardadoAhora]);   // eslint-disable-line react-hooks/exhaustive-deps
    const [sena, setSena] = useState({ SenaVia: '', SenaMonto: '', SenaReferencia: '' });
    const falta = (x) => (!x.ModoCobro ? null
        : x.ModoCobro === 'PRECIO_ESTABLECIDO' && !(Number(x.PrecioPactado) > 0) ? 'Falta el precio de la solicitud: se guarda cuando lo pongas.'
            : x.RequiereSena && !(Number(x.SenaMontoRequerido) > 0) ? 'Falta de cuánto es la seña: se guarda cuando lo pongas.' : null);
    // cambio = lo que se acaba de elegir (vacío al dejar un campo de monto)
    const guardar = async (cambio = {}) => {
        const x = { ...f, ...cambio };
        setF(x);
        if (!x.ModoCobro || falta(x) || norma(x) === guardadoAhora) return;
        if (!(await autoGuardar(() => svc.guardarPrecio(s.SolicitudID, x)))) setF(desdeS());
    };
    const MONTO = `${INPUT} max-w-[180px]`;

    return (
        <section className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <h2 className="text-[10px] font-black uppercase tracking-wide text-slate-500">Precio pactado y seña</h2>

            {!puede ? (
                <div className="grid grid-cols-2 gap-3 text-xs">
                    <Info l="Cómo se cobra" v={!s.ModoCobro ? <span className="text-rose-600 font-bold">Sin pactar</span> : s.ModoCobro === 'POR_AREA' ? 'Se factura por cada área' : 'Precio establecido (todo incluido)'} />
                    <Info l="Precio de la solicitud" v={s.ModoCobro === 'PRECIO_ESTABLECIDO' ? <b>{plata(s.PrecioPactado, s.MonIdMoneda)}</b> : '—'} />
                    <Info l="Seña" v={!s.RequiereSena ? 'No requiere' : <>Requiere <b>{plata(s.SenaMontoRequerido, s.MonIdMoneda)}</b></>} />
                    {s.RequiereSena ? <Info l="Estado de la seña" v={s.SenaConfirmada ? <span className="text-emerald-700 font-bold">Confirmada</span> : <span className="text-rose-600 font-bold">Sin confirmar — frena la conversión a pedido</span>} /> : null}
                </div>
            ) : (
                <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                        <Campo label="Cómo se cobra">
                            <Selector value={f.ModoCobro} onChange={e => guardar({ ModoCobro: e.target.value })} claseBoton={claseSel(SEL_CAMPO)} anchoLista={320}>
                                {!f.ModoCobro && <option value="">Sin pactar: elegí cómo se cobra</option>}
                                <option value="PRECIO_ESTABLECIDO">Precio establecido (un total, todo incluido)</option>
                                <option value="POR_AREA">Facturar por cada área</option>
                            </Selector>
                        </Campo>
                        <Campo label="Moneda"><Selector value={String(f.MonIdMoneda)} onChange={e => guardar({ MonIdMoneda: Number(e.target.value) })} claseBoton={claseSel(SEL_CAMPO)}>{Object.entries(MONEDA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Selector></Campo>
                    </div>
                    {f.ModoCobro === 'PRECIO_ESTABLECIDO' && (
                        <Campo label="Precio de la solicitud entera">
                            <input type="number" min="0" step="0.01" value={f.PrecioPactado} onChange={e => setF(x => ({ ...x, PrecioPactado: e.target.value }))} onBlur={() => guardar()} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} className={MONTO} />
                        </Campo>
                    )}
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                        <input type="checkbox" checked={f.RequiereSena} disabled={!f.ModoCobro || (f.RequiereSena && !!s.SenaConfirmada)} onChange={e => guardar({ RequiereSena: e.target.checked })} />
                        Requiere seña inicial{f.RequiereSena && s.SenaConfirmada ? <span className="font-normal text-slate-400">(ya está confirmada: no se puede sacar)</span> : null}
                    </label>
                    {f.RequiereSena && (
                        <Campo label="Monto de la seña requerida">
                            <input type="number" min="0" step="0.01" value={f.SenaMontoRequerido} onChange={e => setF(x => ({ ...x, SenaMontoRequerido: e.target.value }))} onBlur={() => guardar()} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} className={MONTO} />
                        </Campo>
                    )}
                    {falta(f) && <p className="text-[11px] font-bold text-amber-700 flex items-center gap-1"><AlertTriangle size={12} /> {falta(f)}</p>}
                    {s.RequiereSena && !s.SenaConfirmada ? <p className="text-[11px] font-bold text-rose-600">Seña sin confirmar: frena la conversión a pedido.</p> : null}
                </div>
            )}

            {s.RequiereSena && s.SenaConfirmada ? (
                <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-slate-700">
                    <b>{plata(s.SenaMonto, s.MonIdMoneda)}</b> por {s.SenaVia} · ref. {s.SenaReferencia}<br />
                    Confirmó {s.SenaConfirmadaPorNombre || '—'} el {fmtFechaHora(s.SenaFechaConfirma)}
                </div>
            ) : null}

            {puede && s.RequiereSena ? (
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
// 15/10: solo si hay algo fuera de lo normal (taller externo, muestra ofrecida, indicaciones o notas de solicitudes viejas).
// Sin la fecha (está en Identificación) ni "Nuestro taller" (es lo de siempre y ya no se elige).
function FichaIngreso({ s }) {
    const f = s.Ficha || {};
    const mu = f.muestra || {};
    const si = (v) => (v ? <span className="text-emerald-700 font-bold">Sí</span> : <span className="text-rose-600 font-bold">No</span>);
    const externo = f.dondeSeCose === 'EXTERNO';
    if (!externo && !mu.ofrecida && !f.indicaciones && !f.notasInternas) return null;
    return (
        <div className="border-t border-slate-100 pt-3">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 mb-2">Ficha de ingreso a producción</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                {externo && <Info l="Dónde se cose" v={`Taller externo${f.tallerExterno ? `: ${f.tallerExterno}` : ' (sin nombre)'}`} />}
                {mu.ofrecida && <Info l="Muestra" v={<>Ofrecida · {RESPUESTA_MUESTRA[mu.respuesta] || <span className="text-rose-600 font-bold">respuesta sin registrar</span>}{mu.respuesta !== 'RECHAZO' && <> · aprobada: {si(mu.aprobada)}</>}</>} />}
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
    const marcas = [d.productoNuevo && 'Producto nuevo', d.produccionGrande && 'Producción grande', d.muestraFisica && 'Muestra física o molde del cliente', d.requiereMuestra && (d.muestraAprobada ? 'Muestra: aprobada por el cliente' : PIDE_MUESTRA_APROBADA ? 'Muestra: requiere confección, SIN aprobar' : 'Muestra: requiere confección'), d.tablaEstandar && 'Tabla de medidas estándar del taller', d.personalizacion && (d.listaCerrada ? 'Nombres y números: lista cerrada' : 'Nombres y números: lista SIN cerrar')].filter(Boolean);
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
            {dis.origen && <Info l="Diseño" v={dis.origen === 'NO' ? 'No lleva diseño' : dis.origen === 'CLIENTE' ? <>Lo entrega el cliente · archivo verificado: {dis.verificado ? 'sí' : 'no'}</> : <>Lo hace el taller{PIDE_APROBACION_ESCRITA ? <> · propuesta aprobada por escrito: {dis.aprobado ? 'sí' : 'no'}</> : null}</>} />}
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
// 15/10: es una referencia → se calcula solo cada vez que se abre (con o sin fecha) y cuando cambia la fecha, un producto,
// su cantidad o sus extras. Sin botón "Recalcular". Si falla, se dice acá (sin aviso emergente).
function PanelPlazo({ s, id }) {
    const [r, setR] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState(null);
    const clave = JSON.stringify([s.FechaEntrega, s.FechaEntregaHasta, (s.Productos || []).map(p => [p.ProIdProducto, p.Cantidad, (p.Partes || []).map(x => x.Tipo)])]);
    useEffect(() => {
        let vivo = true;
        setBusy(true); setError(null);
        svc.estimarPlazo(id).then(x => { if (vivo) setR(x); }).catch(e => { if (vivo) setError(errorDe(e)); }).finally(() => { if (vivo) setBusy(false); });
        return () => { vivo = false; };
    }, [id, clave]);
    const v = r ? (VEREDICTO[r.veredicto] || VEREDICTO.SIN_DATOS) : null;
    const f = (d) => (d ? d.split('-').reverse().join('/') : '—');
    return (
        <div className="border-t border-slate-100 pt-3 text-xs space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-500 flex items-center gap-1"><CalendarClock size={12} /> ¿Se llega a la fecha de entrega? — carga real de cada sector</div>
                {busy && <span className="text-[11px] text-slate-400 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> calculando con la carga de hoy…</span>}
            </div>
            {error && !busy && <div className="text-rose-600">No se pudo calcular el plazo: {error}</div>}
            {!s.FechaEntrega && r && <div className="text-slate-500">Sin fecha del cliente: se ve cuándo terminaría. Cargala en Resumen → Identificación para saber si se llega.</div>}
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
