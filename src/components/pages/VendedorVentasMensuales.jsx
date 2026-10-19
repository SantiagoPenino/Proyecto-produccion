import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Crown, TrendingUp, Users } from 'lucide-react';
import api from '../../services/apiClient';
import {
    MESES, MONEDAS, SIMBOLO, ALTO_FILA, ESTILOS, entradaMes, rachaAntesDe, money, r2, diaMes, comisionDe,
    FotoVendedor, PastillaGanador, PastillaRacha, TiraGanadores, Celda, CeldaCobro, CeldaTotal,
    BarraFranjas, PastillaFranja, FaltaParaFranja, EncabezadoFranjas, useOrdenAnimado, useProgreso,
    useCotizacionMes, CotizacionMes, SelectorMes,
} from './ventas/comisionesComunes';

/* ══════════════════════════════════════════════════════════════════════
   VENTAS DEL MES POR VENDEDOR  (/vendedores/ventas)

   Desde el 01/10/2026 cuenta PLATA sobre DOCUMENTOS, no órdenes (las reglas
   están en vendedorVistaController.getVentasMensuales):
     · VENDIDO    = total de los documentos de venta del mes (e-tickets,
                    e-facturas y Pedidos Caja, sin anulados) menos las notas
                    de crédito. Mismo universo que Contabilidad → Reportes →
                    Ventas por Documento. Entran todos, estén o no aceptados
                    por DGI.
     · PENDIENTE  = lo que todavía se debe de esos documentos.
     · COBRADO    = vendido − pendiente. Van en la misma columna: el cobrado
                    arriba (verde) y el pendiente abajo (rojo).
     · EL MES     = por fecha de emisión del documento.
     · VENDEDOR   = el de la cartera del cliente del documento.
     · Las monedas son las del documento y NO se convierten. Debajo del vendido
                    en pesos va, en chico, cuánto es en dólares (solo informativo).
     · TOTAL UNIFICADO EN US$ = US$ vendido + $ vendido ÷ cotización. La única
                    columna que mezcla monedas. La cotización (02/10/2026): en el
                    mes en curso, la del día (la de Caja, /apicotizaciones/hoy);
                    en un mes cerrado, la última de ese mes (/apicotizaciones/hasta),
                    así el total de un mes que ya pasó no cambia según el día en
                    que se mire. Nunca la de cada documento.
     · FRANJAS    = comisión sobre el total unificado (02/10/2026): el % de la
                    franja alcanzada se aplica a TODO el total. Cada vendedor
                    lleva una barra que se llena al cargar y va completando las
                    franjas.
     · ORDEN      = los vendedores por total unificado, de mayor a menor. Al
                    cargar, las filas aparecen como llegan y enseguida se acomodan
                    a la vista: cada fila se desliza entera hasta su lugar.
     · OTRAS VENTAS = lo que no es de ningún vendedor (clientes sin vendedor
                    del área, mostrador sin identificar) va junto en una sola
                    card al final; al tocarla se despliega cada parte con sus
                    números (02/10/2026).
     · GANADORES  = el primero de cada mes por total unificado, desde junio
                    2026 (/vendedor-360/ganadores). Una tira arriba de la tabla
                    con el ganador de cada mes (a lo sumo LIMITE_TIRA meses, con
                    flechas para ver los anteriores), donde los meses seguidos
                    del mismo vendedor van unidos con la racha; en la fila del
                    primero, corona, «Ganó <mes>» y la racha; si el mes está en
                    curso, solo «Va ganando». Y la ventaja sobre el segundo.
     · CAMBIO DE MES = el nombre del mes y la tabla entran deslizándose desde
                    el lado hacia el que se fue (adelante: desde la derecha).
     · El endpoint también acepta un filtro de DGI: el selector se sacó de la
       pantalla el 1-oct-2026.
   ══════════════════════════════════════════════════════════════════════ */

// 19/10/2026: las piezas de la pantalla (fotos, tira de ganadores, celdas, barra de franjas, orden animado,
// cotización y selector de mes) pasaron a ventas/comisionesComunes.jsx, que comparte con Comisiones de salón.

