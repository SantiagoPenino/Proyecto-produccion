import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, Ban, CheckCircle2, ClipboardList, FileText, History, Loader2, MessageSquare, Paperclip, Pencil, RefreshCw, Send, Trash2, Upload } from 'lucide-react';
import { useAuth } from '../../../context/AuthContext';
import { fileService } from '../../../client-portal/api/fileService';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFechaHora } from '../../../utils/fechas';
import OrderDetailModal from '../../production/components/OrderDetailModal';
import {
    BTN_PELIGRO, BTN_PRIMARIO, BTN_SECUNDARIO, Campo, ESTADO_PARTE, ESTADO_SOLICITUD, INPUT, Info, MONEDA, MotivoModal,
    NOMBRE_PARTE, Pill, PillModificada, ROL_ARCHIVO, TIPO_TRABAJO, errorDe, plata,
} from './solicitudesComunes';

/**
 * Spec 41 — Detalle de una Solicitud: desde acá el vendedor adjunta archivos, libera a Diseño
 * por partes, pacta precio y seña, registra interacciones y cancela; el diseñador sube el
 * diseño pronto y acepta los cambios. Todo queda en el historial (no se edita ni se borra).
 */
const ROLES_PARTE = ['ARTE_CLIENTE', 'REFERENCIA', 'BOCETO'];
// La tizada NO va acá: es el archivo de impresión de la sublimación → se sube como diseño pronto de la producción principal.
const ROLES_PRODUCTO = ['PLANILLA', 'REFERENCIA'];

