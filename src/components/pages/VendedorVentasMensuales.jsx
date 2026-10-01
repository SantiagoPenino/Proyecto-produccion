import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { ChevronLeft, ChevronRight, RefreshCw, TrendingUp, Users } from 'lucide-react';
import api from '../../services/apiClient';

/* ══════════════════════════════════════════════════════════════════════
   VENTAS DEL MES POR VENDEDOR  (/vendedores/ventas)

   Desde el 01/10/2026 cuenta PLATA sobre DOCUMENTOS, no órdenes (las reglas
   están en vendedorVistaController.getVentasMensuales):
     · VENDIDO    = total de los documentos de venta del mes (e-tickets,
                    e-facturas y Pedidos Caja, sin anulados) menos las notas
                    de crédito. Mismo universo que Contabilidad → Reportes →
                    Ventas por Documento. Entran todos, estén o no aceptados
                    por DGI.
     · EL MES     = por fecha de emisión del documento.
     · VENDEDOR   = el de la cartera del cliente del documento.
     · Las monedas son las del documento y NO se convierten.
     · TOTAL UNIFICADO = US$ vendido + $ vendido ÷ cotización. Es la única
                    columna que mezcla monedas, y usa la cotización DEL DÍA (la
                    de Caja, /apicotizaciones), no la de cada documento. Da lo
                    mismo que el "Total facturado" del resumen unificado de
                    Contabilidad, que desde el 1-oct-2026 también resta las
                    notas de crédito.
     · El endpoint también manda lo cobrado y lo sin cobrar de cada fila y
       acepta un filtro de DGI: se sacaron de la pantalla el 1-oct-2026.
   ══════════════════════════════════════════════════════════════════════ */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const MONEDAS = ['UYU', 'USD'];

const money = (n) => (Number(n) || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const vendido = (v, moneda) => Number(v?.monedas?.[moneda]?.vendido) || 0;
// Las dos monedas en dólares: los dólares más los pesos pasados con la cotización. Sin cotización no hay número.
const unificado = (usd, uyu, cotizacion) => (cotizacion > 0 ? usd + uyu / cotizacion : null);
// CotFecha es una fecha sin hora: se toma el día del texto para que la zona horaria no lo corra.
const diaMes = (fecha) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha || '')); return m ? `${m[3]}/${m[2]}` : ''; };

// Foto del vendedor: la misma del registro del portal (public/assets/images/asesores/<cédula>.webp,
// ver RegisterPage.jsx). Si no hay foto, la inicial. Las filas que no son de un vendedor llevan un
// círculo neutro, para que los nombres queden alineados.
function FotoVendedor({ cedula, nombre }) {
    const [sinFoto, setSinFoto] = useState(false);
    const base = 'w-9 h-9 rounded-full shrink-0';
    if (!cedula) {
        return <span className={`${base} bg-slate-100 text-slate-400 flex items-center justify-center`}><Users size={15} /></span>;
    }
    if (sinFoto) {
        return (
            <span className={`${base} bg-brand-cyan text-white flex items-center justify-center text-sm font-black`}>
                {String(nombre || '?').trim().charAt(0).toUpperCase()}
            </span>
        );
    }
    return <img src={`/assets/images/asesores/${cedula}.webp`} alt="" onError={() => setSinFoto(true)}
        className={`${base} object-cover bg-slate-100`} />;
}

// Una celda de plata: guion si es cero (o si no se puede calcular); el total unificado va en negrita.
function Celda({ valor, unificada = false, total = false }) {
    const vacio = valor == null || Math.abs(valor) < 0.005;
    return (
        <td className={`py-3 text-right tabular-nums whitespace-nowrap border-l ${total ? 'border-slate-200' : 'border-slate-100'} ${unificada ? 'pl-3 pr-4' : 'px-3'} ${vacio ? 'text-slate-300' : unificada ? 'font-black text-slate-800' : 'text-slate-700'}`}>
            {vacio ? '—' : money(valor)}
        </td>
    );
}

