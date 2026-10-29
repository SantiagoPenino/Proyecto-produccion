import { useQuery } from '@tanstack/react-query';
import api from '../../../services/apiClient';

// Fechas de la orden y de su pedido (29/10/2026) para el detalle de la orden: una franja corta
// arriba (¿vamos a tiempo?) y la pestaña «Fechas» con el detalle por área y el depósito.
// Los datos y el semáforo los arma el backend (services/fechasOrdenService.js): el atraso se
// mide contra la fecha comprometida (si falta, contra el plan) en días hábiles del área.

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
// 'AAAA-MM-DD' (fecha sin hora) → 'mié 28/10'
const dia = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = String(iso).split('-').map(Number);
    return `${DIAS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
};
const fechaHora = (f) => (f ? new Date(f).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const manana = (hoy) => {
    const [y, m, d] = hoy.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
};

const COLOR = {
    verde: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    ambar: 'bg-amber-50 text-amber-700 border-amber-200',
    rojo: 'bg-red-50 text-red-700 border-red-200',
    gris: 'bg-zinc-100 text-zinc-500 border-zinc-200',
};

// a = 'a' (la orden) u 'o' (el pedido)
function textoSemaforo(s, { limite, hoy, a = 'a' }) {
    switch (s?.estado) {
        case 'A_TIEMPO': return { color: 'verde', texto: s.dias ? `A tiempo · ${plural(s.dias, 'día hábil', 'días hábiles')}` : 'A tiempo' };
        case 'VENCE_MANANA': return { color: 'ambar', texto: limite === manana(hoy) ? 'Vence mañana' : `Vence el ${dia(limite)}` };
        case 'VENCE_HOY': return { color: 'ambar', texto: 'Vence hoy' };
        case 'ATRASADA': return { color: 'rojo', texto: s.dias ? `Atrasad${a} ${plural(s.dias, 'día hábil', 'días hábiles')}` : `Venció el ${dia(limite)}` };
        case 'TERMINO_A_TIEMPO': return { color: 'verde', texto: 'Terminó a tiempo' };
        case 'TERMINO_TARDE': return { color: 'rojo', texto: s.dias ? `Terminó ${plural(s.dias, 'día hábil', 'días hábiles')} tarde` : 'Terminó tarde' };
        case 'TERMINADA': return { color: 'gris', texto: `Terminad${a}` };
        case 'CANCELADA': return { color: 'gris', texto: `Cancelad${a}` };
        default: return { color: 'gris', texto: 'Sin fecha' };
    }
}

function Semaforo({ semaforo, limite, hoy, a }) {
    const { color, texto } = textoSemaforo(semaforo, { limite, hoy, a });
    return <span className={`text-[11px] font-bold px-2 py-0.5 rounded border whitespace-nowrap ${COLOR[color]}`}>{texto}</span>;
}

/** Fechas de la orden y su pedido. `clave` cambia cuando cambia el estado → se vuelve a pedir. */
export function useFechasOrden(ordenId, clave) {
    const { data, isLoading, isError } = useQuery({
        queryKey: ['fechas-orden', ordenId, clave],
        queryFn: () => api.get(`/orders/fechas/${ordenId}`).then(r => r.data),
        enabled: !!ordenId,
        staleTime: 60 * 1000,
        retry: 0,
    });
    return { datos: data, cargando: isLoading, error: isError };
}

const esPedidoDeVarias = (p) => p && p.ordenes.length > 1;

/** Franja corta arriba del detalle: la orden, el pedido y lo que pidió el cliente. */
export function FechasOrdenFranja({ datos, onVerDetalle }) {
    if (!datos) return null;
    const { orden, pedido, hoy } = datos;
    const cliente = pedido?.cliente;
    return (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3 px-4 py-2.5 rounded-xl border border-zinc-200 bg-white shadow-sm text-xs">
            <div className="flex items-center gap-2">
                <i className="fa-regular fa-calendar-check text-brand-cyan"></i>
                <span className="text-zinc-500">Esta orden:</span>
                <span className="font-bold text-zinc-700">comprometida {dia(orden.limite)}</span>
                <Semaforo semaforo={orden.semaforo} limite={orden.limite} hoy={hoy} />
            </div>
            {esPedidoDeVarias(pedido) && (
                <div className="flex items-center gap-2">
                    <span className="text-zinc-500">Pedido {pedido.noDocERP}:</span>
                    <span className="font-bold text-zinc-700">fecha final {dia(pedido.fechaFinal)}</span>
                    <Semaforo semaforo={pedido.semaforo} limite={pedido.fechaFinal} hoy={hoy} a="o" />
                </div>
            )}
            {cliente && (
                <div className="flex items-center gap-2">
                    <span className="text-zinc-500">El cliente lo necesita:</span>
                    <span className="font-bold text-zinc-700">{dia(cliente.Desde)}{cliente.Hasta ? ` → ${dia(cliente.Hasta)}` : ''}</span>
                    {cliente.diasDespues > 0 && (
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded border whitespace-nowrap ${COLOR.rojo}`}>
                            La fecha final queda {plural(cliente.diasDespues, 'día hábil', 'días hábiles')} después
                        </span>
                    )}
                </div>
            )}
            {onVerDetalle && (
                <button onClick={onVerDetalle} className="ml-auto text-brand-cyan font-bold hover:underline whitespace-nowrap">
                    Ver fechas <i className="fa-solid fa-arrow-right text-[10px]"></i>
                </button>
            )}
        </div>
    );
}

