import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { apiClient } from '../api/apiClient';
import { Layers, History, X, Loader2, Package, ChevronDown, ChevronRight, Wallet, Plus, Zap, CreditCard, FileText } from 'lucide-react';
import { fmtFechaCorta } from '../../utils/fechas';
import { codigoCuenta } from '../../utils/cuentaCodigo';
import { validarDocumentoUY, normalizarDocumento } from '../../utils/documentoUY';
import { generarPdfFacturaDGI } from '../../utils/pdfGenerator';

/**
 * RecursosView — "Mis Recursos" del portal del cliente. Ruta: /portal/recursos
 *
 * Dos secciones, las mismas que ve la gestión en el 360 (VendedorCliente360.jsx)
 * pero con la estética oscura del portal. SOLO LECTURA:
 *   1. Planes de metros   → comprado / usado / restante (pestaña Recursos)
 *   2. Telas del cliente  → metros de tela propia en el depósito (pestaña Telas)
 *
 * Datos: GET /api/web-recursos/mis-recursos y /mis-telas (el cliente sale del
 * token, nunca de la URL). "Ver consumo" abre el estado de cuenta de cada una.
 */

const fmtNum = (n, dec = 2) => new Intl.NumberFormat('es-UY', {
    minimumFractionDigits: dec, maximumFractionDigits: dec,
}).format(Number(n) || 0);

// Barra de progreso de consumo — misma lectura visual que la gestión:
// verde = queda mucho, ámbar = queda poco, rojo = casi agotado.
const BarraConsumo = ({ pct }) => {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const color = p >= 90 ? 'bg-rose-500' : p >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
    return (
        <div className="w-full min-w-[90px] h-1.5 bg-zinc-800 rounded-full overflow-hidden">
            <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${p}%` }} />
        </div>
    );
};

const ChipEstado = ({ activo }) => (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${activo
        ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
        : 'bg-zinc-800 text-zinc-500 border-zinc-700'}`}>
        {activo ? 'Activo' : 'Inactivo'}
    </span>
);

const Vence = ({ plan }) => (
    plan.PlaFechaVencimiento ? (
        <>
            {fmtFechaCorta(plan.PlaFechaVencimiento)}
            {plan.DiasParaVencer != null && (
                <span className={`block text-[10px] font-bold ${plan.DiasParaVencer < 0 ? 'text-rose-400' : plan.DiasParaVencer <= 15 ? 'text-amber-400' : 'text-zinc-500'}`}>
                    {plan.DiasParaVencer < 0 ? `Vencido hace ${Math.abs(plan.DiasParaVencer)} d` : `Faltan ${plan.DiasParaVencer} d`}
                </span>
            )}
        </>
    ) : <span className="text-zinc-600">Sin vencimiento</span>
);

const TituloSeccion = ({ icon: Icon, children }) => (
    <div className="flex items-center gap-2">
        <Icon size={14} className="text-custom-cyan shrink-0" />
        <h3 className="text-xs font-black uppercase tracking-widest text-zinc-400">{children}</h3>
    </div>
);

// Switch "Solo …": mismo interruptor en las 3 secciones (cuentas / planes / telas)
const SwitchSolo = ({ checked, onChange, label, title }) => (
    <label title={title} className="flex items-center gap-2 text-[11px] font-bold text-zinc-400 cursor-pointer select-none shrink-0">
        <span className="relative inline-flex items-center">
            <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="peer sr-only" />
            <span className="w-8 h-4 rounded-full bg-zinc-700 peer-checked:bg-custom-cyan transition-colors" />
            <span className="absolute left-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform peer-checked:translate-x-4" />
        </span>
        {label}
    </label>
);

/* ══════════════════════════════════════════════════════════════════════
   MODAL — "Ver consumo" de un PLAN: estado de cuenta del recurso.
   Misma lógica que ModalConsumoPlan de VendedorCliente360.jsx: los
   movimientos se agrupan por MATERIAL (todos los planes del mismo artículo
   comparten estado de cuenta) para que los saldos den igual que en la
   gestión. SOLO LECTURA.
   ══════════════════════════════════════════════════════════════════════ */