// Llevan medida la producción principal (sublimación) y el DTF. Bordado y TPU NO: su archivo se sube tal cual.
// Mismas reglas que el ingreso de pedidos de prenda (RN-SOL.14). El ancho se controla en el servidor:
// el DTF contra el film que cargó el vendedor (al subir) y la sublimación contra la tela de cada archivo (al convertir).
async function medirDisenoPronto(file, tipo) {
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
    const { user } = useAuth();
    const [s, setS] = useState(null);
    const [perfil, setPerfil] = useState({ esVendedor: false, esDisenador: false, esAdmin: false });
    const [busy, setBusy] = useState(false);
    const [subida, setSubida] = useState(null);           // { nombre, pct }
    const [cancelando, setCancelando] = useState(false);
    const [tab, setTab] = useState(null);                 // 'resumen' | 'prod-<id>' | 'precio' | 'interacciones' | 'historial'
    const [telas, setTelas] = useState([]);               // telas de sublimación (las elige el diseñador por archivo)
    const [ficha, setFicha] = useState(null);             // orden de producción abierta en su ficha (la misma del ojito)

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
                const medida = campos.Rol === 'DISENO_PRONTO' ? await medirDisenoPronto(f, tipoParte) : {};
                setSubida({ nombre: f.name, pct: 0 });
                await svc.subirArchivo(id, f, { ...campos, ...medida }, (loaded, total) => setSubida({ nombre: f.name, pct: total ? Math.round((loaded / total) * 100) : 0 }));
            }
            toast.success(lista.length === 1 ? 'Archivo guardado.' : `${lista.length} archivos guardados.`);
        } catch (e) { toast.error(errorDe(e)); }
        finally { setSubida(null); setBusy(false); await cargar(); }
    };

    if (!s) return <div className="p-10 flex justify-center"><Loader2 className="animate-spin text-indigo-500" /></div>;

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

    return (
        <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2"><Pill e={s.Estado} mapa={ESTADO_SOLICITUD} /><span className="text-[11px] text-slate-400">Solicitud #{s.SolicitudID} · {fmtFechaHora(s.FechaSolicitud)}</span></div>
                    <h1 className="text-xl font-black text-slate-800 mt-1 flex items-center gap-2"><ClipboardList size={20} className="text-indigo-500" /> {s.NombreTrabajo}</h1>
                    <p className="text-sm text-slate-600">{s.ClienteNombre}{s.ClienteCodigo ? <span className="font-mono text-xs text-slate-400"> · {s.ClienteCodigo}</span> : null} · vendedor <b>{s.VendedorNombre || '—'}</b></p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <button onClick={() => navigate(perfil.esVendedor ? '/ventas/solicitudes' : '/ventas/bandeja-diseno')} className={BTN_SECUNDARIO}><ArrowLeft size={14} /> Volver</button>
                    <button onClick={cargar} className={BTN_SECUNDARIO} title="Actualizar"><RefreshCw size={14} /></button>
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
                <div className="sticky top-2 z-20 bg-white border border-indigo-200 rounded-xl p-3 shadow">
                    <div className="text-xs font-bold text-slate-700 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Subiendo "{subida.nombre}"… {subida.pct}%</div>
                    <div className="h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${subida.pct}%` }} /></div>
                </div>
            )}

            {/* Lo importante de un vistazo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <Dato l="Cómo se cobra" v={!s.ModoCobro ? <span className="text-rose-600">Sin pactar</span> : s.ModoCobro === 'POR_AREA' ? 'Por cada área' : 'Precio establecido'} />
                <Dato l="Precio de la solicitud" v={s.ModoCobro === 'PRECIO_ESTABLECIDO' ? plata(s.PrecioPactado, s.MonIdMoneda) : '—'} />
                <Dato l="Seña" v={!s.RequiereSena ? 'No requiere' : s.SenaConfirmada ? <span className="text-emerald-700">{plata(s.SenaMonto, s.MonIdMoneda)} confirmada</span> : <span className="text-rose-600">{plata(s.SenaMontoRequerido, s.MonIdMoneda)} sin confirmar</span>} />
                {s.Productos.some(p => p.PedidoNoDocERP)
                    ? <Dato l="Pedido de producción creado" v={<span className="text-emerald-700">{s.Productos.filter(p => p.PedidoNoDocERP).map(p => p.PedidoNoDocERP).join(', ')}</span>} />
                    : <Dato l="Servicios diseñados" v={`${disenadas} de ${partes.length}`} />}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl">
                <div className="flex flex-wrap gap-1 border-b border-slate-200 px-2 pt-2">
                    {TABS.map(t => (
                        <button key={t.k} onClick={() => setTab(t.k)}
                            className={`px-3 py-2 text-xs font-bold border-b-2 -mb-px inline-flex items-center gap-1 ${tabActual === t.k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                            {t.ok ? <CheckCircle2 size={12} className="text-emerald-600" /> : null}{t.t}{t.n != null ? <span className="text-[10px] font-bold text-slate-400">{t.n}</span> : null}
                        </button>
                    ))}
                </div>

                <div className="p-4">
                    {tabActual === 'resumen' && (
                        <div className="space-y-3 text-sm">
                            <Info l="Qué pide el cliente" v={<span className="whitespace-pre-line">{s.Detalle}</span>} />
                            {s.PreNumero && <Info l="Presupuesto del que salió" v={<><b className="font-mono">{s.PreNumero}</b>{s.Presupuesto ? ` · ${s.Presupuesto.Moneda} ${Number(s.Presupuesto.Total || 0).toLocaleString('es-UY', { minimumFractionDigits: 2 })} · ${s.Presupuesto.Estado} · emitido ${fmtFechaHora(s.Presupuesto.FechaEmision)}` : ''}</>} />}
                            {s.Observaciones && <Info l="Observaciones generales" v={<span className="whitespace-pre-line">{s.Observaciones}</span>} />}
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

            {/* La MISMA ficha de la orden que se abre con el ojito en el área: ahí se sube la matriz / el boceto / el arte. */}
            <OrderDetailModal order={ficha} onClose={() => { setFicha(null); cargar(); }} onOrderUpdated={cargar} />

            {cancelando && (
                <MotivoModal titulo={`Cancelar la solicitud #${s.SolicitudID}`} etiquetaBoton="Cancelar la solicitud" busy={busy}
                    descripcion={`La solicitud queda CANCELADA: no se puede reabrir ni convertir en pedido, y todo lo que esté en Diseño sale de la bandeja.${s.SenaConfirmada ? `\n\nATENCIÓN: tiene una seña registrada de ${plata(s.SenaMonto, s.MonIdMoneda)}. Cancelar NO devuelve ni mueve ese dinero: lo resuelve Administración.` : ''}`}
                    onClose={() => setCancelando(false)}
                    onConfirm={async (motivo) => { if (await hacer(() => svc.cancelar(id, motivo), 'Solicitud cancelada.')) setCancelando(false); }} />
            )}
        </div>
    );
}