const COLUMNAS = ['vendido', 'cobrado', 'sinCobrar'];

// Franjas de comisión sobre el total unificado en US$ (las definió Santiago el 02/10/2026): el % de la
// franja alcanzada se aplica a TODO el total. Por debajo de la primera no hay comisión.
const FRANJAS = [
    { desde: 50000, pct: 0.8, texto: '0,8 %' },
    { desde: 75000, pct: 1, texto: '1 %' },
    { desde: 100000, pct: 1.2, texto: '1,2 %' },
    { desde: 125000, pct: 1.3, texto: '1,3 %' },
];
// La barra llega hasta acá, o más lejos si algún vendedor pasa
const ESCALA_MINIMA = 150000;
// El primer mes que se puede ver: antes de junio 2026 no hay datos, o no son confiables (Santiago, 02/10)
const PRIMER_MES = { anio: 2026, mes: 6 };
// Clave de la card que junta todo lo que no es de un vendedor
const OTRAS_VENTAS = 'OTRAS_VENTAS';

const importe = (v, moneda, columna) => Number(v?.monedas?.[moneda]?.[columna]) || 0;
// Las dos monedas en dólares: los dólares más los pesos pasados con la cotización. Sin cotización no hay número.
const unificado = (usd, uyu, cotizacion) => (cotizacion > 0 ? usd + uyu / cotizacion : null);
const totalDe = (v, cotizacion) => unificado(importe(v, 'USD', 'vendido'), importe(v, 'UYU', 'vendido'), cotizacion);

const claveFila = (v) => v.cedula || v.tipo;
const esFilaVendedor = (v) => (v.tipo || 'VENDEDOR') === 'VENDEDOR';