export default function VendedorVentasMensuales() {
    const hoy = new Date();
    const [anio, setAnio] = useState(hoy.getFullYear());
    const [mes, setMes] = useState(hoy.getMonth() + 1);
    const [data, setData] = useState([]);
    const [notas, setNotas] = useState({ UYU: 0, USD: 0 });
    const [loading, setLoading] = useState(false);
    // Cotización del día (pesos por dólar): la misma de Caja
    const [cotizacion, setCotizacion] = useState(null);
    const [cotFecha, setCotFecha] = useState(null);
    const [cargandoCot, setCargandoCot] = useState(false);

    // La última cotización cargada en el sistema, con su fecha
    const leerCotizacion = useCallback(async () => {
        const r = await api.get('/apicotizaciones/hoy');
        const c = r.data?.cotizaciones?.[0];
        const valor = Number(c?.CotDolar);
        if (!(valor > 0)) throw new Error('Sin cotización cargada');
        setCotizacion(valor);
        setCotFecha(c.CotFecha || null);
        return valor;
    }, []);

    useEffect(() => {
        leerCotizacion().catch(() => toast.error('No se pudo cargar la cotización del dólar'));
    }, [leerCotizacion]);

    // Pide la de hoy: si todavía no está cargada, el servidor la busca en el BCU y la guarda
    const refrescarCotizacion = async () => {
        if (cargandoCot) return;
        setCargandoCot(true);
        try {
            await api.get('/apicotizaciones/bcu');
            const valor = await leerCotizacion();
            toast.success(`Cotización: 1 US$ = $ ${money(valor)}`);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo actualizar la cotización');
        } finally { setCargandoCot(false); }
    };

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/vendedor-360/ventas-mensuales', { params: { anio, mes } });
            setData(r.data?.data || []);
            setNotas(r.data?.notas || { UYU: 0, USD: 0 });
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudieron cargar las ventas del mes');
            setData([]);
            setNotas({ UYU: 0, USD: 0 });
        } finally { setLoading(false); }
    }, [anio, mes]);

    useEffect(() => { cargar(); }, [cargar]);

    const mover = (delta) => {
        let m = mes + delta, a = anio;
        if (m < 1) { m = 12; a -= 1; }
        if (m > 12) { m = 1; a += 1; }
        setMes(m); setAnio(a);
    };

    // Totales de la fila de cierre: incluye las filas sin vendedor, para que cierre con Contabilidad
    const tot = useMemo(() => {
        const t = { UYU: 0, USD: 0 };
        data.forEach(v => MONEDAS.forEach(m => { t[m] += vendido(v, m); }));
        return t;
    }, [data]);

    const esMesFuturo = anio > hoy.getFullYear() || (anio === hoy.getFullYear() && mes > hoy.getMonth() + 1);
    // Las notas llegan con su signo (crédito resta, débito suma) y ya están dentro del vendido
    const hayNotas = Math.abs(notas.UYU) >= 0.005 || Math.abs(notas.USD) >= 0.005;
    const textoNotas = [
        Math.abs(notas.UYU) >= 0.005 ? `$ ${money(notas.UYU)}` : null,
        Math.abs(notas.USD) >= 0.005 ? `US$ ${money(notas.USD)}` : null,
    ].filter(Boolean).join(' y ');

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
                        <p className="text-xs text-slate-500">Documentos de venta emitidos en el mes, por cartera de cliente</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {/* Cotización con la que se arma "Total unificado" */}
                    <div className="flex items-center h-9 rounded-lg border border-slate-200 bg-white overflow-hidden"
                        title={cotFecha ? `Cotización del ${diaMes(cotFecha)}` : 'Sin cotización cargada'}>
                        <span className="pl-3 pr-2.5 text-xs text-slate-500 whitespace-nowrap">
                            1 US$ = <b className="text-sm text-slate-800 tabular-nums">{cotizacion ? `$ ${money(cotizacion)}` : '—'}</b>
                        </span>
                        <button onClick={refrescarCotizacion} disabled={cargandoCot}
                            className="w-9 h-9 border-l border-slate-200 hover:bg-slate-50 flex items-center justify-center text-brand-cyan disabled:opacity-40"
                            title="Actualizar la cotización">
                            <RefreshCw size={14} className={cargandoCot ? 'animate-spin' : ''} />
                        </button>
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
            </div>

            {/* Tabla */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                                <th className="text-left font-bold px-4 py-3">Vendedor</th>
                                <th className="text-right font-bold px-3 py-3 border-l border-slate-200 whitespace-nowrap">$ vendido</th>
                                <th className="text-right font-bold px-3 py-3 border-l border-slate-200 whitespace-nowrap">US$ vendido</th>
                                <th className="text-right font-bold pl-3 pr-4 py-3 border-l border-slate-200 whitespace-nowrap text-slate-700"
                                    title="US$ vendido + $ vendido ÷ cotización del día">Total unificado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading && (
                                <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400 text-sm">Cargando…</td></tr>
                            )}
                            {!loading && data.length === 0 && (
                                <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-400 text-sm">Sin vendedores en el área de Ventas.</td></tr>
                            )}
                            {!loading && data.map(v => {
                                const esVendedor = (v.tipo || 'VENDEDOR') === 'VENDEDOR';
                                return (
                                    <tr key={v.cedula || v.tipo}
                                        className={`border-b border-slate-100 last:border-0 ${v.esMio ? 'bg-brand-cyan/5' : 'hover:bg-slate-50/70'}`}>
                                        <td className="px-4 py-2">
                                            <div className="flex items-center gap-2">
                                                <FotoVendedor cedula={esVendedor ? v.cedula : null} nombre={v.nombre} />
                                                <span className={`ml-1 ${esVendedor ? 'font-bold text-slate-700' : 'italic text-slate-500'}`}>{v.nombre}</span>
                                                {v.esMio && (
                                                    <span className="px-1.5 py-0.5 rounded bg-brand-cyan text-white text-[9px] font-black tracking-wider">VOS</span>
                                                )}
                                                {v.puesto === 'ENCARGADO' && (
                                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] font-bold tracking-wider">ENCARGADO</span>
                                                )}
                                            </div>
                                        </td>
                                        {MONEDAS.map(m => <Celda key={m} valor={vendido(v, m)} />)}
                                        <Celda valor={unificado(vendido(v, 'USD'), vendido(v, 'UYU'), cotizacion)} unificada />
                                    </tr>
                                );
                            })}
                        </tbody>
                        {!loading && data.length > 0 && (
                            <tfoot>
                                <tr className="bg-slate-50 border-t-2 border-slate-200 font-black">
                                    <td className="px-4 py-3 text-[11px] uppercase tracking-wider text-slate-500">Total</td>
                                    {MONEDAS.map(m => <Celda key={m} valor={tot[m]} total />)}
                                    <Celda valor={unificado(tot.USD, tot.UYU, cotizacion)} unificada total />
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* Pie: qué se está contando */}
            <div className="mt-4 flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <Users size={13} className="mt-0.5 shrink-0" />
                <span>
                    <b>Vendido</b> es el total de los documentos de venta emitidos en el mes (e-tickets, e-facturas y pedidos de caja),
                    menos las notas de crédito, atribuido al vendedor de la cartera del cliente.
                    {' '}Los rollos y la carga de billetera cuentan cuando se venden; los anticipos y los recibos no son ventas.
                    {' '}Las monedas son las del documento y van separadas, sin convertir.
                    {' '}<b>Total unificado</b> suma lo vendido en dólares y lo vendido en pesos pasado a dólares
                    {cotizacion
                        ? <> con la cotización {cotFecha ? `del ${diaMes(cotFecha)}` : 'del día'} (<b>$ {money(cotizacion)}</b>), no con la de cada documento.</>
                        : <>; falta la cotización para calcularlo.</>}
                    {' '}Da lo mismo que el «Total facturado» de Contabilidad.
                    {hayNotas && <> Las notas de este mes suman <b>{textoNotas}</b> y ya están restadas del vendido.</>}
                </span>
            </div>
        </div>
    );
}