const Dato = ({ l, v }) => (
    <div className="bg-slate-50 rounded-xl px-3 py-2">
        <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{l}</div>
        <div className="text-sm font-bold text-slate-800">{v}</div>
    </div>
);

// Una pestaña por producto: datos del producto + tabla de servicios (una fila por servicio) + conversión a pedido.
function ProductoTab({ s, p, n, id, user, perfil, busy, abierta, puedeVender, telas, archivosDe, hacer, subir, onAbrirFicha }) {
    const conv = s.Conversion.find(c => c.ProductoSolID === p.ProductoSolID) || {};
    const faltantes = conv.faltantes || [];
    const bloqueada = !abierta || !!p.PedidoNoDocERP;
    const delProducto = archivosDe(a => a.ProductoSolID === p.ProductoSolID && !a.ParteID);

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-black text-slate-800">Producto {n}: {p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? (p.ProductoNombre || `Producto ${p.ProIdProducto}`) : 'Producto personalizado del cliente'} <span className="font-bold text-slate-500">· {p.Cantidad} prendas</span></h2>
                {p.PedidoNoDocERP ? <span className="text-[10px] font-black uppercase text-emerald-700">Pedido {p.PedidoNoDocERP} · {fmtFechaHora(p.FechaConversion)}</span> : null}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <Info l="Corte" v={p.Datos?.corte?.activo ? `${p.Datos.corte.tipoMolde} · ${p.Datos.corte.origenTela}` : 'No lleva'} />
                <Info l="Costura" v={p.Datos?.costura?.activo ? (p.Datos.costura.instrucciones || 'Sin instrucciones especiales') : 'No lleva'} />
                {p.Observaciones && <Info l="Observaciones" v={<span className="whitespace-pre-line">{p.Observaciones}</span>} />}
                <div>
                    <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Planilla de talles y referencias</div>
                    <ArchivosCelda archivos={delProducto} vacio="Sin archivos" puedeQuitar={puedeVender && !p.PedidoNoDocERP} onQuitar={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Archivo quitado.')} />
                    {puedeVender && !p.PedidoNoDocERP && <div className="mt-1"><BotonSubir busy={busy} roles={ROLES_PRODUCTO} onFiles={(files, Rol) => subir(files, { Rol, ProductoSolID: p.ProductoSolID })} /></div>}
                </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-xl">
                <table className="w-full text-xs min-w-[760px]">
                    <thead>
                        <tr className="bg-slate-50 text-[9px] font-black uppercase tracking-wide text-slate-500 text-left">
                            <th className="px-3 py-2 w-[22%]">Servicio</th>
                            <th className="px-3 py-2 w-[24%]">Archivos del cliente</th>
                            <th className="px-3 py-2 w-[32%]">Diseño pronto (lo que va a producción)</th>
                            <th className="px-3 py-2 w-[22%]">Estado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {p.Partes.map(pa => (
                            <FilaServicio key={pa.ParteID} pa={pa} user={user} perfil={perfil} busy={busy} bloqueada={bloqueada} telas={telas}
                                enProduccion={(conv.disenoProduccion || []).filter(o => o.AreaID === ({ BORDADO: 'EMB', TPU: 'TPU' })[pa.Tipo])} onAbrirFicha={onAbrirFicha}
                                archivos={archivosDe(a => a.ParteID === pa.ParteID)}
                                onEnviar={(tt) => hacer(() => svc.enviarADiseno(pa.ParteID, tt), `${NOMBRE_PARTE[pa.Tipo]} enviado a la bandeja de Diseño.`)}
                                onTomar={() => hacer(() => svc.tomar(pa.ParteID), 'Trabajo tomado: quedó a tu nombre.')}
                                onAceptar={() => hacer(() => svc.aceptarCambio(pa.ParteID), 'Cambio aceptado.')}
                                onSubir={(files, campos) => subir(files, { ...campos, ParteID: pa.ParteID }, pa.Tipo)}
                                onQuitar={(a) => hacer(() => svc.quitarArchivo(id, a.ArchivoID), 'Archivo quitado.')}
                                onProduccion={(a, datos) => hacer(() => svc.definirProduccionArchivo(id, a.ArchivoID, datos), 'Tela y copias guardadas.')} />
                        ))}
                    </tbody>
                </table>
            </div>

            <Conversion s={s} p={p} pedido={conv.pedido} faltantes={faltantes} avisos={conv.avisos || []} puedeVender={perfil.esVendedor} busy={busy} hacer={hacer} id={id} />
        </div>
    );
}