function Dato({ label, children, nota }) {
    return (
        <div>
            <label className="text-[10px] uppercase font-bold text-zinc-400 block mb-1">{label}</label>
            <div className="font-semibold text-zinc-700 text-sm leading-tight">{children}</div>
            {nota && <div className="text-[11px] text-zinc-400 mt-0.5">{nota}</div>}
        </div>
    );
}

const estadoDe = (o) => (o.cancelada ? 'Cancelada' : (o.EstadoenArea || o.Estado || '—'));

/** Contenido de la pestaña «Fechas». */
export function FechasOrdenDetalle({ datos, cargando, error }) {
    if (cargando) return <div className="text-sm text-zinc-400 py-8 text-center"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Cargando fechas...</div>;
    if (error || !datos) return <div className="text-sm text-zinc-400 py-8 text-center">No se pudieron cargar las fechas de la orden.</div>;
    const { orden, pedido, hoy } = datos;
    const corrida = orden.compromiso && orden.plan && orden.compromiso > orden.plan;

    return (
        <div className="space-y-6">
            {/* ESTA ORDEN */}
            <section>
                <div className="flex items-center gap-3 mb-3">
                    <h3 className="text-sm font-bold text-zinc-700">Esta orden · {orden.CodigoOrden} ({orden.AreaNombre})</h3>
                    <Semaforo semaforo={orden.semaforo} limite={orden.limite} hoy={hoy} />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 bg-zinc-50 p-4 rounded-xl border border-zinc-100">
                    <Dato label="Ingresó">{fechaHora(orden.ingreso)}</Dato>
                    <Dato label="Plan del área">{dia(orden.plan)}</Dato>
                    <Dato label="Comprometida" nota={corrida ? 'La cola del área la corrió después del plan' : null}>{dia(orden.compromiso)}</Dato>
                    {orden.impreso && <Dato label="Impresa">{fechaHora(orden.impreso)}</Dato>}
                    <Dato label="Pronta" nota={orden.prontoSegunHistorial ? 'Según el historial de la orden' : null}>{fechaHora(orden.pronto)}</Dato>
                    {orden.aprobacionCliente && <Dato label="Aprobó el cliente">{fechaHora(orden.aprobacionCliente)}</Dato>}
                    {orden.rechazoCliente && <Dato label="Rechazó el cliente">{fechaHora(orden.rechazoCliente)}</Dato>}
                </div>
            </section>

            {/* EL PEDIDO */}
            {pedido && (
                <section>
                    <div className="flex flex-wrap items-center gap-3 mb-3">
                        <h3 className="text-sm font-bold text-zinc-700">Pedido {pedido.noDocERP}</h3>
                        {esPedidoDeVarias(pedido) && (
                            <>
                                <span className="text-sm text-zinc-500">Fecha final <b className="text-zinc-700">{dia(pedido.fechaFinal)}</b></span>
                                <Semaforo semaforo={pedido.semaforo} limite={pedido.fechaFinal} hoy={hoy} a="o" />
                            </>
                        )}
                    </div>

                    {pedido.cliente && (
                        <div className={`mb-3 px-4 py-2.5 rounded-xl border text-sm ${pedido.cliente.diasDespues > 0 ? COLOR.rojo : COLOR.verde}`}>
                            <b>El cliente lo necesita {dia(pedido.cliente.Desde)}{pedido.cliente.Hasta ? ` → ${dia(pedido.cliente.Hasta)}` : ''}</b>
                            {' '}(Solicitud #{pedido.cliente.SolicitudID}).{' '}
                            {pedido.cliente.diasDespues > 0
                                ? `La fecha final del pedido (${dia(pedido.fechaFinal)}) queda ${plural(pedido.cliente.diasDespues, 'día hábil', 'días hábiles')} después.`
                                : 'La fecha final del pedido llega.'}
                        </div>
                    )}

                    {esPedidoDeVarias(pedido) && (
                        <>
                            <div className="overflow-x-auto rounded-xl border border-zinc-200">
                                <table className="w-full text-sm">
                                    <thead className="bg-zinc-50 text-[10px] uppercase text-zinc-400">
                                        <tr>
                                            <th className="text-left font-bold px-3 py-2">Área</th>
                                            <th className="text-left font-bold px-3 py-2">Orden</th>
                                            <th className="text-left font-bold px-3 py-2">Estado</th>
                                            <th className="text-left font-bold px-3 py-2">Plan</th>
                                            <th className="text-left font-bold px-3 py-2">Comprometida</th>
                                            <th className="text-left font-bold px-3 py-2">Pronta</th>
                                            <th className="text-left font-bold px-3 py-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pedido.ordenes.map(o => (
                                            <tr key={o.OrdenID} className={`border-t border-zinc-100 ${o.OrdenID === orden.OrdenID ? 'bg-brand-cyan/5' : ''} ${o.cancelada || o.esFalla ? 'text-zinc-400' : 'text-zinc-700'}`}>
                                                <td className="px-3 py-2 font-semibold whitespace-nowrap">
                                                    {o.AreaNombre}
                                                    {o.esFalla && <span className="ml-2 text-[10px] font-bold uppercase text-red-500">falla</span>}
                                                </td>
                                                <td className={`px-3 py-2 font-mono text-xs whitespace-nowrap ${o.cancelada ? 'line-through' : ''}`}>{o.CodigoOrden}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">{estadoDe(o)}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">{dia(o.plan)}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">{dia(o.compromiso)}</td>
                                                <td className="px-3 py-2 whitespace-nowrap">{fechaHora(o.pronto)}</td>
                                                <td className="px-3 py-2"><Semaforo semaforo={o.semaforo} limite={o.limite} hoy={hoy} /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                            <p className="text-[11px] text-zinc-400 mt-2">
                                Cada área calcula su fecha desde el ingreso del pedido, no desde que terminó la anterior.
                                La fecha final es la comprometida más tarde, sin contar fallas ni canceladas.
                            </p>
                        </>
                    )}
                </section>
            )}

            {/* DEPÓSITO */}
            {pedido && (
                <section>
                    <h3 className="text-sm font-bold text-zinc-700 mb-3">Depósito</h3>
                    {pedido.deposito.length === 0 ? (
                        <div className="text-sm text-zinc-400">Todavía no llegó al depósito.</div>
                    ) : (
                        <div className="grid gap-2">
                            {pedido.deposito.map(d => (
                                <div key={d.CodigoOrden} className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-zinc-50 p-3 rounded-xl border border-zinc-100">
                                    <Dato label="Orden"><span className="font-mono text-xs">{d.CodigoOrden}</span></Dato>
                                    <Dato label="Llegó al depósito">{fechaHora(d.Llego)}</Dato>
                                    <Dato label="Avisado al cliente">{fechaHora(d.Avisado)}</Dato>
                                    <Dato label="Estado actual" nota={fechaHora(d.FechaEstado)}>{d.Estado || '—'}</Dato>
                                </div>
                            ))}
                        </div>
                    )}
                </section>
            )}

            <p className="text-[11px] text-zinc-400">
                El atraso se cuenta en días hábiles del área (horario laboral y feriados), contra la fecha comprometida; si falta, contra el plan.
            </p>
        </div>
    );
}