export default function VendedorVentasMensuales() {
    const hoy = new Date();
    const [anio, setAnio] = useState(hoy.getFullYear());
    const [mes, setMes] = useState(hoy.getMonth() + 1);
    const [data, setData] = useState([]);
    const [notas, setNotas] = useState({ UYU: 0, USD: 0 });
    const [loading, setLoading] = useState(false);
    const [vuelta, setVuelta] = useState(0);         // una por cada carga que llega: arranca el llenado de las barras
    const [verOtras, setVerOtras] = useState(false);   // card «Otras ventas» desplegada
    const [ganadores, setGanadores] = useState([]);     // el ganador de cada mes desde junio 2026
    const [direccion, setDireccion] = useState(0);      // hacia dónde se cambió de mes: 1 adelante, -1 atrás, 0 ninguno

    // Cotización con la que se unifica (pesos por dólar): en el mes en curso la del día, la misma de Caja;
    // en un mes cerrado, la última de ese mes, para que su total no cambie.
    const { cotizacion, cotFecha, esMesActual, cargandoCot, refrescarCotizacion } = useCotizacionMes(anio, mes);

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/vendedor-360/ventas-mensuales', { params: { anio, mes } });
            setData(r.data?.data || []);
            setNotas(r.data?.notas || { UYU: 0, USD: 0 });
            setVuelta(n => n + 1);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudieron cargar las ventas del mes');
            setData([]);
            setNotas({ UYU: 0, USD: 0 });
        } finally { setLoading(false); }
    }, [anio, mes]);

    useEffect(() => { cargar(); }, [cargar]);

    const cargarGanadores = useCallback(async () => {
        try {
            const r = await api.get('/vendedor-360/ganadores');
            setGanadores(r.data?.meses || []);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudieron cargar los ganadores de cada mes');
        }
    }, []);
    useEffect(() => { cargarGanadores(); }, [cargarGanadores]);

    // Ir a un mes (con las flechas o desde la tira de ganadores), anotando para qué lado para la animación
    const irA = (a, m) => {
        const d = Math.sign((a * 12 + m) - (anio * 12 + mes));
        if (d === 0) return;
        setDireccion(d);
        setMes(m); setAnio(a);
    };
    const mover = (delta) => {
        let m = mes + delta, a = anio;
        if (m < 1) { m = 12; a -= 1; }
        if (m > 12) { m = 1; a += 1; }
        if (a < PRIMER_MES.anio || (a === PRIMER_MES.anio && m < PRIMER_MES.mes)) return;
        irA(a, m);
    };

    // Totales de la fila de cierre: incluye las filas sin vendedor, para que cierre con Contabilidad
    const tot = useMemo(() => {
        const t = { UYU: { vendido: 0, cobrado: 0, sinCobrar: 0 }, USD: { vendido: 0, cobrado: 0, sinCobrar: 0 } };
        data.forEach(v => MONEDAS.forEach(m => COLUMNAS.forEach(c => { t[m][c] += importe(v, m, c); })));
        return t;
    }, [data]);

    // Debajo del vendido en pesos va cuánto es en dólares, con la misma cotización
    const enDolares = (moneda, valor) => (moneda === 'UYU' && cotizacion > 0 ? valor / cotizacion : null);

    // Los vendedores van cada uno en su card; lo demás (clientes sin vendedor del área, mostrador) se
    // junta en una sola card, «Otras ventas», que suma sus partes y al tocarla las muestra
    const vendedores = useMemo(() => data.filter(esFilaVendedor), [data]);
    const otrasVentas = useMemo(() => {
        const partes = data.filter(v => !esFilaVendedor(v));
        if (partes.length === 0) return null;
        const monedas = {};
        MONEDAS.forEach(m => {
            monedas[m] = {};
            COLUMNAS.forEach(c => { monedas[m][c] = partes.reduce((s, v) => s + importe(v, m, c), 0); });
        });
        return { tipo: OTRAS_VENTAS, nombre: 'Otras ventas', monedas, partes };
    }, [data]);

    // Franjas: la escala común de las barras y la suma de las comisiones (solo vendedores)
    const escala = useMemo(() => {
        const mayor = vendedores.reduce((m, v) => Math.max(m, totalDe(v, cotizacion) || 0), 0);
        return Math.max(ESCALA_MINIMA, Math.ceil(mayor / 25000) * 25000);
    }, [vendedores, cotizacion]);
    const totalComisiones = useMemo(() => (cotizacion > 0
        ? r2(vendedores.reduce((s, v) => s + comisionDe(totalDe(v, cotizacion), FRANJAS), 0))
        : null), [vendedores, cotizacion]);
    // Las barras se llenan cuando están los datos y la cotización, una vez por carga
    const progreso = useProgreso(!loading && data.length > 0 && cotizacion > 0 ? vuelta : null);

    // Orden de las cards: los vendedores por total unificado, de mayor a menor («Otras ventas» va siempre
    // al final). Sin cotización no hay total y quedan como llegan.
    const porTotal = useMemo(() => {
        if (!(cotizacion > 0)) return vendedores;
        return [...vendedores].sort((a, b) => totalDe(b, cotizacion) - totalDe(a, cotizacion));
    }, [vendedores, cotizacion]);

    // El primero del mes (la primera fila, con más de cero): su racha cuenta este mes más los meses cerrados
    // seguidos que ganó justo antes. La ventaja es sobre el segundo.
    const lider = useMemo(() => {
        if (!(cotizacion > 0) || porTotal.length === 0) return null;
        const total = totalDe(porTotal[0], cotizacion);
        if (!(total > 0)) return null;
        const segundo = porTotal[1] && totalDe(porTotal[1], cotizacion) > 0 ? porTotal[1] : null;
        const i = ganadores.findIndex(m => m.anio === anio && m.mes === mes);
        return {
            cedula: porTotal[0].cedula,
            racha: 1 + (i >= 0 ? rachaAntesDe(ganadores, i, porTotal[0].cedula) : 0),
            segundo,
            ventaja: segundo ? total - totalDe(segundo, cotizacion) : null,
        };
    }, [porTotal, cotizacion, ganadores, anio, mes]);

    // Al cargar, las filas se dibujan como llegan (así se sabe de dónde sale cada una) y en el paso
    // siguiente se ordenan por total: arrancan a moverse apenas aparecen, todas juntas y sin pausa
    const [acomodadas, setAcomodadas] = useState(false);
    useEffect(() => {
        setAcomodadas(!loading && data.length > 0);
    }, [loading, data]);
    const filas = acomodadas ? porTotal : vendedores;
    // Las celdas de plata de una fila: vendido y cobrado / pendiente, en pesos y en dólares
    const celdasPlata = (v) => MONEDAS.map(m => (
        <React.Fragment key={m}>
            <Celda valor={importe(v, m, 'vendido')} columna="vendido" primera enDolares={enDolares(m, importe(v, m, 'vendido'))} />
            <CeldaCobro cobrado={importe(v, m, 'cobrado')} pendiente={importe(v, m, 'sinCobrar')} />
        </React.Fragment>
    ));
    const alternarOtras = () => setVerOtras(x => !x);
    const cuerpoTabla = useOrdenAnimado();

    const esMesFuturo = anio > hoy.getFullYear() || (anio === hoy.getFullYear() && mes > hoy.getMonth() + 1);
    const esPrimerMes = anio < PRIMER_MES.anio || (anio === PRIMER_MES.anio && mes <= PRIMER_MES.mes);
    // Las notas llegan con su signo (crédito resta, débito suma) y ya están dentro del vendido
    const hayNotas = Math.abs(notas.UYU) >= 0.005 || Math.abs(notas.USD) >= 0.005;
    const textoNotas = [
        Math.abs(notas.UYU) >= 0.005 ? `$ ${money(notas.UYU)}` : null,
        Math.abs(notas.USD) >= 0.005 ? `US$ ${money(notas.USD)}` : null,
    ].filter(Boolean).join(' y ');
    const nombreMes = MESES[mes - 1].toLowerCase();

    return (
        <div className="px-4 pt-3 pb-4 md:px-6 md:pt-0 md:pb-6 w-full font-sans text-slate-800">
            {/* Sin margen arriba en pantallas grandes: el layout ya deja 24 px, y así queda cerca de la barra de arriba */}
            <style>{ESTILOS}</style>
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
                    <CotizacionMes cotizacion={cotizacion} cotFecha={cotFecha} esMesActual={esMesActual} nombreMes={nombreMes}
                        cargandoCot={cargandoCot} onRefrescar={refrescarCotizacion} />
                    <SelectorMes anio={anio} mes={mes} direccion={direccion} loading={loading}
                        puedeAtras={!esPrimerMes} puedeAdelante={!esMesFuturo} onMover={mover}
                        onActualizar={() => { setDireccion(0); cargar(); cargarGanadores(); }} />
                </div>
            </div>

            {/* Tabla */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                {ganadores.length > 0 && (
                    <TiraGanadores meses={ganadores} anio={anio} mes={mes} onElegir={irA} />
                )}
                <div key={vuelta} className="overflow-x-auto animado-mes" style={entradaMes(direccion, 40, '.4s')}>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                                <th className="text-left font-bold p-0"><EncabezadoFranjas escala={escala} franjas={FRANJAS} /></th>
                                {MONEDAS.map(m => (
                                    <React.Fragment key={m}>
                                        <th className="text-center font-bold px-3 py-3 border-l border-slate-200 whitespace-nowrap">{SIMBOLO[m]} vendido</th>
                                        {/* Cobrado sobre pendiente, con una línea entre los dos: así se lee la celda */}
                                        <th className="text-center font-bold px-3 py-2 whitespace-nowrap">
                                            <span className="inline-flex flex-col items-stretch">
                                                <span>{SIMBOLO[m]} cobrado</span>
                                                <span className="mt-1 pt-1 border-t border-slate-300">{SIMBOLO[m]} pendiente</span>
                                            </span>
                                        </th>
                                    </React.Fragment>
                                ))}
                                <th className="text-center font-bold pl-3 pr-4 py-3 border-l border-slate-200 whitespace-nowrap text-slate-700"
                                    title="US$ vendido + $ vendido ÷ cotización: la del día en el mes en curso, la última del mes en un mes cerrado">
                                    Total unificado en US$
                                </th>
                            </tr>
                        </thead>
                        <tbody ref={cuerpoTabla}>
                            {loading && (
                                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">Cargando…</td></tr>
                            )}
                            {!loading && data.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">Sin vendedores en el área de Ventas.</td></tr>
                            )}
                            {!loading && filas.map(v => {
                                const clave = claveFila(v);
                                const total = totalDe(v, cotizacion);
                                const esLider = !!lider && lider.cedula === v.cedula;
                                const esSegundo = !!lider?.segundo && lider.segundo.cedula === v.cedula;
                                return (
                                    // Fondo liso (el celeste va como degradé sobre blanco): al acomodarse, unas filas pasan por encima de otras
                                    <tr key={clave} data-fila={clave}
                                        className={`border-b border-slate-100 last:border-0 bg-white ${v.esMio ? 'bg-gradient-to-r from-brand-cyan/5 to-brand-cyan/5' : 'hover:bg-slate-50'}`}>
                                        <td className="p-0 align-middle relative" style={{ height: ALTO_FILA }}>
                                            <FotoVendedor cedula={v.cedula} nombre={v.nombre} />
                                            {esLider && (
                                                <span className={`absolute top-0 left-0 z-[1] w-6 h-6 rounded-br-lg flex items-center justify-center text-white ${esMesActual ? 'bg-amber-400' : 'bg-amber-500'}`}
                                                    title={esMesActual ? 'Va ganando' : `Ganó ${nombreMes}`}>
                                                    <Crown size={14} />
                                                </span>
                                            )}
                                            <div className="min-w-[240px] px-4 py-2 flex flex-col gap-1.5" style={{ marginLeft: ALTO_FILA }}>
                                                {/* En una sola línea cada renglón: la fila no crece y la foto sigue cuadrada */}
                                                <div className="flex items-center gap-2 min-w-0 overflow-hidden leading-5">
                                                    <span className="font-bold text-slate-700 truncate">{v.nombre}</span>
                                                    {v.esMio && (
                                                        <span className="px-1.5 py-0.5 rounded bg-brand-cyan text-white text-[9px] leading-4 font-black tracking-wider">VOS</span>
                                                    )}
                                                    {v.puesto === 'ENCARGADO' && (
                                                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] leading-4 font-bold tracking-wider">ENCARGADO</span>
                                                    )}
                                                    {total != null && <PastillaFranja valor={total * progreso} franjas={FRANJAS} />}
                                                    {esLider && <PastillaGanador enCurso={esMesActual} mes={nombreMes} />}
                                                    {esLider && !esMesActual && lider.racha >= 2 && <PastillaRacha racha={lider.racha} />}
                                                </div>
                                                {total != null ? (
                                                    <>
                                                        <BarraFranjas valor={total * progreso} escala={escala} franjas={FRANJAS} />
                                                        <div className="text-[11px] leading-4 text-slate-400 truncate">
                                                            <FaltaParaFranja total={total} franjas={FRANJAS} />
                                                            {esLider && lider.segundo && (
                                                                <> · {esMesActual ? 'Le lleva' : 'Le sacó'} <b className="font-bold text-slate-600 tabular-nums">US$ {money(lider.ventaja)}</b> a {lider.segundo.nombre}</>
                                                            )}
                                                            {esSegundo && (
                                                                <> · A <b className="font-bold text-slate-600 tabular-nums">US$ {money(lider.ventaja)}</b> del primer lugar</>
                                                            )}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="text-[11px] leading-4 text-slate-300">Falta la cotización para ubicarlo en las franjas</div>
                                                )}
                                            </div>
                                        </td>
                                        {celdasPlata(v)}
                                        <CeldaTotal valor={total} comision={total != null ? comisionDe(total, FRANJAS) : null} />
                                    </tr>
                                );
                            })}
                            {/* Todo lo que no es de un vendedor, en una sola card: al tocarla se despliegan sus partes */}
                            {!loading && otrasVentas && (
                                <>
                                    <tr data-fila={OTRAS_VENTAS} onClick={alternarOtras} role="button" tabIndex={0} aria-expanded={verOtras}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternarOtras(); } }}
                                        title={verOtras ? 'Ocultar el detalle' : 'Ver el detalle'}
                                        className="border-b border-slate-100 last:border-0 bg-white hover:bg-slate-50 cursor-pointer select-none outline-none focus-visible:bg-slate-50">
                                        {/* Sin foto ni ícono: el nombre arranca a la izquierda, como «Total», y la fila no guarda el alto de la foto */}
                                        <td className="p-0 align-middle">
                                            <div className="min-w-[240px] px-4 py-2 flex items-center gap-2 leading-5">
                                                <span className="font-bold text-slate-600">{otrasVentas.nombre}</span>
                                                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-300 ${verOtras ? 'rotate-180' : ''}`} />
                                            </div>
                                        </td>
                                        {celdasPlata(otrasVentas)}
                                        <CeldaTotal valor={totalDe(otrasVentas, cotizacion)} comision={null} />
                                    </tr>
                                    {verOtras && otrasVentas.partes.map(p => (
                                        <tr key={p.tipo} className="border-b border-slate-100 last:border-0 bg-slate-50/70" style={{ animation: 'filaEntra .25s ease-out' }}>
                                            <td className="py-2 pl-10 pr-4 align-middle italic text-slate-500">{p.nombre}</td>
                                            {celdasPlata(p)}
                                            <CeldaTotal valor={totalDe(p, cotizacion)} comision={null} />
                                        </tr>
                                    ))}
                                </>
                            )}
                        </tbody>
                        {!loading && data.length > 0 && (
                            <tfoot>
                                <tr className="bg-slate-50 border-t-2 border-slate-200 font-black">
                                    <td className="px-4 py-3 text-[11px] uppercase tracking-wider text-slate-500">Total</td>
                                    {MONEDAS.map(m => (
                                        <React.Fragment key={m}>
                                            <Celda valor={tot[m].vendido} columna="vendido" total primera
                                                enDolares={enDolares(m, tot[m].vendido)} />
                                            <CeldaCobro cobrado={tot[m].cobrado} pendiente={tot[m].sinCobrar} total />
                                        </React.Fragment>
                                    ))}
                                    <CeldaTotal valor={unificado(tot.USD.vendido, tot.UYU.vendido, cotizacion)} comision={totalComisiones} total />
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
                    {' '}<b>Pendiente</b> es lo que todavía se debe de esos documentos y <b>cobrado</b> es la diferencia.
                    {otrasVentas && <> <b>Otras ventas</b> junta lo que no es de ningún vendedor (clientes sin vendedor del área, mostrador): tocala para ver cada parte.</>}
                    {' '}<b>Ganadores:</b> el primero de cada mes por total unificado, desde junio 2026; los meses seguidos del mismo vendedor van unidos en la tira. En el mes en curso es provisorio.
                    {' '}Los rollos y la carga de billetera cuentan cuando se venden; los anticipos y los recibos no son ventas.
                    {' '}Las monedas son las del documento y van separadas{cotizacion ? '; debajo del vendido en pesos está cuánto es en dólares' : ''}.
                    {' '}<b>Total unificado en US$</b> suma lo vendido en dólares y lo vendido en pesos pasado a dólares
                    {cotizacion
                        ? <> con {esMesActual ? 'la cotización del día' : `la última cotización de ${nombreMes}`} ({cotFecha ? `${diaMes(cotFecha)}, ` : ''}<b>$ {money(cotizacion)}</b>), no con la de cada documento.</>
                        : <>; falta la cotización para calcularlo.</>}
                    {' '}Con esa misma cotización da lo mismo que el «Total facturado» de Contabilidad.
                    {' '}<b>Comisión:</b> el porcentaje de la franja alcanzada sobre todo el total unificado
                    {' '}({FRANJAS.map(f => `desde US$ ${f.desde.toLocaleString('es-UY')}, ${f.texto}`).join('; ')}). Por debajo de US$ {FRANJAS[0].desde.toLocaleString('es-UY')} no hay comisión.
                    {hayNotas && <> Las notas de este mes suman <b>{textoNotas}</b> y ya están restadas del vendido.</>}
                </span>
            </div>
        </div>
    );
}