const ETAPA_PRODUCCION = {
    FALTA_DISENO: { txt: 'Falta diseño', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    ESPERANDO_APROBACION: { txt: 'Esperando aprobación del cliente', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
    RECHAZADO: { txt: 'Rechazado por el cliente', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    APROBADO_FALTA_ARTE: { txt: 'Aprobado · falta el arte', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

function FilaServicio({ pa, user, perfil, busy, bloqueada, telas, archivos, onEnviar, onTomar, onAceptar, onSubir, onQuitar, onProduccion, enProduccion = [], onAbrirFicha }) {
    const [tipoTrabajo, setTipoTrabajo] = useState(pa.ArteOrigen === 'CLIENTE' ? 'REVISAR' : 'DESDE_CERO');
    const esPrincipal = pa.Tipo === 'PRINCIPAL';
    const esMia = pa.DisenadorID && pa.DisenadorID === user?.id;
    const puedeDisenar = !bloqueada && (esMia || (perfil.esAdmin && pa.DisenadorID)) && ['DISENO_INICIADO', 'DISENADO'].includes(pa.Estado);
    // RN-SOL.20: arte listo del cliente en un servicio adicional → el vendedor adjunta el diseño pronto sin pasar por Diseño
    const vendedorDirecto = !bloqueada && perfil.esVendedor && !esPrincipal && !pa.DisenadorID && ['INGRESADO', 'DISENADO'].includes(pa.Estado);
    const puedeSubirPronto = puedeDisenar || vendedorDirecto;
    const prontos = archivos.filter(a => a.Rol === 'DISENO_PRONTO');
    const otros = archivos.filter(a => a.Rol !== 'DISENO_PRONTO');
    const d = pa.Datos || {};

    return (
        <tr className={`align-top border-t border-slate-200 ${pa.Modificada ? 'bg-fuchsia-50/40' : ''}`}>
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
            </td>

            <td className="px-3 py-3">
                <ArchivosCelda archivos={otros} vacio="Sin archivos" puedeQuitar={!bloqueada && perfil.esVendedor} onQuitar={onQuitar} conRol />
                {!bloqueada && perfil.esVendedor && <div className="mt-1.5"><BotonSubir busy={busy} roles={ROLES_PARTE} onFiles={(files, Rol) => onSubir(files, { Rol })} /></div>}
            </td>

            <td className="px-3 py-3">
                {!prontos.length && <div className="text-slate-400">{['BORDADO', 'TPU'].includes(pa.Tipo) ? 'Sin archivo (es opcional)' : 'Todavía no hay archivo'}</div>}
                {esPrincipal && <div className="text-[10px] text-slate-500 mb-1">Acá va la <b>tizada</b>: es el archivo que se imprime en sublimación (uno o varios). Cada archivo lleva su tela y sus copias.</div>}
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
                            <a href={a.UrlDrive} target="_blank" rel="noreferrer" className="font-bold text-indigo-700 hover:underline inline-flex items-center gap-1 break-all"><FileText size={12} /> {a.NombreOriginal}</a>
                            <div className="text-[10px] text-slate-500">{a.AnchoM && a.AltoM ? `${Number(a.AnchoM).toFixed(2)} × ${Number(a.AltoM).toFixed(2)} m · ` : ''}{a.UsuarioNombre || ''} · {fmtFechaHora(a.FechaSubida)}</div>
                            {esPrincipal && <TelaCopias a={a} telas={telas} puede={puedeDisenar} busy={busy} onGuardar={(datos) => onProduccion(a, datos)} />}
                            {pa.Tipo === 'DTF' && <TelaCopias soloCopias a={a} telas={[]} puede={puedeSubirPronto} busy={busy} onGuardar={(datos) => onProduccion(a, datos)} />}
                            {puedeSubirPronto && (
                                <div className="mt-1 flex flex-wrap items-center gap-3">
                                    <BotonArchivo etiqueta="Sustituir por el archivo corregido" chico onFiles={(files) => onSubir(files, { Rol: 'DISENO_PRONTO', ReemplazaA: a.ArchivoID })} />
                                    {prontos.length > 1 && <button type="button" disabled={busy} onClick={() => { if (window.confirm(`¿Quitar "${a.NombreOriginal}" del diseño pronto de ${pa.Nombre}? No va a ir a producción. Queda registrado en el historial.`)) onQuitar(a); }} className="text-rose-600 font-bold hover:underline inline-flex items-center gap-0.5"><Trash2 size={11} /> Quitar este archivo</button>}
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

            <td className="px-3 py-3 space-y-1">
                {enProduccion.length > 0 && (
                    <div className="bg-white border border-slate-200 rounded-lg p-2 mb-1 space-y-1">
                        <div className="text-[9px] font-black uppercase tracking-wide text-slate-400">Ya es pedido — el diseño sigue en producción</div>
                        {enProduccion.map(o => {
                            const et = ETAPA_PRODUCCION[o.Etapa] || { txt: 'No queda diseño pendiente', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
                            return (
                                <div key={o.OrdenID}>
                                    <div className="font-mono font-bold text-slate-700">{o.CodigoOrden}</div>
                                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${et.cls}`}>{et.txt}</span>
                                    <div><button type="button" onClick={() => onAbrirFicha?.({ id: o.OrdenID, area: o.AreaID, codigo: o.CodigoOrden, cliente: o.Cliente })} className="text-indigo-600 font-bold hover:underline mt-1">Abrir la ficha de la orden</button></div>
                                </div>
                            );
                        })}
                        <div className="text-[10px] text-slate-400">El estado de abajo es el que tenía en la solicitud al convertir.</div>
                    </div>
                )}
                <div className="flex flex-wrap items-center gap-1"><Pill e={pa.Estado} mapa={ESTADO_PARTE} />{pa.Modificada ? <PillModificada /> : null}</div>
                {pa.TipoTrabajo && <div className="text-slate-500">{TIPO_TRABAJO[pa.TipoTrabajo]}</div>}
                {pa.DisenadorNombre && <div className="text-slate-600">Diseñador: <b>{pa.DisenadorNombre}</b></div>}
                {pa.FechaEnvioDiseno && <div className="text-[10px] text-slate-400">Enviado a diseño {fmtFechaHora(pa.FechaEnvioDiseno)}</div>}
                {pa.FechaInicioDiseno && <div className="text-[10px] text-slate-400">Diseño iniciado {fmtFechaHora(pa.FechaInicioDiseno)}</div>}
                {pa.FechaDisenado && <div className="text-[10px] text-slate-400">Diseñado {fmtFechaHora(pa.FechaDisenado)}</div>}

                {pa.Modificada ? (
                    <div className="bg-white border border-fuchsia-200 rounded-lg p-2 mt-1">
                        <div className="font-black text-fuchsia-700">El vendedor cambió este servicio el {fmtFechaHora(pa.ModificadaFecha)}:</div>
                        <div className="text-slate-700 whitespace-pre-line">{pa.ModificadaDetalle}</div>
                        {!bloqueada && (esMia || perfil.esAdmin) && pa.DisenadorID
                            ? <button disabled={busy} onClick={onAceptar} className={`${BTN_PRIMARIO} mt-2`}><CheckCircle2 size={12} /> Acepto el cambio (estoy al tanto)</button>
                            : !bloqueada && !pa.DisenadorID && pa.Estado === 'DISENADO' && perfil.esVendedor
                                ? <><div className="text-[11px] text-slate-500 mt-1">Este servicio no pasó por Diseño (el diseño pronto lo adjuntó el vendedor): no hay diseñador que lo acepte. Revisá que el archivo siga sirviendo con el cambio.</div>
                                    <button disabled={busy} onClick={onAceptar} className={`${BTN_PRIMARIO} mt-2`}><CheckCircle2 size={12} /> Confirmo el cambio: el diseño pronto sigue sirviendo</button></>
                                : <div className="text-[11px] text-slate-500 mt-1">{pa.DisenadorID ? `Lo tiene que aceptar ${pa.DisenadorNombre || 'el diseñador'}: entra a esta misma solicitud desde su Bandeja de Diseño y acá le aparece el botón "Acepto el cambio".` : 'Lo acepta el diseñador que tome el trabajo desde la Bandeja de Diseño.'} Mientras tanto el producto no se puede convertir en pedido.</div>}
                    </div>
                ) : null}

                {!bloqueada && perfil.esVendedor && pa.Estado === 'INGRESADO' && (
                    <div className="pt-1 space-y-1">
                        <select value={tipoTrabajo} onChange={e => setTipoTrabajo(e.target.value)} className="block w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                            {Object.entries(TIPO_TRABAJO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                        </select>
                        <button disabled={busy} onClick={() => onEnviar(tipoTrabajo)} className={BTN_PRIMARIO}><Send size={12} /> Enviar a Diseño</button>
                    </div>
                )}
                {!bloqueada && perfil.esDisenador && pa.Estado === 'ENVIADO_DISENO' && <button disabled={busy} onClick={onTomar} className={BTN_PRIMARIO}>Tomar este trabajo</button>}
            </td>
        </tr>
    );
}

// Tela y copias de UN archivo de la producción principal. Las carga el diseñador; el archivo
// es siempre normal (sin escala ni raport).
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
                <select value={a.CodArticulo || ''} disabled={busy} onChange={e => { if (e.target.value) onGuardar({ CodArticulo: e.target.value, Copias: parseInt(copias, 10) || 1 }); }}
                    className={`block border rounded-lg px-2 py-1 text-xs bg-white max-w-[200px] font-normal text-slate-800 ${a.Material ? 'border-slate-200' : 'border-rose-300'}`}>
                    <option value="">Elegir la tela…</option>
                    {a.CodArticulo && !telas.some(t => t.CodArticulo === a.CodArticulo) && <option value={a.CodArticulo}>{a.Material}</option>}
                    {telas.map(t => <option key={t.CodArticulo} value={t.CodArticulo}>{t.Material}</option>)}
                </select>
            </label>}
            <label className="text-[10px] text-slate-500">{soloCopias ? 'Copias de este archivo' : 'Copias'}
                <input type="number" min="1" step="1" value={copias} disabled={busy} onChange={e => setCopias(e.target.value)} onBlur={guardarCopias}
                    className="block w-14 border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white text-slate-800" />
            </label>
            <span className="text-[10px] text-slate-400 pb-1">{soloCopias && a.AltoM ? `= ${(Number(a.AltoM) * (parseInt(copias, 10) || 1)).toFixed(2)} m de film · ` : ''}Se guarda solo al cambiar</span>
        </div>
    );
}

function ArchivosCelda({ archivos, vacio, puedeQuitar, onQuitar, conRol }) {
    if (!archivos.length) return <div className="text-slate-400">{vacio}</div>;
    return (
        <ul className="space-y-1.5">
            {archivos.map(a => (
                <li key={a.ArchivoID}>
                    <a href={a.UrlDrive} target="_blank" rel="noreferrer" className="font-bold text-indigo-700 hover:underline inline-flex items-center gap-1 break-all"><FileText size={12} /> {a.NombreOriginal}</a>
                    <div className="text-[10px] text-slate-500">
                        {conRol || a.Rol ? (ROL_ARCHIVO[a.Rol] || a.Rol) : ''} · {a.UsuarioNombre || ''} · {fmtFechaHora(a.FechaSubida)}
                        {puedeQuitar && onQuitar && <button onClick={() => { if (window.confirm(`¿Quitar "${a.NombreOriginal}" de la solicitud? Queda registrado en el historial.`)) onQuitar(a); }} className="ml-2 text-rose-600 hover:underline inline-flex items-center gap-0.5"><Trash2 size={11} /> Quitar</button>}
                    </div>
                </li>
            ))}
        </ul>
    );
}

// Conversión del producto en pedido de producción: qué falta, el botón, y cómo quedó.
function Conversion({ s, p, pedido, faltantes, avisos = [], puedeVender, busy, hacer, id }) {
    const navigate = useNavigate();
    const usaTelaCliente = !!p.Datos?.corte?.activo && p.Datos.corte.origenTela === 'TELA CLIENTE';
    const [bobinas, setBobinas] = useState(null);         // null = todavía no se pidieron
    const [bobinaId, setBobinaId] = useState('');
    useEffect(() => {
        if (usaTelaCliente && puedeVender && !p.PedidoNoDocERP) svc.bobinas(id).then(setBobinas).catch(() => setBobinas([]));
    }, [usaTelaCliente, puedeVender, p.PedidoNoDocERP, id]);
    if (s.Estado === 'CANCELADA') return null;
    const creado = pedido && ['PASANDO_ARCHIVOS', 'CREADO', 'ERROR_ARCHIVOS'].includes(pedido.estado);
    const convertir = () => {
        const txt = `Vas a crear el pedido de producción del Producto "${p.TipoFabricacion === 'PRODUCTO_TERMINADO' ? (p.ProductoNombre || p.ProIdProducto) : 'personalizado del cliente'}" (${p.Cantidad} prendas).\n\nEntra a producción igual que si lo cargaras en "Ventas → Pedido de prenda": se crean las órdenes de cada área y se les pasan los archivos de diseño pronto.\n\nNo se puede deshacer desde acá. ¿Crear el pedido?`;
        if (!window.confirm(txt)) return;
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
                    </>
                )}
            </div>
        );
    }

    return (
        <div className={`rounded-xl border p-3 text-xs ${faltantes.length ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/60'}`}>
            {faltantes.length ? (
                <>
                    <div className="font-black text-amber-800 flex items-center gap-1"><AlertTriangle size={13} /> Para convertir este producto en pedido falta:</div>
                    <ul className="list-disc pl-5 mt-1 text-slate-700 space-y-0.5">{faltantes.map((f, k) => <li key={k}>{f}</li>)}</ul>
                    <div className="mt-2 text-[11px] text-slate-600 bg-white border border-amber-200 rounded-lg p-2">
                        <b>Dónde se completa cada cosa:</b> la <b>tela y las copias</b> las carga el diseñador en esta misma tabla, columna "Diseño pronto", debajo de cada archivo (se guardan solas al cambiar).
                        Los <b>datos de un servicio</b> (tipo / variante, material, cantidades) se cargan en
                        {' '}{puedeVender ? <button type="button" onClick={() => navigate(`/ventas/solicitudes/${id}/editar`)} className="text-indigo-600 font-bold hover:underline">Editar solicitud</button> : <b>Editar solicitud</b>}
                        {' '}y se guardan con "Guardar cambios de la solicitud". Los <b>archivos</b> se guardan solos al subirlos.
                    </div>
                </>
            ) : <div className="font-black text-emerald-800 flex items-center gap-1"><CheckCircle2 size={13} /> Este producto tiene todo para convertirse en pedido de producción.</div>}

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
                    <select value={bobinaId} onChange={e => setBobinaId(e.target.value)} className="block mt-1 w-full max-w-xl border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white font-normal">
                        <option value="">{bobinas === null ? 'Cargando bobinas…' : bobinas.length ? 'Elegir la bobina…' : 'El cliente no tiene bobinas con metros disponibles'}</option>
                        {(bobinas || []).map(b => <option key={b.BobinaID} value={b.BobinaID}>{(b.DescripcionTela || 'Tela sin descripción').trim()} · {b.CodigoEtiqueta} · {Number(b.MetrosRestantes).toFixed(2)} m de largo · {Number(b.AnchoReal ?? b.Ancho ?? 0).toFixed(2)} m de ancho</option>)}
                    </select>
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
    if (!archivos.length) return destacado ? <p className="text-[11px] text-slate-400">Diseño pronto: todavía no hay archivo.</p> : null;
    return (
        <div>
            <div className="text-[9px] font-black uppercase tracking-wide text-slate-400 mb-1">{titulo}</div>
            <ul className="space-y-1">
                {archivos.map(a => (
                    <li key={a.ArchivoID} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs ${destacado ? 'bg-emerald-50 border border-emerald-200' : 'bg-slate-50'}`}>
                        <a href={a.UrlDrive} target="_blank" rel="noreferrer" className="font-bold text-indigo-700 hover:underline inline-flex items-center gap-1 break-all"><FileText size={12} /> {a.NombreOriginal}</a>
                        <span className="text-[10px] text-slate-500 flex items-center gap-2">
                            {ROL_ARCHIVO[a.Rol] || a.Rol}{a.AnchoM && a.AltoM ? ` · ${Number(a.AnchoM).toFixed(2)} × ${Number(a.AltoM).toFixed(2)} m` : ''} · {a.UsuarioNombre || ''} · {fmtFechaHora(a.FechaSubida)}
                            {onSustituir && <BotonArchivo etiqueta="Sustituir por el archivo corregido" chico onFiles={(files) => onSustituir(a, files)} />}
                            {puedeQuitar && onQuitar && <button onClick={() => { if (window.confirm(`¿Quitar "${a.NombreOriginal}" de la solicitud? Queda registrado en el historial.`)) onQuitar(a); }} className="text-rose-600 hover:underline inline-flex items-center gap-0.5"><Trash2 size={11} /> Quitar</button>}
                        </span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function BotonArchivo({ etiqueta, onFiles, busy, multiple, primario, chico }) {
    const ref = useRef(null);
    return (
        <>
            <input ref={ref} type="file" hidden multiple={!!multiple} onChange={e => { const fs = e.target.files; if (fs?.length) onFiles(fs); e.target.value = ''; }} />
            <button type="button" disabled={busy} onClick={() => ref.current?.click()} className={chico ? 'text-indigo-600 font-bold hover:underline inline-flex items-center gap-0.5' : (primario ? BTN_PRIMARIO : BTN_SECUNDARIO)}><Upload size={chico ? 11 : 12} /> {etiqueta}</button>
        </>
    );
}

function BotonSubir({ roles, onFiles, busy }) {
    const [rol, setRol] = useState(roles[0]);
    return (
        <span className="inline-flex items-center gap-1">
            <select value={rol} onChange={e => setRol(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                {roles.map(r => <option key={r} value={r}>{ROL_ARCHIVO[r]}</option>)}
            </select>
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
                {puede && !editando && <button onClick={abrir} className="text-xs font-bold text-indigo-600 hover:underline">{s.ModoCobro ? 'Cambiar' : 'Cargar precio pactado'}</button>}
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
                        <select value={f.ModoCobro} onChange={e => setF(x => ({ ...x, ModoCobro: e.target.value }))} className={INPUT}>
                            <option value="PRECIO_ESTABLECIDO">Precio establecido (un total, todo incluido)</option>
                            <option value="POR_AREA">Facturar por cada área</option>
                        </select>
                    </Campo>
                    <div className="grid grid-cols-3 gap-2">
                        <Campo label="Moneda"><select value={f.MonIdMoneda} onChange={e => setF(x => ({ ...x, MonIdMoneda: Number(e.target.value) }))} className={INPUT}>{Object.entries(MONEDA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
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
                            <button type="button" onClick={() => ref.current?.click()} className="text-indigo-600 font-bold hover:underline inline-flex items-center gap-1"><Paperclip size={12} /> {files.length ? `${files.length} archivo(s) para adjuntar` : 'Adjuntar archivos a la interacción'}</button>
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
                            {s.Archivos.filter(a => a.EventoID === ev.EventoID && a.Vigente).map(a => <a key={a.ArchivoID} href={a.UrlDrive} target="_blank" rel="noreferrer" className="block text-indigo-700 font-bold hover:underline mt-1"><FileText size={11} className="inline" /> {a.NombreOriginal}</a>)}
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}
