import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, RefreshCw, TrendingUp, Users, AlertTriangle } from 'lucide-react';
import api from '../../services/apiClient';

/* ══════════════════════════════════════════════════════════════════════
   VENTAS DEL MES POR VENDEDOR  (/vendedores/ventas)

   Definiciones (acordadas 02/09/2026 — están también en el backend):
     · VENTA    = orden en OrdenesDeposito de un cliente de la cartera del
                  vendedor (Clientes.VendedorID = cédula del trabajador).
     · COBRADA  = la orden tiene PagIdPago. El 0 ("cubierto sin pago":
                  cuenta corriente o plan prepago) cuenta como cobrada.
     · EL MES   = por fecha de ingreso al depósito.
     · Se excluyen reposiciones/fallas (-R, -F) y canceladas/perdidas.
     · Las monedas NO se convierten: cada una va por su lado.
   ══════════════════════════════════════════════════════════════════════ */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const nf = (n) => (Number(n) || 0).toLocaleString('es-UY');
const money = (n) => (Number(n) || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function VendedorVentasMensuales() {
    const hoy = new Date();
    const [anio, setAnio] = useState(hoy.getFullYear());
    const [mes, setMes] = useState(hoy.getMonth() + 1);
    const [data, setData] = useState([]);
    const [huerfanas, setHuerfanas] = useState({ cant: 0, cobradas: 0 });
    const [loading, setLoading] = useState(false);

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/vendedor-360/ventas-mensuales', { params: { anio, mes } });
            setData(r.data?.data || []);
            setHuerfanas(r.data?.sinVendedorDelArea || { cant: 0, cobradas: 0 });
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudieron cargar las ventas del mes');
            setData([]);
        } finally { setLoading(false); }
    }, [anio, mes]);

    useEffect(() => { cargar(); }, [cargar]);

    const mover = (delta) => {
        let m = mes + delta, a = anio;
        if (m < 1) { m = 12; a -= 1; }
        if (m > 12) { m = 1; a += 1; }
        setMes(m); setAnio(a);
    };

    // Totales de la fila de cierre
    const tot = useMemo(() => data.reduce((acc, v) => {
        acc.cant += v.cantTotal;
        acc.cobradas += v.cobradasTotal;
        acc.sinCobrar += v.sinCobrarTotal;
        acc.uyu += v.monedas.UYU.monto;
        acc.uyuCobrado += v.monedas.UYU.montoCobrado;
        acc.usd += v.monedas.USD.monto;
        acc.usdCobrado += v.monedas.USD.montoCobrado;
        return acc;
    }, { cant: 0, cobradas: 0, sinCobrar: 0, uyu: 0, uyuCobrado: 0, usd: 0, usdCobrado: 0 }), [data]);

    const pct = (parte, total) => (total > 0 ? Math.round((parte / total) * 100) : 0);
    const esMesFuturo = anio > hoy.getFullYear() || (anio === hoy.getFullYear() && mes > hoy.getMonth() + 1);

    return (
        <div className="p-4 md:p-6 max-w-[1400px] mx-auto font-sans text-slate-800">
            {/* Encabezado */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center">
                        <TrendingUp size={20} />
                    </div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight text-slate-800">Ventas por vendedor</h1>
                        <p className="text-xs text-slate-500">Órdenes ingresadas al depósito en el mes, por cartera de cliente</p>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={() => mover(-1)} disabled={loading}
                        className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40"
                        title="Mes anterior">
                        <ChevronLeft size={16} />
                    </button>
                    <div className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold min-w-[170px] text-center">
                        {MESES[mes - 1]} {anio}
                    </div>
                    <button onClick={() => mover(1)} disabled={loading || esMesFuturo}
                        className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40"
                        title="Mes siguiente">
                        <ChevronRight size={16} />
                    </button>
                    <button onClick={cargar} disabled={loading}
                        className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40"
                        title="Actualizar">
                        <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Tabla */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                                <th className="text-left font-bold px-4 py-3">Vendedor</th>
                                <th className="text-right font-bold px-3 py-3">Ventas</th>
                                <th className="text-right font-bold px-3 py-3">Cobradas</th>
                                <th className="text-right font-bold px-3 py-3">Sin cobrar</th>
                                <th className="text-right font-bold px-3 py-3 border-l border-slate-200">$ vendido</th>
                                <th className="text-right font-bold px-3 py-3">$ cobrado</th>
                                <th className="text-right font-bold px-3 py-3 border-l border-slate-200">US$ vendido</th>
                                <th className="text-right font-bold px-4 py-3">US$ cobrado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400 text-sm">Cargando…</td></tr>
                            )}
                            {!loading && data.length === 0 && (
                                <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400 text-sm">Sin vendedores en el área de Ventas.</td></tr>
                            )}
                            {!loading && data.map(v => (
                                <tr key={v.cedula}
                                    className={`border-b border-slate-100 last:border-0 ${v.esMio ? 'bg-brand-cyan/5' : 'hover:bg-slate-50/70'}`}>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <span className="font-bold text-slate-700">{v.nombre}</span>
                                            {v.esMio && (
                                                <span className="px-1.5 py-0.5 rounded bg-brand-cyan text-white text-[9px] font-black tracking-wider">VOS</span>
                                            )}
                                            {v.puesto === 'ENCARGADO' && (
                                                <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-bold tracking-wider">ENCARGADO</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums font-black text-slate-800">{nf(v.cantTotal)}</td>
                                    <td className="px-3 py-3 text-right tabular-nums">
                                        <span className="font-bold text-emerald-600">{nf(v.cobradasTotal)}</span>
                                        {v.cantTotal > 0 && (
                                            <span className="text-[10px] text-slate-400 ml-1">{pct(v.cobradasTotal, v.cantTotal)}%</span>
                                        )}
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums">
                                        <span className={v.sinCobrarTotal > 0 ? 'font-bold text-amber-600' : 'text-slate-300'}>
                                            {nf(v.sinCobrarTotal)}
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums text-slate-700 border-l border-slate-100">
                                        {v.monedas.UYU.monto > 0 ? money(v.monedas.UYU.monto) : <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                                        {v.monedas.UYU.montoCobrado > 0 ? money(v.monedas.UYU.montoCobrado) : <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums text-slate-700 border-l border-slate-100">
                                        {v.monedas.USD.monto > 0 ? money(v.monedas.USD.monto) : <span className="text-slate-300">—</span>}
                                    </td>
                                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">
                                        {v.monedas.USD.montoCobrado > 0 ? money(v.monedas.USD.montoCobrado) : <span className="text-slate-300">—</span>}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                        {!loading && data.length > 0 && (
                            <tfoot>
                                <tr className="bg-slate-50 border-t-2 border-slate-200 font-black text-slate-800">
                                    <td className="px-4 py-3 text-[11px] uppercase tracking-wider text-slate-500">Total</td>
                                    <td className="px-3 py-3 text-right tabular-nums">{nf(tot.cant)}</td>
                                    <td className="px-3 py-3 text-right tabular-nums text-emerald-700">
                                        {nf(tot.cobradas)}
                                        {tot.cant > 0 && <span className="text-[10px] font-bold text-slate-400 ml-1">{pct(tot.cobradas, tot.cant)}%</span>}
                                    </td>
                                    <td className="px-3 py-3 text-right tabular-nums text-amber-600">{nf(tot.sinCobrar)}</td>
                                    <td className="px-3 py-3 text-right tabular-nums border-l border-slate-200">{money(tot.uyu)}</td>
                                    <td className="px-3 py-3 text-right tabular-nums text-emerald-700">{money(tot.uyuCobrado)}</td>
                                    <td className="px-3 py-3 text-right tabular-nums border-l border-slate-200">{money(tot.usd)}</td>
                                    <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{money(tot.usdCobrado)}</td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* Pie: qué se está contando y las que no tienen vendedor del área */}
            <div className="mt-4 flex flex-wrap gap-3">
                <div className="flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 flex-1 min-w-[280px]">
                    <Users size={13} className="mt-0.5 shrink-0" />
                    <span>
                        Una <b>venta</b> es una orden que entró al depósito en el mes, atribuida al vendedor de la cartera del cliente.
                        Se cuenta como <b>cobrada</b> si la orden tiene pago registrado (incluye lo que va a cuenta corriente o sale de un plan).
                        No se cuentan reposiciones ni fallas, y las monedas van separadas, sin convertir.
                    </span>
                </div>
                {huerfanas.cant > 0 && (
                    <div className="flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 min-w-[260px]">
                        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                        <span>
                            <b>{nf(huerfanas.cant)} ventas</b> del mes ({nf(huerfanas.cobradas)} cobradas) son de clientes cuyo
                            vendedor asignado ya no está en el área de Ventas. No se suman a nadie hasta reasignar esas carteras.
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