function ModalConsumoPlan({ plan, planes, onClose }) {
    const [movs, setMovs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    // Saldo de los movimientos que el tope de la consulta dejó afuera: sin esto el
    // saldo corrido arrancaba en 0 y las columnas de saldo quedaban desplazadas.
    const [arrastre, setArrastre] = useState(0);
    const [recorte, setRecorte]   = useState(null); // { mostrados, total }

    const unidad = plan.UniSimbolo || plan.PlaUnidad || plan.UnidadLabel || '';

    // Planes que comparten cuenta y material con el que se abrió (mismo estado de cuenta)
    const planesDelMat = useMemo(() => {
        const deCuenta = planes.filter(p => !p.CueIdCuenta || String(p.CueIdCuenta) === String(plan.CueIdCuenta));
        return deCuenta.filter(p => (
            plan.ProIdProducto != null
                ? String(p.ProIdProducto) === String(plan.ProIdProducto)
                : p.PlaIdPlan === plan.PlaIdPlan
        ));
    }, [planes, plan]);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);
        apiClient.get(`/web-recursos/mis-recursos/cuentas/${plan.CueIdCuenta}/movimientos?top=500`)
            .then(r => {
                if (!alive) return;
                setMovs(r.data || []);
                setArrastre(Number(r.saldoArrastre || 0));
                setRecorte(r.recortado ? { mostrados: (r.data || []).length, total: r.totalMovimientos } : null);
            })
            .catch(e => { if (alive) { setError(e.message); setMovs([]); setArrastre(0); setRecorte(null); } })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [plan.CueIdCuenta]);

    // Qué movimientos son de estos planes — mismo criterio que la gestión:
    // el concepto/observación dice "Plan #N"; si no lo dice, entra si el plan
    // está activo o si es el único plan de la cuenta.
    const movsConSaldo = useMemo(() => {
        const idsDelMat = new Set(planesDelMat.map(p => p.PlaIdPlan));
        const soloUno = planes.filter(p => !p.CueIdCuenta || String(p.CueIdCuenta) === String(plan.CueIdCuenta)).length === 1;

        const propios = movs.filter(m => {
            const match = m.MovConcepto?.match(/Plan\s*#?\s*(\d+)/i) || m.MovObservaciones?.match(/Plan\s*#?\s*(\d+)/i);
            if (match) return idsDelMat.has(parseInt(match[1]));
            return planesDelMat.some(p => p.PlaActivo) || soloUno;
        });

        // Saldo corrido: se acumula del más viejo al más nuevo, arrancando del
        // arrastre. Si el filtro por plan dejó movimientos afuera, arranca en 0
        // (es el saldo de estos movimientos, no el de la cuenta).
        const ordenados = [...propios].sort((a, b) => new Date(a.MovFecha) - new Date(b.MovFecha));
        let saldo = propios.length === movs.length ? arrastre : 0;
        return ordenados.map(m => {
            const importe = Number(m.MovImporte);
            const saldoIn = saldo;
            saldo = Math.round((saldo + importe) * 10000) / 10000;
            const match = m.MovConcepto?.match(/[A-Z]{2,5}-\d+/i);
            const cod = match ? match[0].toUpperCase() : '';
            let desc = m.MovConcepto || '—';
            if (cod) desc = desc.replace(match[0], '').replace(/^[\s:\-.]+|[\s:\-.]+$/g, '').trim();
            if (m.MovTipo === 'RECARGO_URGENCIA' && m.MovObservaciones) desc = m.MovObservaciones;
            return {
                ...m,
                _saldoIn: saldoIn,
                _saldoFn: saldo,
                _debe: importe < 0 ? Math.abs(importe) : 0,
                _haber: importe > 0 ? importe : 0,
                _cod: cod,
                _desc: desc,
                _tipo: m.MovTipo === 'RECARGO_URGENCIA' ? 'RECARGO_URGENCIA' : (importe >= 0 ? 'ENTRADA' : 'ENTREGA'),
            };
        });
    }, [movs, planesDelMat, planes, plan, arrastre]);

    // Lo que el cliente tiene realmente disponible del material: arrastre + TODOS
    // los movimientos de la cuenta. Puede ser menor que el "restante del plan"
    // cuando hubo trabajos que consumieron más metros de los que quedaban.
    const saldoCuenta = useMemo(() => (
        Math.round((movs.reduce((acc, m) => acc + Number(m.MovImporte || 0), 0) + arrastre) * 10000) / 10000
    ), [movs, arrastre]);

    const restantePlan = Number(plan.PlaCantidadRestante ?? (plan.PlaCantidadTotal - plan.PlaCantidadUsada));
    const hayDesfasaje = !loading && movs.length > 0 && Math.abs(restantePlan - saldoCuenta) > 0.01;

    return (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center px-2 sm:px-4 pt-10 pb-4"
            onClick={onClose}>
            <div className="bg-custom-dark border border-zinc-700/50 rounded-xl shadow-2xl w-[97vw] max-w-5xl max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}>

                {/* Cabecera */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <Layers size={16} className="text-custom-cyan shrink-0" />
                        <div className="min-w-0">
                            <h3 className="text-sm font-black leading-tight truncate text-zinc-100">
                                Consumo del recurso · {plan.NombreArticulo || plan.PlaDescripcion || `Plan #${plan.PlaIdPlan}`}
                            </h3>
                            <p className="text-[11px] text-zinc-500">
                                Alta {fmtFechaCorta(plan.PlaFechaAlta)}
                                {planesDelMat.length > 1 && ` · incluye ${planesDelMat.length} planes del mismo material`}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} title="Cerrar el estado de cuenta del recurso"
                        className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors shrink-0">
                        <X size={18} />
                    </button>
                </div>

                {/* Resumen del plan */}
                <div className="px-5 py-3 bg-brand-dark border-b border-zinc-800 flex flex-wrap items-center gap-x-6 gap-y-2 shrink-0">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Comprado</span>
                        <span className="text-sm font-black text-zinc-200">{fmtNum(plan.PlaCantidadTotal)} {unidad}</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Usado</span>
                        <span className="text-sm font-black text-rose-400">{fmtNum(plan.PlaCantidadUsada)} {unidad}</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Restante del plan</span>
                        <span className="text-sm font-black text-emerald-400">{fmtNum(plan.PlaCantidadRestante)} {unidad}</span>
                    </div>
                    <div className="flex items-baseline gap-2 sm:ml-auto">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Saldo disponible</span>
                        <span className={`text-sm font-black ${saldoCuenta < 0 ? 'text-rose-400' : 'text-custom-cyan'}`}>{fmtNum(saldoCuenta)} {unidad}</span>
                        <span className="text-[11px] text-zinc-500">{movsConSaldo.length} mov.</span>
                    </div>
                </div>

                {/* El restante del plan puede ser mayor que el saldo real cuando hubo
                    trabajos que consumieron más metros de los que quedaban en el plan
                    anterior. Lo que el cliente puede usar es el saldo disponible. */}
                {hayDesfasaje && (
                    <div className="px-5 py-2 bg-amber-500/10 border-b border-amber-500/30 text-[11px] text-amber-200 shrink-0">
                        Este plan figura con <strong>{fmtNum(restantePlan)} {unidad}</strong>, pero tu saldo disponible
                        del material es <strong>{fmtNum(saldoCuenta)} {unidad}</strong>: incluye los consumos de planes
                        anteriores. Para lo que podés usar, vale el saldo disponible.
                    </div>
                )}

                {recorte && (
                    <div className="px-5 py-2 bg-zinc-800/50 border-b border-zinc-700/50 text-[11px] text-zinc-400 shrink-0">
                        Se muestran los <strong>{recorte.mostrados}</strong> movimientos más recientes de{' '}
                        <strong>{recorte.total}</strong>. Los saldos ya incluyen el arrastre de los anteriores.
                    </div>
                )}

                {/* Movimientos */}
                <div className="flex-1 min-h-0 overflow-auto">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="animate-spin text-custom-cyan" size={28} />
                        </div>
                    ) : error ? (
                        <p className="text-center text-rose-400 text-sm py-12">{error}</p>
                    ) : movsConSaldo.length === 0 ? (
                        <p className="text-center text-zinc-500 text-sm py-12">Este recurso todavía no tiene movimientos.</p>
                    ) : (
                        <table className="w-full text-xs">
                            <thead className="sticky top-0 z-10">
                                <tr className="text-[10px] text-zinc-500 uppercase bg-custom-dark border-b border-zinc-800">
                                    <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                                    <th className="px-3 py-2 text-left font-semibold">Tipo</th>
                                    <th className="px-3 py-2 text-left font-semibold">Documento</th>
                                    <th className="px-3 py-2 text-left font-semibold">Concepto</th>
                                    <th className="px-3 py-2 text-right font-semibold">Saldo Ini.</th>
                                    <th className="px-3 py-2 text-right font-semibold">Debe</th>
                                    <th className="px-3 py-2 text-right font-semibold">Haber</th>
                                    <th className="px-3 py-2 text-right font-semibold">Saldo Fn.</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-800/60">
                                {/* Más reciente arriba (el saldo ya viene calculado en orden cronológico) */}
                                {[...movsConSaldo].reverse().map(m => (
                                    <tr key={m.MovIdMovimiento} className="hover:bg-zinc-800/20 transition-colors">
                                        <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{fmtFechaCorta(m.MovFecha)}</td>
                                        <td className="px-3 py-2">
                                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                                m._tipo === 'RECARGO_URGENCIA' ? 'bg-rose-500/10 text-rose-400'
                                                    : m._tipo === 'ENTRADA' ? 'bg-emerald-500/10 text-emerald-400'
                                                        : 'bg-brand-cyan/10 text-custom-cyan'
                                            }`}>
                                                {m._tipo === 'RECARGO_URGENCIA' ? 'RECARGO URGENCIA' : m._tipo}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 font-bold text-zinc-200 whitespace-nowrap">{m._cod || '—'}</td>
                                        <td className="px-3 py-2 text-zinc-400 max-w-[240px] truncate" title={m.MovConcepto}>{m._desc || '—'}</td>
                                        <td className="px-3 py-2 text-right text-zinc-500 whitespace-nowrap">{fmtNum(m._saldoIn)} {unidad}</td>
                                        <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${m._debe > 0 ? 'text-rose-400' : 'text-zinc-700'}`}>
                                            {m._debe > 0 ? `${fmtNum(m._debe)} ${unidad}` : '—'}
                                        </td>
                                        <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${m._haber > 0 ? 'text-emerald-400' : 'text-zinc-700'}`}>
                                            {m._haber > 0 ? `${fmtNum(m._haber)} ${unidad}` : '—'}
                                        </td>
                                        <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${m._saldoFn < 0 ? 'text-rose-400' : 'text-custom-cyan'}`}>
                                            {fmtNum(m._saldoFn)} {unidad}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>

                <div className="px-5 py-2.5 border-t border-zinc-800 bg-brand-dark flex items-center justify-between gap-3 shrink-0">
                    <span className="text-[11px] text-zinc-500">Vista de consulta: acá no se puede editar ni revertir ningún consumo.</span>
                    <button onClick={onClose}
                        className="px-4 py-2 text-xs font-bold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════
   TELAS DEL CLIENTE — tipos de movimiento (misma lectura que la gestión,
   colores adaptados al tema oscuro del portal)
   ══════════════════════════════════════════════════════════════════════ */
const TIPO_MOV_TELA = {
    INGRESO:                { label: 'Ingreso',         color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', sign: '+' },
    CONSUMO_ORDEN:          { label: 'Consumo orden',   color: 'text-rose-400 bg-rose-500/10 border-rose-500/30',          sign: '-' },
    CONSUMO_PRODUCCION:     { label: 'Consumo',         color: 'text-rose-400 bg-rose-500/10 border-rose-500/30',          sign: '-' },
    AJUSTE_DESECHO:         { label: 'Merma',           color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',       sign: '±' },
    AJUSTE_MANUAL:          { label: 'Ajuste manual',   color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',       sign: '±' },
    AJUSTE_ANCHO:           { label: 'Ajuste ancho',    color: 'text-amber-400 bg-amber-500/10 border-amber-500/30',       sign: '±' },
    CONFIRMACION_MEDIDA:    { label: 'Confirm. medida', color: 'text-sky-400 bg-sky-500/10 border-sky-500/30',             sign: '✓' },
    DEVOLUCION_CANCELACION: { label: 'Devolución',      color: 'text-teal-400 bg-teal-500/10 border-teal-500/30',          sign: '+' },
    RESERVA_ORDEN:          { label: 'Reserva',         color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30',    sign: '→' },
    LIBERACION_RESERVA:     { label: 'Lib. reserva',    color: 'text-teal-400 bg-teal-500/10 border-teal-500/30',          sign: '←' },
    MERMA_REIMPRESION:      { label: 'Merma reimp.',    color: 'text-orange-400 bg-orange-500/10 border-orange-500/30',    sign: '-' },
};
const getTipoTela = (t) => TIPO_MOV_TELA[t] || { label: t || '—', color: 'text-zinc-400 bg-zinc-800 border-zinc-700', sign: '' };

// (Existía una lista NO_CONSUMO para excluir tipos de movimiento del consumo. Se eliminó:
// clasificar por tipo era el origen del error — el consumo ahora se deriva del saldo.)

/* ══════════════════════════════════════════════════════════════════════
   MODAL — "Ver consumo" de una TELA: estado de cuenta bulto por bulto.
   Misma lógica que ModalConsumoTela de VendedorCliente360.jsx. SOLO LECTURA.
   ══════════════════════════════════════════════════════════════════════ */
function ModalConsumoTela({ tela, onClose }) {
    const [movs, setMovs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [abierta, setAbierta] = useState(null); // BobinaID desplegada

    useEffect(() => {
        let alive = true;
        setLoading(true);
        setError(null);
        const p = new URLSearchParams();
        if (tela.InsumoID) p.append('insumoId', tela.InsumoID);
        apiClient.get(`/web-recursos/mis-telas/estado-cuenta?${p}`)
            .then(r => { if (alive) setMovs(r.data || []); })
            .catch(e => { if (alive) { setError(e.message); setMovs([]); } })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [tela.InsumoID]);

    // El endpoint filtra por insumo; acá afinamos al tipo de tela exacto de la fila
    // (un mismo insumo genérico puede tener varias descripciones de tela).
    const bobinas = useMemo(() => {
        const propios = movs.filter(m => !tela.TipoTela || m.TipoTela === tela.TipoTela);
        const map = new Map();
        propios.forEach(m => {
            if (!map.has(m.BobinaID)) {
                map.set(m.BobinaID, {
                    bobinaId: m.BobinaID, bulto: m.Bulto, estado: m.EstadoBulto,
                    saldo: Number(m.SaldoBulto || 0), metrosIniciales: Number(m.MetrosIniciales || 0),
                    ancho: m.Ancho, peso: m.Peso,
                    referencia: m.ReferenciaOrden || m.CodigoRecepcion || '',
                    fechaIngreso: null, movimientos: [],
                });
            }
            const b = map.get(m.BobinaID);
            b.movimientos.push(m);
            if (m.TipoMovimiento === 'INGRESO' && !b.fechaIngreso) b.fechaIngreso = m.FechaMovimiento;
        });
        return [...map.values()].map(b => ({
            ...b,
            ingresado: b.movimientos.filter(m => m.TipoMovimiento === 'INGRESO')
                .reduce((s, m) => s + Math.abs(Number(m.Cantidad || 0)), 0),
            // Consumo NETO = ingresado − saldo. Sumar solo los movimientos negativos daba
            // números imposibles (BOB-73: −14 m de una bobina de 10): contaba devoluciones al
            // cliente y ajustes de saneo como consumo, e ignoraba los créditos (la devolución
            // por cancelación de orden), así que los mismos metros se descontaban dos veces.
            // Un bulto AGOTADO se cuenta entero: su remanente es merma no usable y no figura
            // como disponible (misma regla que MetrosConsumidos del backend).
            consumido: (() => {
                const ing = b.movimientos.filter(m => m.TipoMovimiento === 'INGRESO')
                    .reduce((s, m) => s + Math.abs(Number(m.Cantidad || 0)), 0);
                if (String(b.estado || '').toLowerCase() === 'agotado') return ing;
                return Math.max(0, ing - Number(b.saldo || 0));
            })(),
        }));
    }, [movs, tela.TipoTela]);

    return (
        <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center px-2 sm:px-4 pt-10 pb-4"
            onClick={onClose}>
            <div className="bg-custom-dark border border-zinc-700/50 rounded-xl shadow-2xl w-[97vw] max-w-5xl max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}>

                {/* Cabecera */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <Package size={16} className="text-custom-cyan shrink-0" />
                        <div className="min-w-0">
                            <h3 className="text-sm font-black leading-tight truncate text-zinc-100">
                                Consumo de tela · {tela.TipoTela || tela.InsumoNombre}
                            </h3>
                            <p className="text-[11px] text-zinc-500">
                                {bobinas.length} bulto{bobinas.length !== 1 ? 's' : ''} · tocá uno para ver sus movimientos
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} title="Cerrar el estado de cuenta de la tela"
                        className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors shrink-0">
                        <X size={18} />
                    </button>
                </div>

                {/* Resumen de la tela */}
                <div className="px-5 py-3 bg-brand-dark border-b border-zinc-800 flex flex-wrap items-center gap-x-6 gap-y-2 shrink-0">
                    <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Ingresados</span>
                        <span className="text-sm font-black text-zinc-200">{fmtNum(tela.MetrosIngresados)} m</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Consumidos</span>
                        <span className="text-sm font-black text-rose-400">{fmtNum(tela.MetrosConsumidos)} m</span>
                    </div>
                    <div className="flex items-baseline gap-2">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Disponibles</span>
                        <span className="text-sm font-black text-custom-cyan">{fmtNum(tela.MetrosDisponibles)} m</span>
                    </div>
                </div>

                {/* Bultos */}
                <div className="flex-1 min-h-0 overflow-auto p-4 flex flex-col gap-2">
                    {loading ? (
                        <div className="flex justify-center py-12">
                            <Loader2 className="animate-spin text-custom-cyan" size={28} />
                        </div>
                    ) : error ? (
                        <p className="text-center text-rose-400 text-sm py-12">{error}</p>
                    ) : bobinas.length === 0 ? (
                        <p className="text-center text-zinc-500 text-sm py-12">No hay movimientos registrados para esta tela.</p>
                    ) : bobinas.map(b => {
                        const open = abierta === b.bobinaId;
                        return (
                            <div key={b.bobinaId} className="bg-brand-dark border border-zinc-800 rounded-xl overflow-hidden">
                                <button type="button" onClick={() => setAbierta(open ? null : b.bobinaId)}
                                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-800/30 transition-colors text-left">
                                    {open ? <ChevronDown size={15} className="text-zinc-500 shrink-0" /> : <ChevronRight size={15} className="text-zinc-500 shrink-0" />}
                                    <Package size={14} className="text-custom-cyan shrink-0" />
                                    <div className="min-w-0 flex-1">
                                        <span className="font-bold text-zinc-100 text-sm">{b.referencia || b.bulto}</span>
                                        <span className="block text-[10px] text-zinc-500 font-mono">
                                            {b.bulto} · Ingreso {fmtFechaCorta(b.fechaIngreso)}
                                            {b.metrosIniciales ? ` · L:${fmtNum(b.metrosIniciales)}m` : ''}
                                            {b.ancho ? ` · A:${fmtNum(b.ancho)}m` : ''}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-4 shrink-0">
                                        <div className="text-center hidden sm:block">
                                            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Ingreso</p>
                                            <p className="text-sm font-black tabular-nums text-emerald-400">+{fmtNum(b.ingresado)}</p>
                                        </div>
                                        <div className="text-center hidden sm:block">
                                            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Consumo</p>
                                            <p className="text-sm font-black tabular-nums text-rose-400">{b.consumido > 0 ? '-' : ''}{fmtNum(b.consumido)}</p>
                                        </div>
                                        <div className="text-center">
                                            <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Saldo</p>
                                            <p className={`text-sm font-black tabular-nums ${b.saldo > 0 ? 'text-custom-cyan' : 'text-zinc-500'}`}>{fmtNum(b.saldo)}</p>
                                        </div>
                                        <span className="text-[10px] text-zinc-500 font-bold hidden md:block">{b.movimientos.length} mov.</span>
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-black border bg-zinc-800 text-zinc-400 border-zinc-700 uppercase">
                                            {b.estado || '—'}
                                        </span>
                                    </div>
                                </button>

                                {open && (
                                    <div className="border-t border-zinc-800 overflow-x-auto">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="bg-custom-dark border-b border-zinc-800 text-[9px] font-black uppercase tracking-widest text-zinc-500">
                                                    <th className="px-4 py-2 text-left">Fecha</th>
                                                    <th className="px-4 py-2 text-left">Tipo</th>
                                                    <th className="px-4 py-2 text-right">Cantidad</th>
                                                    <th className="px-4 py-2 text-right">Saldo acum.</th>
                                                    <th className="px-4 py-2 text-left">Referencia</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {b.movimientos.map((m, i) => {
                                                    const cfg = getTipoTela(m.TipoMovimiento);
                                                    return (
                                                        <tr key={m.MovimientoID || i} className="border-b border-zinc-800/40 last:border-0 hover:bg-zinc-800/20">
                                                            <td className="px-4 py-2.5 tabular-nums text-[10px] text-zinc-500 whitespace-nowrap">{fmtFechaCorta(m.FechaMovimiento)}</td>
                                                            <td className="px-4 py-2.5">
                                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-black uppercase ${cfg.color}`}>
                                                                    {cfg.label}
                                                                </span>
                                                            </td>
                                                            <td className={`px-4 py-2.5 font-black tabular-nums text-right whitespace-nowrap ${m.TipoMovimiento === 'INGRESO' ? 'text-emerald-400' : Number(m.Cantidad) < 0 ? 'text-rose-400' : 'text-zinc-300'}`}>
                                                                {cfg.sign} {fmtNum(Math.abs(m.Cantidad))} m
                                                            </td>
                                                            <td className="px-4 py-2.5 font-black tabular-nums text-right text-custom-cyan whitespace-nowrap">{fmtNum(m.SaldoAcumulado || 0)} m</td>
                                                            <td className="px-4 py-2.5 text-[10px] text-zinc-500 max-w-[200px] truncate" title={m.Referencia || ''}>
                                                                {m.Referencia || m.CodigoRecepcion || '—'}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                <div className="px-5 py-2.5 border-t border-zinc-800 bg-brand-dark flex items-center justify-between gap-3 shrink-0">
                    <span className="text-[11px] text-zinc-500">Vista de consulta: acá no se puede ajustar ni cerrar ningún bulto.</span>
                    <button onClick={onClose}
                        className="px-4 py-2 text-xs font-bold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors">
                        Cerrar
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════
   SECCIÓN 1 — PLANES DE METROS
   ══════════════════════════════════════════════════════════════════════ */
/* ─────────────────────────────────────────────────────────────────────────────
 * SECCIÓN: Mis cuentas de saldo (billetera)
 * El cliente crea su cuenta (elige si descuenta en automático; NUNCA nace
 * aceptando negativo — eso lo decide administración), la recarga por Handy /
 * MercadoPago y ve su estado de cuenta. Todo por token, con candado de pertenencia.
 * ──────────────────────────────────────────────────────────────────────────── */
function SeccionCuentasSaldo() {
    const [cuentas, setCuentas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [recarga, setRecarga] = useState(null);   // { cuenta, importe }
    const [movsDe, setMovsDe] = useState(null);     // cuenta cuyo estado de cuenta se muestra
    const [movs, setMovs] = useState([]);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState(null);           // aviso inline { tipo:'ok'|'err', texto }
    // Umbral DGI del e-Ticket por moneda (10.000 UI): sobre ese importe pide la cédula
    const [umbralCedula, setUmbralCedula] = useState({ UYU: 65000, USD: 1600 });
    // La billetera solo se muestra a los clientes que administración habilitó
    // (Clientes.CliBilleteraPortal, switch del gestor "Cuentas" del 360).
    const [habilitada, setHabilitada] = useState(true);

    // Las cuentas de la billetera las crea la administración (BILLETERA USD / BILLETERA UY
    // para todos los clientes): el portal solo las muestra, recarga y consulta.
    const cargar = useCallback(() => apiClient.get('/web-orders/mis-cuentas')
        .then(r => { setCuentas(r?.data || []); setHabilitada(r?.habilitada !== false); if (r?.umbralCedula) setUmbralCedula(r.umbralCedula); })
        .catch(() => setCuentas([]))
        .finally(() => setCargando(false)), []);
    useEffect(() => { cargar(); }, [cargar]);

    const abrirMovs = (c) => {
        setMovsDe(c); setMovs([]);
        apiClient.get(`/web-orders/mis-cuentas/${c.CueIdCuenta}/movimientos`).then(r => setMovs(r?.data || [])).catch(() => setMovs([]));
    };

    const reabrirCuenta = async (c) => {
        if (!window.confirm(`Vas a reabrir la cuenta "${c.nombre}".\n\n• Se puede porque la creaste vos desde el portal.\n• Vuelve sin descuento automático (eso lo activa administración).\n\n¿Confirmás?`)) return;
        setBusy(true); setMsg(null);
        try {
            const r = await apiClient.post(`/web-orders/mis-cuentas/${c.CueIdCuenta}/reabrir`, {});
            setMsg({ tipo: 'ok', texto: r?.message || `Cuenta "${c.nombre}" reabierta.` });
            await cargar();
        } catch (e) { setMsg({ tipo: 'err', texto: e?.response?.data?.error || e.message || 'No se pudo reabrir la cuenta.' }); }
        finally { setBusy(false); }
    };

    const cerrarCuenta = async (c) => {
        if (!window.confirm(`Vas a cerrar la cuenta "${c.nombre}".\n\n• Solo se puede porque está en $ 0.\n• Sus movimientos quedan visibles (switch "Solo activas" apagado).\n• Para reabrirla tenés que hablar con administración.\n\n¿Confirmás?`)) return;
        setBusy(true); setMsg(null);
        try {
            const r = await apiClient.post(`/web-orders/mis-cuentas/${c.CueIdCuenta}/cerrar`, {});
            setMsg({ tipo: 'ok', texto: r?.message || `Cuenta "${c.nombre}" cerrada.` });
            await cargar();
        } catch (e) { setMsg({ tipo: 'err', texto: e?.response?.data?.error || e.message || 'No se pudo cerrar la cuenta.' }); }
        finally { setBusy(false); }
    };

    // ¿La recarga de esta cuenta emite factura automática? (cuentas prepago, F4)
    const esPrepago = (c) => c?.modalidad === 'PREPAGO_FACTURADO';
    const topeCedula = (c) => Number(umbralCedula[c?.moneda] || umbralCedula.UYU) || 65000;

    // Descargar la factura de una recarga (mismo PDF que emite administración)
    const descargarComprobante = async (cuenta, docId) => {
        setMsg(null);
        try {
            const data = await apiClient.get(`/web-orders/mis-cuentas/${cuenta.CueIdCuenta}/comprobantes/${docId}`);
            if (!data?.doc) throw new Error('No se pudo leer el comprobante.');
            await generarPdfFacturaDGI(data.doc, data.detalles || []);
        } catch (e) {
            setMsg({ tipo: 'err', texto: e?.response?.data?.error || e.message || 'No se pudo descargar el comprobante.' });
        }
    };

    const iniciarRecarga = async (gateway) => {
        const imp = parseFloat(recarga?.importe);
        if (!(imp > 0)) { setMsg({ tipo: 'err', texto: 'Poné el importe a recargar.' }); return; }
        // Validación fiscal ANTES de abrir la pasarela (cuentas prepago: la recarga se factura)
        const payload = { importe: imp, gateway };
        if (esPrepago(recarga?.cuenta)) {
            const comprobante = recarga.comprobante === 'e-factura' ? 'e-factura' : 'e-ticket';
            const docFiscal = normalizarDocumento(recarga.documentoFiscal);
            if (comprobante === 'e-factura') {
                const v = validarDocumentoUY(docFiscal);
                if (!v.valido || v.tipo !== 'RUT') { setMsg({ tipo: 'err', texto: v.tipo === 'RUT' ? v.motivo : 'La e-Factura necesita un RUT válido de 12 dígitos (sin puntos ni guiones).' }); return; }
                if (String(recarga.nombreFiscal || '').trim().length < 3) { setMsg({ tipo: 'err', texto: 'Poné la razón social que va en la e-Factura.' }); return; }
            } else {
                if (imp >= topeCedula(recarga.cuenta) && !docFiscal) {
                    setMsg({ tipo: 'err', texto: `Para recargas de ${recarga.cuenta.moneda === 'USD' ? 'US$' : '$'} ${fmtNum(topeCedula(recarga.cuenta), 0)} o más, DGI exige identificar al receptor: poné tu cédula (o elegí e-Factura con RUT).` }); return;
                }
                if (docFiscal) {
                    const v = validarDocumentoUY(docFiscal);
                    if (!v.valido) { setMsg({ tipo: 'err', texto: v.motivo }); return; }
                }
            }
            payload.comprobante = comprobante;
            payload.documentoFiscal = docFiscal;
            payload.nombreFiscal = String(recarga.nombreFiscal || '').trim();
        }
        const payWindow = window.open('about:blank', '_blank');
        setBusy(true); setMsg(null);
        try {
            const r = await apiClient.post(`/web-orders/mis-cuentas/${recarga.cuenta.CueIdCuenta}/recargar`, payload);
            if (r?.success && r.url) {
                if (payWindow) payWindow.location.href = r.url;
                setRecarga(null);
                setMsg({ tipo: 'ok', texto: 'Completá el pago en la pestaña que se abrió. Cuando termine, el saldo se acredita solo — actualizá esta página para verlo.' });
            } else {
                if (payWindow) payWindow.close();
                setMsg({ tipo: 'err', texto: r?.error || 'No se pudo generar el link de pago.' });
            }
        } catch (e) {
            if (payWindow) payWindow.close();
            setMsg({ tipo: 'err', texto: e?.response?.data?.error || e.message || 'No se pudo iniciar la recarga.' });
        } finally { setBusy(false); }
    };

    const inputCls = "w-full bg-custom-dark border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-100 outline-none focus:border-custom-cyan";

    // Billetera no habilitada para este cliente → la sección entera no existe
    if (!habilitada) return null;

    return (
        <div className="space-y-2">
            <TituloSeccion icon={Wallet}>Mi billetera</TituloSeccion>
            <div className="overflow-hidden rounded-xl border border-zinc-800 bg-brand-dark">
                <div className="px-4 py-3 bg-custom-dark border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-500">Dinero tuyo por adelantado: lo cargás con tarjeta y se va usando en tus pedidos.</span>
                </div>

                {msg && (
                    <div className={`px-4 py-2 text-xs font-semibold border-b border-zinc-800 ${msg.tipo === 'ok' ? 'text-emerald-400 bg-emerald-500/5' : 'text-rose-400 bg-rose-500/5'}`}>{msg.texto}</div>
                )}

                {cargando ? (
                    <div className="py-8 text-center"><Loader2 className="animate-spin text-custom-cyan mx-auto" size={22} /></div>
                ) : cuentas.length === 0 ? (
                    <div className="py-8 text-center text-zinc-500 text-sm">
                        Tu billetera todavía no está habilitada.<br />
                        <span className="text-xs">Consultá con la administración para activarla.</span>
                    </div>
                ) : (
                    <div className="divide-y divide-zinc-800/60">
                        {cuentas.map(c => (
                            <div key={c.CueIdCuenta} className={`px-4 py-3 flex flex-wrap items-center gap-3 ${c.activa === false ? 'opacity-50' : ''}`}>
                                <div className="flex-1 min-w-[180px]">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <span className="text-[10px] font-mono font-black text-custom-cyan bg-brand-cyan/10 border border-brand-cyan/30 rounded px-1.5 py-0.5" title="Código único de tu cuenta (tipo + moneda + número)">{codigoCuenta(c)}</span>
                                        <span className="font-black text-zinc-100">{c.nombre}</span>
                                        {c.activa === false && <span className="text-[10px] font-bold text-zinc-500 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5">cerrada</span>}
                                        <span className="text-[10px] font-bold text-zinc-500">{c.moneda === 'USD' ? 'US$' : '$'}</span>
                                        {c.automatico
                                            ? <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded px-1.5 py-0.5"><Zap size={10} /> descuenta tus pedidos en automático</span>
                                            : <span className="text-[10px] font-bold text-zinc-500 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5">se usa cuando vos lo elegís</span>}
                                        {c.restringida && <span className="text-[10px] font-bold text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded px-1.5 py-0.5">🔒 solo ciertos artículos</span>}
                                    </div>
                                    <span className="text-[10px] text-zinc-600">Creada {fmtFechaCorta(c.fechaAlta)}</span>
                                </div>
                                <span className={`font-black tabular-nums ${Number(c.saldo) < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                                    {c.moneda === 'USD' ? 'US$' : '$'} {fmtNum(c.saldo)}
                                </span>
                                <div className="flex items-center gap-1.5">
                                    {c.permiteRecarga && (
                                        <button onClick={() => { setRecarga({ cuenta: c, importe: '', comprobante: 'e-ticket', documentoFiscal: '', nombreFiscal: '' }); setMsg(null); }}
                                            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-white bg-emerald-600/90 hover:bg-emerald-600 rounded-lg transition-colors">
                                            <CreditCard size={12} /> Recargar
                                        </button>
                                    )}
                                    <button onClick={() => abrirMovs(c)}
                                        className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors">
                                        <History size={12} /> Movimientos
                                    </button>
                                    {/* Reabrir: solo cuentas cerradas que el cliente creó desde el portal */}
                                    {c.activa === false && c.creadaPortal && (
                                        <button onClick={() => reabrirCuenta(c)} disabled={busy}
                                            title="Reabrir esta cuenta (la creaste vos desde el portal). Vuelve sin descuento automático."
                                            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-lg transition-colors disabled:opacity-50">
                                            <Plus size={12} /> Reabrir
                                        </button>
                                    )}
                                    {/* Cerrar: solo cuentas abiertas y en $ 0 (mismo criterio que administración) */}
                                    {c.activa !== false && Math.abs(Number(c.saldo || 0)) < 0.01 && (
                                        <button onClick={() => cerrarCuenta(c)} disabled={busy}
                                            title="Cerrar esta cuenta (se puede porque está en $ 0). Sus movimientos quedan visibles; reabrirla es cosa de administración."
                                            className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-bold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 rounded-lg transition-colors disabled:opacity-50">
                                            <X size={12} /> Cerrar
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Modal recargar */}
            {recarga && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={e => e.target === e.currentTarget && setRecarga(null)}>
                    <div className="bg-brand-dark border border-zinc-700 rounded-2xl w-full max-w-md p-5 space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-zinc-100 font-black">Recargar "{recarga.cuenta.nombre}"</h3>
                            <button onClick={() => setRecarga(null)} className="text-zinc-500 hover:text-zinc-200"><X size={18} /></button>
                        </div>
                        <div>
                            <label className="block text-[11px] font-bold text-zinc-400 mb-1">Importe a recargar ({recarga.cuenta.moneda === 'USD' ? 'US$' : '$'})</label>
                            <input type="number" min="1" step="0.01" value={recarga.importe} onChange={e => setRecarga(x => ({ ...x, importe: e.target.value }))} placeholder="0.00" className={inputCls} />
                        </div>

                        {/* Cuentas prepago (F4): la recarga emite su factura automática → elegir comprobante */}
                        {esPrepago(recarga.cuenta) && (
                            <div className="space-y-3 border border-zinc-800 rounded-xl p-3 bg-custom-dark/50">
                                <p className="text-[11px] font-bold text-zinc-300">Tu comprobante (se emite solo al acreditarse el pago):</p>
                                <div className="grid grid-cols-2 gap-2">
                                    <button type="button" onClick={() => setRecarga(x => ({ ...x, comprobante: 'e-ticket' }))}
                                        className={`px-2 py-2 rounded-lg text-[11px] font-bold border transition-colors ${recarga.comprobante !== 'e-factura'
                                            ? 'text-custom-cyan bg-brand-cyan/10 border-brand-cyan/40' : 'text-zinc-400 bg-zinc-800/60 border-zinc-700'}`}>
                                        e-Ticket<span className="block font-normal text-[10px] text-zinc-500">consumidor final</span>
                                    </button>
                                    <button type="button" onClick={() => setRecarga(x => ({ ...x, comprobante: 'e-factura' }))}
                                        className={`px-2 py-2 rounded-lg text-[11px] font-bold border transition-colors ${recarga.comprobante === 'e-factura'
                                            ? 'text-custom-cyan bg-brand-cyan/10 border-brand-cyan/40' : 'text-zinc-400 bg-zinc-800/60 border-zinc-700'}`}>
                                        e-Factura<span className="block font-normal text-[10px] text-zinc-500">con RUT de empresa</span>
                                    </button>
                                </div>
                                {recarga.comprobante === 'e-factura' ? (
                                    <>
                                        <div>
                                            <label className="block text-[11px] font-bold text-zinc-400 mb-1">RUT (12 dígitos, sin puntos ni guiones)</label>
                                            <input type="text" inputMode="numeric" maxLength={12} value={recarga.documentoFiscal}
                                                onChange={e => setRecarga(x => ({ ...x, documentoFiscal: e.target.value.replace(/\D/g, '') }))}
                                                placeholder="21XXXXXXXXXX" className={inputCls} />
                                        </div>
                                        <div>
                                            <label className="block text-[11px] font-bold text-zinc-400 mb-1">Razón social (como va en la e-Factura)</label>
                                            <input type="text" maxLength={100} value={recarga.nombreFiscal}
                                                onChange={e => setRecarga(x => ({ ...x, nombreFiscal: e.target.value }))}
                                                placeholder="Mi Empresa S.A." className={inputCls} />
                                        </div>
                                    </>
                                ) : (
                                    <div>
                                        <label className="block text-[11px] font-bold text-zinc-400 mb-1">
                                            Cédula {parseFloat(recarga.importe) >= topeCedula(recarga.cuenta)
                                                ? <span className="text-amber-400">(obligatoria: DGI la exige para este importe)</span>
                                                : <span className="text-zinc-500">(opcional para recargas menores a {recarga.cuenta.moneda === 'USD' ? 'US$' : '$'} {fmtNum(topeCedula(recarga.cuenta), 0)})</span>}
                                        </label>
                                        <input type="text" inputMode="numeric" maxLength={8} value={recarga.documentoFiscal}
                                            onChange={e => setRecarga(x => ({ ...x, documentoFiscal: e.target.value.replace(/\D/g, '') }))}
                                            placeholder="Sin puntos ni guion" className={inputCls} />
                                    </div>
                                )}
                                <p className="text-[11px] text-zinc-500">Cuando la pasarela confirme el pago, el saldo se acredita y tu {recarga.comprobante === 'e-factura' ? 'e-Factura' : 'e-Ticket'} se emite en automático. Lo descargás desde "Movimientos" (botón 📄 en la fila de la carga).</p>
                            </div>
                        )}
                        {!esPrepago(recarga.cuenta) && (
                            <p className="text-[11px] text-zinc-500">El pago es siempre electrónico. Cuando la pasarela confirme, el saldo se acredita solo en tu cuenta (con su recibo).</p>
                        )}
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => iniciarRecarga('handy')} disabled={busy}
                                className="px-3 py-3 rounded-xl text-sm font-black text-white bg-[#722efa] hover:opacity-90 disabled:opacity-50 transition-opacity">Pagar con Handy</button>
                            <button onClick={() => iniciarRecarga('mercadopago')} disabled={busy}
                                className="px-3 py-3 rounded-xl text-sm font-black text-zinc-900 bg-[#ffe600] hover:opacity-90 disabled:opacity-50 transition-opacity">MercadoPago</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal movimientos — mismo formato de libro que el consumo del rollo por adelantado */}
            {movsDe && (() => {
                const sym = movsDe.moneda === 'USD' ? 'US$' : '$';
                const saldoFinal = movs.length ? movs[0].saldoFn : Number(movsDe.saldo || 0);
                return (
                    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-start justify-center px-2 sm:px-4 pt-10 pb-4"
                        onClick={() => setMovsDe(null)}>
                        <div className="bg-custom-dark border border-zinc-700/50 rounded-xl shadow-2xl w-[97vw] max-w-5xl max-h-[calc(100vh-4rem)] flex flex-col overflow-hidden"
                            onClick={e => e.stopPropagation()}>

                            {/* Cabecera */}
                            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <Wallet size={16} className="text-custom-cyan shrink-0" />
                                    <div className="min-w-0">
                                        <h3 className="text-sm font-black leading-tight truncate text-zinc-100">
                                            Estado de cuenta · {codigoCuenta(movsDe)} "{movsDe.nombre}"
                                        </h3>
                                        <p className="text-[11px] text-zinc-500">Cuenta de saldo en {movsDe.moneda === 'USD' ? 'dólares' : 'pesos'} · creada {fmtFechaCorta(movsDe.fechaAlta)}</p>
                                    </div>
                                </div>
                                <button onClick={() => setMovsDe(null)} title="Cerrar el estado de cuenta"
                                    className="p-2 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors shrink-0">
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Resumen */}
                            <div className="px-5 py-3 bg-brand-dark border-b border-zinc-800 flex flex-wrap items-center gap-x-6 gap-y-2 shrink-0">
                                <div className="flex items-baseline gap-2">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Saldo actual</span>
                                    <span className={`text-sm font-black ${saldoFinal < 0 ? 'text-rose-400' : 'text-custom-cyan'}`}>{sym} {fmtNum(saldoFinal)}</span>
                                </div>
                                <div className="flex items-baseline gap-2 sm:ml-auto">
                                    <span className="text-[11px] text-zinc-500">{movs.length} movimientos</span>
                                </div>
                            </div>

                            {/* Movimientos */}
                            <div className="flex-1 min-h-0 overflow-auto">
                                {movs.length === 0 ? (
                                    <p className="text-center text-zinc-500 text-sm py-12">Esta cuenta todavía no tiene movimientos.</p>
                                ) : (
                                    <table className="w-full text-xs">
                                        <thead className="sticky top-0 z-10">
                                            <tr className="text-[10px] text-zinc-500 uppercase bg-custom-dark border-b border-zinc-800">
                                                <th className="px-3 py-2 text-left font-semibold">Fecha</th>
                                                <th className="px-3 py-2 text-left font-semibold">Tipo</th>
                                                <th className="px-3 py-2 text-left font-semibold">Documento</th>
                                                <th className="px-3 py-2 text-left font-semibold">Concepto</th>
                                                <th className="px-3 py-2 text-right font-semibold">Saldo Ini.</th>
                                                <th className="px-3 py-2 text-right font-semibold">Debe</th>
                                                <th className="px-3 py-2 text-right font-semibold">Haber</th>
                                                <th className="px-3 py-2 text-right font-semibold">Saldo Fn.</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-zinc-800/60">
                                            {movs.map(m => (
                                                <tr key={m.id} className={`hover:bg-zinc-800/20 transition-colors ${m.anulado ? 'opacity-40' : ''}`}>
                                                    <td className="px-3 py-2 text-zinc-500 whitespace-nowrap">{fmtFechaCorta(m.fecha)}</td>
                                                    <td className="px-3 py-2 whitespace-nowrap">
                                                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                                                            m.anulado ? 'bg-zinc-700/30 text-zinc-500'
                                                                : m.importe >= 0 ? 'bg-emerald-500/10 text-emerald-400'
                                                                    : 'bg-brand-cyan/10 text-custom-cyan'
                                                        }`}>
                                                            {m.anulado ? `${m.tipo} (anulado)` : m.tipo}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-2 font-bold text-zinc-200 whitespace-nowrap">
                                                        {m.documento || '—'}
                                                        {m.docId && !m.anulado && (
                                                            <button onClick={() => descargarComprobante(movsDe, m.docId)}
                                                                title={`Descargar el comprobante ${m.documento || ''} en PDF`}
                                                                className="ml-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-bold text-custom-cyan bg-brand-cyan/10 hover:bg-brand-cyan/20 border border-brand-cyan/30 rounded transition-colors align-middle">
                                                                <FileText size={10} /> PDF
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 text-zinc-400 max-w-[240px] truncate" title={m.concepto}>{m.concepto || '—'}</td>
                                                    <td className="px-3 py-2 text-right text-zinc-500 whitespace-nowrap">{sym} {fmtNum(m.saldoIn)}</td>
                                                    <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${m.debe > 0 ? 'text-rose-400' : 'text-zinc-700'}`}>
                                                        {m.debe > 0 ? `${sym} ${fmtNum(m.debe)}` : '—'}
                                                    </td>
                                                    <td className={`px-3 py-2 text-right whitespace-nowrap font-semibold ${m.haber > 0 ? 'text-emerald-400' : 'text-zinc-700'}`}>
                                                        {m.haber > 0 ? `${sym} ${fmtNum(m.haber)}` : '—'}
                                                    </td>
                                                    <td className={`px-3 py-2 text-right font-bold whitespace-nowrap ${m.saldoFn < 0 ? 'text-rose-400' : 'text-custom-cyan'}`}>
                                                        {sym} {fmtNum(m.saldoFn)}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )}
                            </div>

                            <div className="px-5 py-2.5 border-t border-zinc-800 bg-brand-dark flex items-center justify-between gap-3 shrink-0">
                                <span className="text-[11px] text-zinc-500">Vista de consulta: acá no se puede editar ni revertir ningún movimiento.</span>
                                <button onClick={() => setMovsDe(null)}
                                    className="px-4 py-2 text-xs font-bold text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors">
                                    Cerrar
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}

function SeccionPlanes({ planes, error, onVerConsumo }) {
    const activos = planes.filter(p => p.PlaActivo);
    const restanteActivo = activos.reduce((s, p) => s + Number(p.PlaCantidadRestante || 0), 0);
    // Solo activos por defecto: los planes agotados/cerrados se ven apagando el switch
    const [soloActivos, setSoloActivos] = useState(true);
    const visibles = soloActivos ? activos : planes;

    return (
        <div className="space-y-2">
            <TituloSeccion icon={Layers}>Planes de metros</TituloSeccion>

            {error ? (
                <div className="rounded-xl border border-zinc-800 bg-brand-dark py-8 text-center text-rose-400 text-sm">{error}</div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-zinc-800 bg-brand-dark">
                    {/* Resumen */}
                    <div className="px-4 py-3 bg-custom-dark border-b border-zinc-800 flex flex-wrap items-center gap-x-6 gap-y-2">
                        <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Disponible en planes activos</span>
                            <span className="text-base font-black tracking-tight text-emerald-400">{fmtNum(restanteActivo)}</span>
                        </div>
                        <span className="text-[11px] text-zinc-500">{activos.length} activo{activos.length !== 1 ? 's' : ''} de {planes.length}</span>
                        <span className="ml-auto">
                            <SwitchSolo checked={soloActivos} onChange={setSoloActivos} label="Solo activos"
                                title="Prendido: solo los planes con saldo vigente. Apagado: también los agotados y cerrados." />
                        </span>
                    </div>
                    {visibles.length === 0 && (
                        <p className="py-6 text-center text-zinc-500 text-sm">
                            No hay planes activos. Apagá "Solo activos" para ver los anteriores.
                        </p>
                    )}

                    {/* Tabla (desktop) */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                                    <th className="text-left font-bold px-4 py-2.5 whitespace-nowrap">Alta</th>
                                    <th className="text-left font-bold px-4 py-2.5 whitespace-nowrap">Artículo</th>
                                    <th className="text-right font-bold px-4 py-2.5 whitespace-nowrap">Comprado</th>
                                    <th className="text-right font-bold px-4 py-2.5 whitespace-nowrap">Usado</th>
                                    <th className="text-right font-bold px-4 py-2.5 whitespace-nowrap">Restante</th>
                                    <th className="text-left font-bold px-4 py-2.5 whitespace-nowrap">Consumo</th>
                                    <th className="text-left font-bold px-4 py-2.5 whitespace-nowrap">Vence</th>
                                    <th className="text-center font-bold px-4 py-2.5 whitespace-nowrap">Estado</th>
                                    <th className="text-center font-bold px-4 py-2.5 whitespace-nowrap">Detalle</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibles.map(p => (
                                    <tr key={p.PlaIdPlan} className={`border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/20 ${p.PlaActivo ? '' : 'opacity-50'}`}>
                                        {/* Sin el nombre interno del plan ("Plan desde Venta Directa Caja"): al cliente solo le dice algo la fecha de alta */}
                                        <td className="px-4 py-3 align-top">
                                            <span className="font-bold text-zinc-100 whitespace-nowrap">{fmtFechaCorta(p.PlaFechaAlta)}</span>
                                        </td>
                                        <td className="px-4 py-3 align-top text-zinc-400 text-xs">{p.NombreArticulo || '—'}</td>
                                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-zinc-200 align-top whitespace-nowrap">
                                            {fmtNum(p.PlaCantidadTotal)} {p.UniSimbolo || ''}
                                        </td>
                                        <td className="px-4 py-3 text-right tabular-nums text-zinc-500 align-top whitespace-nowrap">{fmtNum(p.PlaCantidadUsada)}</td>
                                        <td className={`px-4 py-3 text-right tabular-nums font-black align-top whitespace-nowrap ${Number(p.PlaCantidadRestante) > 0.01 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                                            {fmtNum(p.PlaCantidadRestante)}
                                        </td>
                                        <td className="px-4 py-3 align-top">
                                            <BarraConsumo pct={p.PorcentajeUsado} />
                                            <span className="block text-[10px] text-zinc-500 mt-1">{fmtNum(p.PorcentajeUsado, 1)}% usado</span>
                                        </td>
                                        <td className="px-4 py-3 align-top text-xs text-zinc-400 whitespace-nowrap">
                                            <Vence plan={p} />
                                        </td>
                                        <td className="px-4 py-3 text-center align-top">
                                            <ChipEstado activo={p.PlaActivo} />
                                        </td>
                                        <td className="px-4 py-3 text-center align-top">
                                            <button onClick={() => onVerConsumo(p)}
                                                title="Ver el estado de cuenta de este recurso: orden por orden, cómo se fueron consumiendo los metros"
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-custom-cyan bg-brand-cyan/10 hover:bg-brand-cyan/20 border border-brand-cyan/30 transition-colors whitespace-nowrap">
                                                <History size={12} /> Ver consumo
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Tarjetas (celular) */}
                    <div className="md:hidden divide-y divide-zinc-800/60">
                        {visibles.map(p => (
                            <div key={p.PlaIdPlan} className={`p-4 space-y-3 ${p.PlaActivo ? '' : 'opacity-50'}`}>
                                <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="font-bold text-zinc-100 text-sm truncate">{p.NombreArticulo || `Plan #${p.PlaIdPlan}`}</p>
                                        <p className="text-[11px] text-zinc-500 truncate">Alta {fmtFechaCorta(p.PlaFechaAlta)}</p>
                                    </div>
                                    <ChipEstado activo={p.PlaActivo} />
                                </div>

                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Comprado</p>
                                        <p className="text-sm font-bold tabular-nums text-zinc-200">{fmtNum(p.PlaCantidadTotal)} {p.UniSimbolo || ''}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Usado</p>
                                        <p className="text-sm font-bold tabular-nums text-zinc-400">{fmtNum(p.PlaCantidadUsada)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Restante</p>
                                        <p className={`text-sm font-black tabular-nums ${Number(p.PlaCantidadRestante) > 0.01 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                                            {fmtNum(p.PlaCantidadRestante)}
                                        </p>
                                    </div>
                                </div>

                                <div>
                                    <BarraConsumo pct={p.PorcentajeUsado} />
                                    <div className="flex items-center justify-between mt-1">
                                        <span className="text-[10px] text-zinc-500">{fmtNum(p.PorcentajeUsado, 1)}% usado</span>
                                        <span className="text-[10px] text-zinc-500"><Vence plan={p} /></span>
                                    </div>
                                </div>

                                <button onClick={() => onVerConsumo(p)}
                                    title="Ver el estado de cuenta de este recurso: orden por orden, cómo se fueron consumiendo los metros"
                                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-custom-cyan bg-brand-cyan/10 hover:bg-brand-cyan/20 border border-brand-cyan/30 transition-colors">
                                    <History size={13} /> Ver consumo
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════
   SECCIÓN 2 — TELAS DEL CLIENTE (metros físicos en depósito)
   ══════════════════════════════════════════════════════════════════════ */
function SeccionTelas({ telas, error, onVerConsumo }) {
    const totalDisp = telas.reduce((s, t) => s + Number(t.MetrosDisponibles || 0), 0);
    const totalBultos = telas.reduce((s, t) => s + Number(t.CantidadBultos || 0), 0);
    // Solo telas con saldo por defecto: las agotadas se ven apagando el switch
    const [soloConSaldo, setSoloConSaldo] = useState(true);
    const conSaldo = telas.filter(t => Number(t.MetrosDisponibles || 0) > 0.009);
    const visibles = soloConSaldo ? conSaldo : telas;

    return (
        <div className="space-y-2">
            <TituloSeccion icon={Package}>Mis telas en el depósito</TituloSeccion>

            {error ? (
                <div className="rounded-xl border border-zinc-800 bg-brand-dark py-8 text-center text-rose-400 text-sm">{error}</div>
            ) : (
                <div className="overflow-hidden rounded-xl border border-zinc-800 bg-brand-dark">
                    {/* Resumen */}
                    <div className="px-4 py-3 bg-custom-dark border-b border-zinc-800 flex flex-wrap items-center gap-x-6 gap-y-2">
                        <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Metros disponibles</span>
                            <span className="text-base font-black tracking-tight text-custom-cyan">{fmtNum(totalDisp)} m</span>
                        </div>
                        <span className="text-[11px] text-zinc-500">{totalBultos} bulto{totalBultos !== 1 ? 's' : ''} · {telas.length} tipo{telas.length !== 1 ? 's' : ''} de tela</span>
                        <span className="ml-auto">
                            <SwitchSolo checked={soloConSaldo} onChange={setSoloConSaldo} label="Solo con saldo"
                                title="Prendido: solo las telas con metros disponibles. Apagado: también las agotadas." />
                        </span>
                    </div>
                    {visibles.length === 0 && (
                        <p className="py-6 text-center text-zinc-500 text-sm">
                            No hay telas con saldo. Apagá "Solo con saldo" para ver las agotadas.
                        </p>
                    )}

                    {/* Tabla (desktop) */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="text-[10px] uppercase tracking-wider text-zinc-500 border-b border-zinc-800">
                                    <th className="text-left font-bold px-4 py-2.5 whitespace-nowrap">Tipo de tela</th>
                                    <th className="text-center font-bold px-4 py-2.5 whitespace-nowrap">Bultos</th>
                                    <th className="text-right font-bold px-4 py-2.5 whitespace-nowrap">Ingresados</th>
                                    <th className="text-right font-bold px-4 py-2.5 whitespace-nowrap">Consumidos</th>
                                    <th className="text-right font-bold px-4 py-2.5 whitespace-nowrap">Disponibles</th>
                                    <th className="text-right font-bold px-4 py-2.5 whitespace-nowrap">Libres</th>
                                    <th className="text-right font-bold px-4 py-2.5 whitespace-nowrap">En proceso</th>
                                    <th className="text-left font-bold px-4 py-2.5 whitespace-nowrap">Consumo</th>
                                    <th className="text-left font-bold px-4 py-2.5 whitespace-nowrap">Último ingreso</th>
                                    <th className="text-center font-bold px-4 py-2.5 whitespace-nowrap">Detalle</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibles.map((t, i) => (
                                    <tr key={`${t.InsumoID}_${i}`} className="border-b border-zinc-800/60 last:border-0 hover:bg-zinc-800/20">
                                        <td className="px-4 py-3 align-top">
                                            <span className="font-bold text-zinc-100">{t.TipoTela || t.InsumoNombre}</span>
                                            {t.TipoTela && t.InsumoNombre && t.TipoTela !== t.InsumoNombre && (
                                                <span className="block text-[11px] text-zinc-500">{t.InsumoNombre}</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-center tabular-nums text-zinc-400 align-top">{t.CantidadBultos}</td>
                                        <td className="px-4 py-3 text-right tabular-nums text-zinc-400 align-top">{fmtNum(t.MetrosIngresados)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums text-zinc-500 align-top">{fmtNum(t.MetrosConsumidos)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums font-black text-custom-cyan align-top">{fmtNum(t.MetrosDisponibles)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums text-emerald-400 font-semibold align-top">{fmtNum(t.MetrosLibres)}</td>
                                        <td className="px-4 py-3 text-right tabular-nums text-amber-400 font-semibold align-top">{fmtNum(t.MetrosEnProceso)}</td>
                                        <td className="px-4 py-3 align-top">
                                            <BarraConsumo pct={t.PorcentajeConsumido} />
                                            <span className="block text-[10px] text-zinc-500 mt-1">{fmtNum(t.PorcentajeConsumido, 1)}% consumido</span>
                                        </td>
                                        <td className="px-4 py-3 align-top text-xs text-zinc-400 whitespace-nowrap">{fmtFechaCorta(t.UltimoIngreso)}</td>
                                        <td className="px-4 py-3 text-center align-top">
                                            <button onClick={() => onVerConsumo(t)}
                                                title="Ver el estado de cuenta de esta tela: bulto por bulto, cómo se fueron consumiendo los metros"
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-custom-cyan bg-brand-cyan/10 hover:bg-brand-cyan/20 border border-brand-cyan/30 transition-colors whitespace-nowrap">
                                                <History size={12} /> Ver consumo
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Tarjetas (celular) */}
                    <div className="md:hidden divide-y divide-zinc-800/60">
                        {visibles.map((t, i) => (
                            <div key={`${t.InsumoID}_${i}`} className="p-4 space-y-3">
                                <div className="min-w-0">
                                    <p className="font-bold text-zinc-100 text-sm truncate">{t.TipoTela || t.InsumoNombre}</p>
                                    <p className="text-[11px] text-zinc-500 truncate">
                                        {t.CantidadBultos} bulto{Number(t.CantidadBultos) !== 1 ? 's' : ''} · Último ingreso {fmtFechaCorta(t.UltimoIngreso)}
                                    </p>
                                </div>

                                <div className="grid grid-cols-3 gap-2 text-center">
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Ingresados</p>
                                        <p className="text-sm font-bold tabular-nums text-zinc-200">{fmtNum(t.MetrosIngresados)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Consumidos</p>
                                        <p className="text-sm font-bold tabular-nums text-zinc-400">{fmtNum(t.MetrosConsumidos)}</p>
                                    </div>
                                    <div>
                                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Disponibles</p>
                                        <p className="text-sm font-black tabular-nums text-custom-cyan">{fmtNum(t.MetrosDisponibles)}</p>
                                    </div>
                                </div>

                                <div className="flex items-center justify-center gap-4 text-[10px]">
                                    <span className="text-emerald-400 font-semibold">Libres: {fmtNum(t.MetrosLibres)}</span>
                                    <span className="text-amber-400 font-semibold">En proceso: {fmtNum(t.MetrosEnProceso)}</span>
                                </div>

                                <div>
                                    <BarraConsumo pct={t.PorcentajeConsumido} />
                                    <span className="block text-[10px] text-zinc-500 mt-1">{fmtNum(t.PorcentajeConsumido, 1)}% consumido</span>
                                </div>

                                <button onClick={() => onVerConsumo(t)}
                                    title="Ver el estado de cuenta de esta tela: bulto por bulto, cómo se fueron consumiendo los metros"
                                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-custom-cyan bg-brand-cyan/10 hover:bg-brand-cyan/20 border border-brand-cyan/30 transition-colors">
                                    <History size={13} /> Ver consumo
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

/* ══════════════════════════════════════════════════════════════════════
   VISTA PRINCIPAL — Mis Recursos
   ══════════════════════════════════════════════════════════════════════ */
export const RecursosView = () => {
    const [planes, setPlanes] = useState([]);
    const [telas, setTelas] = useState([]);
    const [loading, setLoading] = useState(true);
    const [errorPlanes, setErrorPlanes] = useState(null);
    const [errorTelas, setErrorTelas] = useState(null);
    const [planConsumo, setPlanConsumo] = useState(null); // plan abierto en el modal
    const [telaConsumo, setTelaConsumo] = useState(null); // tela abierta en el modal

    useEffect(() => {
        let alive = true;
        Promise.allSettled([
            apiClient.get('/web-recursos/mis-recursos'),
            apiClient.get('/web-recursos/mis-telas'),
        ]).then(([rp, rt]) => {
            if (!alive) return;
            if (rp.status === 'fulfilled') setPlanes(rp.value.data || []);
            else setErrorPlanes(rp.reason?.message || 'No se pudieron cargar los planes.');
            if (rt.status === 'fulfilled') setTelas(rt.value.data || []);
            else setErrorTelas(rt.reason?.message || 'No se pudieron cargar las telas.');
            setLoading(false);
        });
        return () => { alive = false; };
    }, []);

    const sinNada = !planes.length && !telas.length && !errorPlanes && !errorTelas;

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex items-center gap-3 mb-2">
                <Layers size={48} strokeWidth={1} className="text-custom-cyan" />
                <div>
                    <h2 className="text-lg font-bold text-zinc-300 uppercase">Mis <span className="text-custom-cyan">Recursos</span></h2>
                    <p className="text-zinc-500 uppercase text-xs">Tus planes de metros y tus telas en el depósito: cuánto entró, cuánto se usó y cuánto te queda.</p>
                </div>
            </div>

            {loading ? (
                <div className="flex items-center justify-center min-h-[400px]">
                    <Loader2 className="animate-spin text-custom-cyan" size={36} />
                </div>
            ) : (
                <>
                    {/* Billetera: cuentas de saldo del cliente (crear / recargar / movimientos) */}
                    <SeccionCuentasSaldo />
                    {sinNada ? (
                        <div className="text-center py-16 text-zinc-500">
                            <Layers size={40} strokeWidth={1} className="mx-auto mb-3 text-zinc-600" />
                            <p className="text-sm font-medium">Todavía no tenés recursos cargados.</p>
                            <p className="text-xs mt-1">Cuando compres un plan de metros o dejes tela tuya en el depósito, los vas a ver acá.</p>
                        </div>
                    ) : (
                        <>
                            {(planes.length > 0 || errorPlanes) && (
                                <SeccionPlanes planes={planes} error={errorPlanes} onVerConsumo={setPlanConsumo} />
                            )}
                            {(telas.length > 0 || errorTelas) && (
                                <SeccionTelas telas={telas} error={errorTelas} onVerConsumo={setTelaConsumo} />
                            )}
                        </>
                    )}
                </>
            )}

            {planConsumo && (
                <ModalConsumoPlan plan={planConsumo} planes={planes} onClose={() => setPlanConsumo(null)} />
            )}
            {telaConsumo && (
                <ModalConsumoTela tela={telaConsumo} onClose={() => setTelaConsumo(null)} />
            )}
        </div>
    );
};
