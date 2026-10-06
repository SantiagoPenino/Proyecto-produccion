import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarDays, ClipboardList, LayoutGrid, List, Plus, RefreshCw, Search } from 'lucide-react';
import CalendarioSolicitudes from './CalendarioSolicitudes';
import Selector from '../../ui/Selector';
import SelectorFecha from '../../ui/SelectorFecha';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFecha, fmtFechaHora } from '../../../utils/fechas';
import { ESTADO_SOLICITUD, errorDe, plata } from './solicitudesComunes';

// Botón principal y buscador de esta pantalla (06/10): brand-cyan, como el resto del sistema. BTN_PRIMARIO e INPUT de
// solicitudesComunes son índigo y los usan las pantallas oscuras de Solicitudes, que los pasan a amarillo. El buscador
// tiene el alto y el foco del Selector con `filtro`, como en Servicio Técnico.
const BTN_PRINCIPAL = 'px-3 py-1.5 rounded-lg bg-brand-cyan hover:bg-brand-cyan/90 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50';
const CAMPO_FILTRO = 'px-3 py-2 border border-slate-200 rounded-xl text-sm text-slate-700 bg-white outline-none transition-colors hover:border-slate-300 focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 placeholder:text-slate-400';

// Los números que filtran la lista (06/10): "Listas para ingresar" y "Con requisitos pendientes", como botones con su
// contador (el estilo de los filtros de Configurar Productos). Tocar el prendido lo apaga.
const SELLOS = [
    { k: 'LISTOS', label: 'Listas para ingresar', off: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100', on: 'bg-emerald-600 text-white border-emerald-600', cuenta: 'bg-emerald-100 text-emerald-700' },
    { k: 'FALTA', label: 'Con requisitos pendientes', off: 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100', on: 'bg-rose-600 text-white border-rose-600', cuenta: 'bg-rose-100 text-rose-700' },
];
const VISTAS = [['fichas', LayoutGrid, 'Fichas'], ['tabla', List, 'Tabla'], ['calendario', CalendarDays, 'Calendario']];

// En el filtro de vendedor, solo los del rol VENTAS (06/10, pedido de Santiago; primero había pedido también
// coordinadores y admins). /vendedores también trae Admin, Administracion, Coordinador y Atención al Cliente, que pueden
// cargar solicitudes, y lo usa el formulario para mostrar el nombre del vendedor: por eso se filtra acá y no en el backend.
const ROLES_FILTRO_VENDEDOR = ['ventas'];
const sinAcentos = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Mayúscula inicial en cada palabra ("LUCAS" → "Lucas"), como en Configurar Productos: el CSS capitalize no baja el
// resto de las letras.
const capitalizar = (v) => String(v || '').trim().toLowerCase().replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1));

// ── Fichas y tabla (06/10) ──
// El estado escrito normal, sin mayúsculas, con su color, como en la Bandeja de Diseño. Las pastillas de
// solicitudesComunes (Pill, PillModificada y el Sello torcido de la maqueta) van en mayúsculas y las usan las pantallas
// oscuras de Solicitudes, así que acá van propias.
const ROTULO = 'text-[10px] font-black uppercase tracking-wider text-slate-400';
const TH = `px-3 py-2 first:pl-4 last:pr-4 text-left ${ROTULO}`;
const TD = 'px-3 py-3 first:pl-4 last:pr-4 align-top';
const CHIP = 'inline-block rounded-lg px-2 py-0.5 text-[11px] font-semibold';
const PastillaEstado = ({ txt, cls, title }) => (
    <span title={title} className={`inline-block rounded-xl px-2 py-0.5 text-xs font-semibold leading-snug ${cls}`}>{txt}</span>
);
const pastillaSolicitud = (s) => {
    const e = ESTADO_SOLICITUD[s.Estado] || { txt: s.Estado, cls: 'bg-slate-100 text-slate-600' };
    return <PastillaEstado txt={e.txt} cls={e.cls} />;
};
// Lo que antes era el sello ("LISTO PARA INGRESAR" / "FALTA INFO" + "N cosas por completar"): ahora una pastilla
const pastillaIngreso = (s) => {
    if (s.Listo) return <PastillaEstado txt="Lista para ingresar" cls="bg-emerald-50 text-emerald-700" />;
    const n = Number(s.Faltan);
    return <PastillaEstado txt={Number.isFinite(n) && n > 0 ? `Falta${n === 1 ? '' : 'n'} ${n} cosa${n === 1 ? '' : 's'}` : 'Falta info'} cls="bg-rose-50 text-rose-700"
        title="Lo que falta completar para poder ingresar el pedido" />;
};
const pastillaModificada = <PastillaEstado txt="Modificada · falta aceptar" cls="bg-fuchsia-50 text-fuchsia-700" />;

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
    const [sello, setSello] = useState('');      // '' | 'LISTOS' | 'FALTA'  (los dos botones con contador; antes, tarjetas de la maqueta)
    const [vista, setVista] = useState(() => { try { return localStorage.getItem('solicitudes.vista') || 'fichas'; } catch (_) { return 'fichas'; } });
    const cambiarVista = (v) => { setVista(v); try { localStorage.setItem('solicitudes.vista', v); } catch (_) { /* nada */ } };

    const cargar = useCallback(async () => {
        setLoading(true);
        try { setRows(await svc.listar(filtros)); }
        catch (e) { toast.error(errorDe(e)); }
        finally { setLoading(false); }
    }, [filtros]);
    useEffect(() => { const t = setTimeout(cargar, filtros.q ? 350 : 0); return () => clearTimeout(t); }, [cargar, filtros.q]);
    useEffect(() => {
        svc.vendedores()
            .then(lista => setVendedores((lista || []).filter(v => ROLES_FILTRO_VENDEDOR.includes(sinAcentos(v.NombreRol)))))
            .catch(() => setVendedores([]));
    }, []);

    const set = (k) => (e) => setFiltros(f => ({ ...f, [k]: e.target.value }));

    // Los números cuentan lo que está en curso (no canceladas). Listo = todo el checklist cumplido.
    const enCurso = rows.filter(s => s.Estado !== 'CANCELADA');
    const listos = enCurso.filter(s => s.Listo === true).length;
    const faltaInfo = enCurso.filter(s => s.Listo === false).length;
    const unidades = enCurso.reduce((a, s) => a + (Number(s.Unidades) || 0), 0);
    const visibles = rows.filter(s => sello === 'LISTOS' ? s.Listo === true : sello === 'FALTA' ? s.Listo === false : true);

    // Tema claro, como el resto del sistema y la Bandeja de Diseño (06/10). Antes iba dentro de .fp-oscuro, el tema
    // oscuro de las pantallas de Solicitudes (fichaPedido.css), que pasa las clases claras de Tailwind a azul y amarillo.
    return (
        <div className="p-3 md:p-6 space-y-4">
            {/* Encabezado como el de Configurar Productos: ícono de Lucide en brand-cyan y sin fondo */}
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                    <ClipboardList size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 uppercase tracking-tight">Solicitudes de vendedores</h1>
                        <p className="text-sm text-slate-400">Lo que pide el cliente antes de ser pedido: se capta, se diseña por partes y se pacta precio y seña. Acá no se crea ninguna orden de producción.</p>
                    </div>
                </div>
                <button onClick={() => navigate('/ventas/solicitudes/nueva')} className={BTN_PRINCIPAL}><Plus size={14} /> Nueva solicitud</button>
            </div>

            {/* Filtros en una sola zona (06/10). Antes: 4 tarjetas grandes con los números (dos filtraban y no se notaba),
                los estados como botones y, abajo, el buscador, el vendedor y las fechas con los controles del navegador.
                Ahora, como en Configurar Productos: los estados son pestañas y, en la misma fila a la derecha, los números
                que filtran como botones con su contador y los otros dos (en curso, unidades) como texto. La línea de las
                pestañas es un fondo de 1 px a la altura de una pestaña: si lo de la derecha baja a otra fila, la línea
                queda bajo las pestañas. En el celular, el estado es un desplegable. */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 sm:bg-[linear-gradient(#e2e8f0,#e2e8f0)] sm:bg-no-repeat sm:bg-[length:100%_1px] sm:bg-[position:0_calc(2.5rem_+_1px)]">
                <div className="w-full sm:hidden">
                    <Selector value={filtros.estado} onChange={set('estado')} aria-label="Estado" anchoLista={260}>
                        {FILTROS.map(([k, txt]) => <option key={k} value={k}>{txt}</option>)}
                    </Selector>
                </div>
                <div className="hidden sm:flex items-center overflow-x-auto no-scrollbar">
                    {FILTROS.map(([k, txt]) => {
                        const on = filtros.estado === k;
                        return (
                            <button key={k} type="button" onClick={() => setFiltros(f => ({ ...f, estado: k }))} aria-current={on ? 'page' : undefined}
                                className={`shrink-0 px-4 py-2.5 text-sm font-bold whitespace-nowrap border-b-2 transition-colors ${on ? 'border-brand-cyan text-brand-cyan' : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}>
                                {txt}
                            </button>
                        );
                    })}
                </div>
                <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center sm:justify-end gap-2">
                    {SELLOS.map(f => {
                        const on = sello === f.k;
                        return (
                            <button key={f.k} type="button" aria-pressed={on} onClick={() => setSello(s => (s === f.k ? '' : f.k))}
                                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${on ? f.on : f.off}`}>
                                {f.label}
                                <span className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-[11px] font-black ${on ? 'bg-white/25 text-white' : f.cuenta}`}>{f.k === 'LISTOS' ? listos : faltaInfo}</span>
                            </button>
                        );
                    })}
                    <span className="text-xs text-slate-400">{enCurso.length} en curso · {unidades} unidades</span>
                </div>
            </div>

            {/* Buscador, vendedor y fechas con el desplegable y el calendario propios (antes los del navegador); a la
                derecha, la vista (fichas, tabla o calendario) en un selector de tres botones y actualizar */}
            <div className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[220px]">
                    <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input value={filtros.q} onChange={set('q')} placeholder="Buscar por cliente, trabajo o número" aria-label="Buscar" className={`${CAMPO_FILTRO} w-full pl-9`} />
                </div>
                {/* En el celular, el vendedor a todo el ancho y las dos fechas en una fila */}
                {/* Los nombres con mayúscula inicial y la lista entera, sin scroll (altoMax: todo lo que entre en la pantalla) */}
                <Selector filtro className="w-full sm:w-auto" value={filtros.vendedorId} onChange={set('vendedorId')} aria-label="Vendedor" anchoLista={260} altoMax={Infinity}>
                    <option value="">Todos los vendedores</option>
                    {vendedores.map(v => <option key={v.IdUsuario} value={v.IdUsuario}>{capitalizar(v.Nombre)}</option>)}
                </Selector>
                <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
                    <SelectorFecha filtro vaciable className="w-full sm:w-auto" placeholder="Desde" title="Fecha de solicitud desde" value={filtros.desde} max={filtros.hasta || undefined} onChange={set('desde')} />
                    <SelectorFecha filtro vaciable className="w-full sm:w-auto" placeholder="Hasta" title="Fecha de solicitud hasta" value={filtros.hasta} min={filtros.desde || undefined} onChange={set('hasta')} />
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <div className="inline-flex rounded-xl border border-slate-200 bg-white p-0.5" role="group" aria-label="Vista">
                        {VISTAS.map(([v, Icono, txt]) => (
                            <button key={v} type="button" onClick={() => cambiarVista(v)} aria-pressed={vista === v} title={txt}
                                className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-colors ${vista === v ? 'bg-brand-cyan text-white' : 'text-slate-500 hover:bg-slate-100'}`}>
                                <Icono size={14} aria-hidden="true" /><span className="hidden lg:inline">{txt}</span>
                            </button>
                        ))}
                    </div>
                    <button type="button" onClick={cargar} className="w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 shrink-0" title="Actualizar" aria-label="Actualizar">
                        <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {vista === 'calendario' && <CalendarioSolicitudes onAbrir={(sid) => navigate(`/ventas/solicitudes/${sid}`)} />}

            {vista === 'fichas' && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {!loading && visibles.length === 0 && <div className="col-span-full rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-400">No hay solicitudes con estos filtros.</div>}
                    {visibles.map(s => <Ficha key={s.SolicitudID} s={s} onAbrir={() => navigate(`/ventas/solicitudes/${s.SolicitudID}`)} />)}
                </div>
            )}

            {/* Tabla con el estilo de las de la Bandeja de Diseño (06/10): filas de 14 px (antes 12), títulos de columna sin
                fondo, estados escritos normal y, vacía, el aviso en el medio de la tarjeta */}
            {vista === 'tabla' && <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                {!loading && visibles.length === 0 ? <p className="px-4 py-10 text-center text-sm text-slate-400">No hay solicitudes con estos filtros.</p> : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[60rem] text-sm">
                        <thead>
                            <tr>
                                {['Estado', 'Cliente / trabajo', 'Vendedor', 'Diseño', 'Precio pactado', 'Seña', 'Pedidos'].map(t => <th key={t} className={TH}>{t}</th>)}
                                <th className={TH}><span className="sr-only">Abrir</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibles.map(s => (
                                <tr key={s.SolicitudID} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => navigate(`/ventas/solicitudes/${s.SolicitudID}`)}>
                                    <td className={TD}>
                                        {pastillaSolicitud(s)}
                                        {s.Listo !== null && s.Estado !== 'PEDIDO_SOLICITADO' && <div className="mt-1">{pastillaIngreso(s)}</div>}
                                        {s.DisenoPendProd > 0 && <div className="mt-1"><PastillaEstado txt="Diseño pendiente en producción" cls="bg-amber-50 text-amber-700" title="El pedido ya está en producción, pero Bordado y/o TPU todavía esperan su diseño" /></div>}
                                        <div className="mt-1 text-xs text-slate-400">#{s.SolicitudID} · {fmtFechaHora(s.FechaSolicitud)}</div>
                                    </td>
                                    <td className={TD}>
                                        <div className="font-bold text-slate-800">{s.ClienteNombre || `Cliente ${s.CodCliente}`}</div>
                                        <div className="text-slate-500">{s.NombreTrabajo}</div>
                                        {s.PreNumero ? <div className="text-xs text-slate-400">presupuesto {s.PreNumero}</div> : null}
                                    </td>
                                    <td className={`${TD} text-slate-700`}>{capitalizar(s.VendedorNombre) || '—'}</td>
                                    <td className={TD}>
                                        <div className="text-slate-700"><b>{s.Disenadas || 0}</b> de {s.Partes || 0} diseñadas</div>
                                        {/* Lo que ya es pedido no se sigue diseñando en la solicitud: su diseño sigue en producción */}
                                        {(s.Convertidos || 0) < (s.Productos || 0) && <div className="text-xs text-slate-400">{s.Ingresadas || 0} sin enviar · {s.EnBandeja || 0} en bandeja · {s.Iniciadas || 0} en curso</div>}
                                        {s.DisenoPendProd > 0 && <div className="mt-0.5 text-xs font-semibold text-amber-700">En producción falta: {s.DisenoPendProdTxt}</div>}
                                        {s.Convertidos > 0 && !(s.DisenoPendProd > 0) && <div className="mt-0.5 text-xs font-semibold text-emerald-700">En producción: no queda diseño pendiente</div>}
                                        {s.Modificadas > 0 && <div className="mt-1">{pastillaModificada}</div>}
                                    </td>
                                    <td className={TD}>{!s.ModoCobro ? <span className="font-semibold text-rose-600">Sin pactar</span> : s.ModoCobro === 'POR_AREA' ? <span className="text-slate-700">Factura por cada área</span> : <b className="text-slate-800">{plata(s.PrecioPactado, s.MonIdMoneda)}</b>}</td>
                                    <td className={TD}>{!s.RequiereSena ? <span className="text-slate-400">No requiere</span> : s.SenaConfirmada ? <span className="font-semibold text-emerald-700">Confirmada</span> : <span className="font-semibold text-rose-600">Sin confirmar</span>}</td>
                                    <td className={`${TD} text-slate-700`}>
                                        {s.NumerosPedido ? <div className="font-bold text-emerald-700">Pedido {s.NumerosPedido}</div> : null}
                                        <div className={s.NumerosPedido ? 'text-xs text-slate-400' : ''}>{s.Convertidos || 0} de {s.Productos || 0} productos convertidos</div>
                                    </td>
                                    <td className={`${TD} text-right`}><button type="button" className="font-bold text-brand-cyan hover:underline">Abrir</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                )}
            </div>}
        </div>
    );
}

// Una ficha por solicitud, como la tarjeta de la maqueta: la franja de la izquierda es lo primero
// que se mira (verde: lista para ingresar · roja: falta info · gris: ya es pedido o cancelada).
// 06/10: el estado y lo que falta para ingresar son pastillas escritas normal (antes, mayúsculas y el sello torcido
// de la maqueta); los datos van en etiquetas del mismo estilo, sin borde; la entrega y lo que falta, abajo, separados
// por una línea y siempre al pie aunque las fichas de la fila tengan distinto alto.
function Ficha({ s, onAbrir }) {
    const f = s.Ficha || {};
    const convertida = s.Estado === 'PEDIDO_SOLICITADO';
    const franja = s.Estado === 'CANCELADA' ? 'border-l-slate-300 opacity-60' : convertida && !(s.DisenoPendProd > 0) ? 'border-l-slate-400' : s.Listo ? 'border-l-emerald-500' : 'border-l-rose-500';
    const datos = [
        s.Unidades > 0 && [`${s.Unidades} unidades`, 'bg-slate-100 text-slate-600'],
        f.dondeSeCose === 'EXTERNO' && [`Taller ${f.tallerExterno || 'externo'}`, 'bg-slate-100 text-slate-600'],
        s.NumerosPedido && [`Pedido ${s.NumerosPedido}`, 'bg-emerald-50 text-emerald-700'],
        s.DisenoPendProd > 0 && ['Diseño pendiente en producción', 'bg-amber-50 text-amber-700'],
        s.Modificadas > 0 && ['Modificada · falta aceptar', 'bg-fuchsia-50 text-fuchsia-700'],
        s.ModoCobro === 'PRECIO_ESTABLECIDO' && [plata(s.PrecioPactado, s.MonIdMoneda), 'bg-slate-100 text-slate-600'],
        s.RequiereSena && [`Seña ${s.SenaConfirmada ? 'confirmada' : 'sin confirmar'}`, s.SenaConfirmada ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'],
    ].filter(Boolean);
    return (
        <button type="button" onClick={onAbrir} className={`flex flex-col gap-3 text-left bg-white border border-slate-200 border-l-4 rounded-2xl p-4 transition hover:border-slate-300 hover:shadow-md ${franja}`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <div className="text-xs text-slate-400">#{s.SolicitudID} · {fmtFechaHora(s.FechaSolicitud)}</div>
                    <div className="mt-0.5 truncate text-base font-black leading-tight text-slate-800">{s.NombreTrabajo}</div>
                    <div className="truncate text-sm text-slate-600">{s.ClienteNombre || `Cliente ${s.CodCliente}`} <span className="text-slate-400">· vende {capitalizar(s.VendedorNombre) || '—'}</span></div>
                </div>
                <span className="shrink-0">{pastillaSolicitud(s)}</span>
            </div>
            {datos.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {datos.map(([txt, cls]) => <span key={txt} className={`${CHIP} ${cls}`}>{txt}</span>)}
                </div>
            )}
            <div className="mt-auto flex items-end justify-between gap-3 border-t border-slate-100 pt-3">
                <div>
                    <div className={ROTULO}>Entrega</div>
                    <div className={`text-sm ${s.FechaEntrega ? 'font-bold text-slate-800' : 'text-rose-600'}`}>{s.FechaEntrega ? `${fmtFecha(s.FechaEntrega)}${s.FechaEntregaHasta ? ` → ${fmtFecha(s.FechaEntregaHasta)}` : ''}` : 'Sin fecha'}</div>
                </div>
                {s.Estado === 'CANCELADA' ? null
                    : convertida ? <PastillaEstado txt={s.DisenoPendProd > 0 ? 'En producción · falta diseño' : 'En producción'} cls={s.DisenoPendProd > 0 ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'} />
                    : s.Listo === null ? null : pastillaIngreso(s)}
            </div>
        </button>
    );
}
