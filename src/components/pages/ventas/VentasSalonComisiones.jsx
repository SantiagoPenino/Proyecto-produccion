import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { ChevronDown, Crown, Plus, Settings2, Store, Trash2, Users } from 'lucide-react';
import api from '../../../services/apiClient';
import { errorDe, INPUT, BTN_PRIMARIO, BTN_SECUNDARIO } from './solicitudesComunes';
import {
    MESES, SIMBOLO, ALTO_FILA, ESTILOS, entradaMes, rachaAntesDe, money, r2, diaMes,
    textoFranja, comisionDe, escalaDe, FotoVendedor, PastillaGanador, PastillaRacha, TiraGanadores, Celda, CeldaTotal,
    BarraFranjas, PastillaFranja, FaltaParaFranja, EncabezadoFranjas, useOrdenAnimado, useProgreso,
    useCotizacionMes, CotizacionMes, SelectorMes,
} from './comisionesComunes';

/* ══════════════════════════════════════════════════════════════════════
   COMISIONES DE SALÓN  (/vendedores/salon-comisiones) — 19/10/2026

   Como Ventas por vendedor, pero sobre las ventas que cargan a mano los
   vendedores de salón (/vendedores/salon, tabla VentasSalon):
     · VENDIDO    = la suma de sus ventas del mes (por la fecha de la venta),
                    sin las anuladas, en cada moneda.
     · TOTAL UNIFICADO EN US$ = US$ vendido + $ vendido ÷ cotización: la del
                    día en el mes en curso, la última del mes en uno cerrado.
     · FRANJAS    = las de la tabla VentasSalonFranjas (las cambia un Admin
                    acá mismo). El % de la franja alcanzada va sobre TODO el
                    total, como en vendedores.
     · GANADORES  = el primero de cada mes, desde el primer mes con ventas.
     · Al tocar un vendedor se ven sus ventas del mes.
   ══════════════════════════════════════════════════════════════════════ */

const fechaCorta = (f) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(f || '')); return m ? `${m[3]}/${m[2]}` : ''; };
const claveFila = (v) => `U${v.idUsuario}`;
const vendido = (v, moneda) => Number(v?.monedas?.[moneda]?.vendido) || 0;
const totalDe = (v, cotizacion) => (cotizacion > 0 ? vendido(v, 'USD') + vendido(v, 'UYU') / cotizacion : null);

// Editor de franjas (solo Admin): la lista completa se reemplaza al guardar
function EditorFranjas({ franjas, onCerrar, onGuardado }) {
    const [filas, setFilas] = useState(() => (franjas.length ? franjas : [{ desde: '', pct: '' }]).map(f => ({ desde: String(f.desde), pct: String(f.pct).replace('.', ',') })));
    const [guardando, setGuardando] = useState(false);
    const cambiar = (k, campo, valor) => setFilas(fs => fs.map((f, j) => (j === k ? { ...f, [campo]: valor } : f)));
    const guardar = async () => {
        const lista = filas.filter(f => f.desde !== '' || f.pct !== '')
            .map(f => ({ desde: Number(String(f.desde).replace(/\./g, '').replace(',', '.')), pct: Number(String(f.pct).replace(',', '.')) }));
        if (!window.confirm('Las franjas nuevas cambian la comisión de TODOS los meses que se miren en esta pantalla, también los ya cerrados. ¿Guardar?')) return;
        setGuardando(true);
        try {
            const r = await api.put('/ventas-salon/franjas', { franjas: lista });
            toast.success(`Franjas guardadas: ${r.data.data.length}`);
            onGuardado(r.data.data);
        } catch (e) {
            toast.error(errorDe(e));
        } finally { setGuardando(false); }
    };
    return (
        <div className="mb-4 bg-white border border-sky-200 rounded-xl shadow-sm p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                    <h2 className="text-sm font-black text-slate-700">Franjas de comisión de salón</h2>
                    <p className="text-xs text-slate-500">Desde qué total unificado en US$ del mes aplica cada %. El % va sobre todo el total, no por tramos.</p>
                </div>
                <button onClick={onCerrar} className="text-xs font-bold text-slate-500 hover:underline">Cerrar sin guardar</button>
            </div>
            <div className="space-y-2 max-w-md">
                {filas.map((f, k) => (
                    <div key={k} className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 w-20">Desde US$</span>
                        <input value={f.desde} onChange={e => cambiar(k, 'desde', e.target.value)} inputMode="decimal" className={`${INPUT} !w-32 tabular-nums`} placeholder="0" />
                        <input value={f.pct} onChange={e => cambiar(k, 'pct', e.target.value)} inputMode="decimal" className={`${INPUT} !w-20 tabular-nums`} placeholder="1" />
                        <span className="text-xs text-slate-500">%</span>
                        <button onClick={() => setFilas(fs => fs.filter((_, j) => j !== k))} className="p-1.5 rounded-lg hover:bg-red-50 text-red-500" title="Quitar esta franja">
                            <Trash2 size={14} />
                        </button>
                    </div>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
                <button onClick={() => setFilas(fs => [...fs, { desde: '', pct: '' }])} className={BTN_SECUNDARIO}><Plus size={13} /> Agregar franja</button>
                <button onClick={guardar} disabled={guardando} className={BTN_PRIMARIO}>Guardar franjas</button>
            </div>
        </div>
    );
}

// Las ventas de un vendedor en el mes, al desplegar su fila
function DetalleVentas({ idUsuario, anio, mes, columnas }) {
    const [ventas, setVentas] = useState(null);
    useEffect(() => {
        api.get('/ventas-salon', { params: { anio, mes, idUsuario } })
            .then(r => setVentas(r.data.data || []))
            .catch(e => { toast.error(errorDe(e)); setVentas([]); });
    }, [idUsuario, anio, mes]);
    if (ventas == null) return <tr><td colSpan={columnas} className="py-2 pl-10 text-xs text-slate-400 bg-slate-50/70">Cargando ventas…</td></tr>;
    return ventas.map(v => (
        <tr key={v.id} className={`border-b border-slate-100 bg-slate-50/70 text-xs ${v.anulada ? 'text-slate-400' : 'text-slate-600'}`} style={{ animation: 'filaEntra .25s ease-out' }}>
            <td className="py-1.5 pl-10 pr-4">
                <span className="tabular-nums">{fechaCorta(v.fecha)}</span> · <span className={v.anulada ? 'line-through' : ''}>{v.cliente}</span>
                {v.observaciones && <span className="text-slate-400"> · {v.observaciones}</span>}
                {v.anulada && <span className="ml-1 font-bold text-red-500">Anulada: {v.motivoAnulacion}</span>}
            </td>
            <td className={`py-1.5 px-3 text-center tabular-nums border-l border-slate-100 ${v.anulada ? 'line-through' : ''}`}>{v.moneda === 'UYU' ? money(v.monto) : ''}</td>
            <td className={`py-1.5 px-3 text-center tabular-nums border-l border-slate-100 ${v.anulada ? 'line-through' : ''}`}>{v.moneda === 'USD' ? money(v.monto) : ''}</td>
            <td className="border-l border-slate-100" />
            <td className="border-l border-slate-100" />
        </tr>
    ));
}

export default function VentasSalonComisiones() {
    const hoy = new Date();
    const [anio, setAnio] = useState(hoy.getFullYear());
    const [mes, setMes] = useState(hoy.getMonth() + 1);
    const [data, setData] = useState([]);
    const [loading, setLoading] = useState(false);
    const [vuelta, setVuelta] = useState(0);
    const [ganadores, setGanadores] = useState([]);
    const [direccion, setDireccion] = useState(0);
    const [franjas, setFranjas] = useState([]);
    const [perfil, setPerfil] = useState(null);
    const [editarFranjas, setEditarFranjas] = useState(false);
    const [abierto, setAbierto] = useState(null);       // idUsuario con sus ventas desplegadas
    const { cotizacion, cotFecha, esMesActual, cargandoCot, refrescarCotizacion } = useCotizacionMes(anio, mes);

    const aFranjas = (lista) => (lista || []).map(f => ({ ...f, texto: textoFranja(f.pct) }));
    useEffect(() => {
        api.get('/ventas-salon/mi-perfil').then(r => setPerfil(r.data.data)).catch(() => {});
        api.get('/ventas-salon/franjas').then(r => setFranjas(aFranjas(r.data.data))).catch(e => toast.error(errorDe(e)));
    }, []);

    const cargar = useCallback(async () => {
        setLoading(true);
        setAbierto(null);
        try {
            const r = await api.get('/ventas-salon/resumen', { params: { anio, mes } });
            setData(r.data.data || []);
            setVuelta(n => n + 1);
        } catch (e) {
            toast.error(errorDe(e));
            setData([]);
        } finally { setLoading(false); }
    }, [anio, mes]);
    useEffect(() => { cargar(); }, [cargar]);

    const cargarGanadores = useCallback(async () => {
        try {
            const r = await api.get('/ventas-salon/ganadores');
            setGanadores(r.data.data || []);
        } catch (e) {
            toast.error(errorDe(e));
        }
    }, []);
    useEffect(() => { cargarGanadores(); }, [cargarGanadores]);

    // Se puede ir desde el primer mes con ventas (el primero de la tira) hasta el mes en curso
    const primerMes = ganadores[0] ? ganadores[0].anio * 12 + ganadores[0].mes : hoy.getFullYear() * 12 + hoy.getMonth() + 1;
    const indiceMes = anio * 12 + mes;
    const indiceHoy = hoy.getFullYear() * 12 + hoy.getMonth() + 1;
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
        irA(a, m);
    };

    const tot = useMemo(() => ({
        UYU: r2(data.reduce((s, v) => s + vendido(v, 'UYU'), 0)),
        USD: r2(data.reduce((s, v) => s + vendido(v, 'USD'), 0)),
        ventas: data.reduce((s, v) => s + v.ventas, 0),
    }), [data]);
    const enDolares = (valor) => (cotizacion > 0 ? valor / cotizacion : null);

    const escala = useMemo(() => escalaDe(franjas, data.reduce((m, v) => Math.max(m, totalDe(v, cotizacion) || 0), 0)), [franjas, data, cotizacion]);
    const totalComisiones = cotizacion > 0 ? r2(data.reduce((s, v) => s + comisionDe(totalDe(v, cotizacion), franjas), 0)) : null;
    const progreso = useProgreso(!loading && data.length > 0 && cotizacion > 0 ? vuelta : null);

    const porTotal = useMemo(() => {
        if (!(cotizacion > 0)) return data;
        return [...data].sort((a, b) => totalDe(b, cotizacion) - totalDe(a, cotizacion));
    }, [data, cotizacion]);

    // El primero del mes y su racha (este mes más los cerrados seguidos que ganó antes), y la ventaja sobre el segundo
    const lider = useMemo(() => {
        if (!(cotizacion > 0) || porTotal.length === 0) return null;
        const total = totalDe(porTotal[0], cotizacion);
        if (!(total > 0)) return null;
        const segundo = porTotal[1] && totalDe(porTotal[1], cotizacion) > 0 ? porTotal[1] : null;
        const i = ganadores.findIndex(m => m.anio === anio && m.mes === mes);
        const clave = claveFila(porTotal[0]);
        return {
            idUsuario: porTotal[0].idUsuario,
            racha: 1 + (i >= 0 ? rachaAntesDe(ganadores, i, clave) : 0),
            segundo,
            ventaja: segundo ? total - totalDe(segundo, cotizacion) : null,
        };
    }, [porTotal, cotizacion, ganadores, anio, mes]);

    // Al cargar, las filas aparecen como llegan (por nombre) y enseguida se acomodan por total
    const [acomodadas, setAcomodadas] = useState(false);
    useEffect(() => { setAcomodadas(!loading && data.length > 0); }, [loading, data]);
    const filas = acomodadas ? porTotal : data;
    const cuerpoTabla = useOrdenAnimado();
    const nombreMes = MESES[mes - 1].toLowerCase();
    const COLUMNAS = 5;
    // La clave de la fila (U<idUsuario>) es la misma que manda el servidor en los ganadores: así se cuenta la racha

    return (
        <div className="px-4 pt-3 pb-4 md:px-6 md:pt-0 md:pb-6 w-full font-sans text-slate-800">
            <style>{ESTILOS}</style>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center">
                        <Store size={20} />
                    </div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight text-slate-800">Comisiones de salón</h1>
                        <p className="text-xs text-slate-500">Ventas de promos que cargaron los vendedores de salón en el mes</p>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {perfil?.editaFranjas && (
                        <button onClick={() => setEditarFranjas(x => !x)} className={BTN_SECUNDARIO} title="Cambiar desde qué total aplica cada % de comisión">
                            <Settings2 size={13} /> Franjas de comisión
                        </button>
                    )}
                    <CotizacionMes cotizacion={cotizacion} cotFecha={cotFecha} esMesActual={esMesActual} nombreMes={nombreMes}
                        cargandoCot={cargandoCot} onRefrescar={refrescarCotizacion} />
                    <SelectorMes anio={anio} mes={mes} direccion={direccion} loading={loading}
                        puedeAtras={indiceMes > primerMes} puedeAdelante={indiceMes < indiceHoy} onMover={mover}
                        onActualizar={() => { setDireccion(0); cargar(); cargarGanadores(); }} />
                </div>
            </div>

            {editarFranjas && (
                <EditorFranjas franjas={franjas} onCerrar={() => setEditarFranjas(false)}
                    onGuardado={(lista) => { setFranjas(aFranjas(lista)); setEditarFranjas(false); setVuelta(n => n + 1); }} />
            )}
            {franjas.length === 0 && (
                <div className="mb-4 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    Todavía no hay franjas de comisión cargadas: nadie tiene comisión.
                    {perfil?.editaFranjas ? ' Cargalas con «Franjas de comisión».' : ' Las carga un administrador.'}
                </div>
            )}

            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                {ganadores.length > 0 && <TiraGanadores meses={ganadores} anio={anio} mes={mes} onElegir={irA} />}
                <div key={vuelta} className="overflow-x-auto animado-mes" style={entradaMes(direccion, 40, '.4s')}>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                                <th className="text-left font-bold p-0"><EncabezadoFranjas escala={escala} franjas={franjas} /></th>
                                <th className="text-center font-bold px-3 py-3 border-l border-slate-200 whitespace-nowrap">{SIMBOLO.UYU} vendido</th>
                                <th className="text-center font-bold px-3 py-3 border-l border-slate-200 whitespace-nowrap">{SIMBOLO.USD} vendido</th>
                                <th className="text-center font-bold px-3 py-3 border-l border-slate-200 whitespace-nowrap">Ventas</th>
                                <th className="text-center font-bold pl-3 pr-4 py-3 border-l border-slate-200 whitespace-nowrap text-slate-700"
                                    title="US$ vendido + $ vendido ÷ cotización: la del día en el mes en curso, la última del mes en un mes cerrado">
                                    Total unificado en US$
                                </th>
                            </tr>
                        </thead>
                        <tbody ref={cuerpoTabla}>
                            {loading && <tr><td colSpan={COLUMNAS} className="px-4 py-10 text-center text-slate-400 text-sm">Cargando…</td></tr>}
                            {!loading && data.length === 0 && (
                                <tr><td colSpan={COLUMNAS} className="px-4 py-10 text-center text-slate-400 text-sm">Sin ventas de salón cargadas en {nombreMes}.</td></tr>
                            )}
                            {!loading && filas.map(v => {
                                const clave = claveFila(v);
                                const total = totalDe(v, cotizacion);
                                const esLider = !!lider && lider.idUsuario === v.idUsuario;
                                const esSegundo = !!lider?.segundo && lider.segundo.idUsuario === v.idUsuario;
                                const abiertoEste = abierto === v.idUsuario;
                                const alternar = () => setAbierto(x => (x === v.idUsuario ? null : v.idUsuario));
                                return (
                                    <React.Fragment key={clave}>
                                        <tr data-fila={clave} onClick={alternar} role="button" tabIndex={0} aria-expanded={abiertoEste}
                                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternar(); } }}
                                            title={abiertoEste ? 'Ocultar sus ventas' : 'Ver sus ventas del mes'}
                                            className={`border-b border-slate-100 last:border-0 bg-white cursor-pointer outline-none focus-visible:bg-slate-50 ${v.esMio ? 'bg-gradient-to-r from-brand-cyan/5 to-brand-cyan/5' : 'hover:bg-slate-50'}`}>
                                            <td className="p-0 align-middle relative" style={{ height: ALTO_FILA }}>
                                                <FotoVendedor cedula={v.cedula} nombre={v.nombre} sinCedula />
                                                {esLider && (
                                                    <span className={`absolute top-0 left-0 z-[1] w-6 h-6 rounded-br-lg flex items-center justify-center text-white ${esMesActual ? 'bg-amber-400' : 'bg-amber-500'}`}
                                                        title={esMesActual ? 'Va ganando' : `Ganó ${nombreMes}`}>
                                                        <Crown size={14} />
                                                    </span>
                                                )}
                                                <div className="min-w-[240px] px-4 py-2 flex flex-col gap-1.5" style={{ marginLeft: ALTO_FILA }}>
                                                    <div className="flex items-center gap-2 min-w-0 overflow-hidden leading-5">
                                                        <span className="font-bold text-slate-700 truncate">{v.nombre}</span>
                                                        {v.esMio && <span className="px-1.5 py-0.5 rounded bg-brand-cyan text-white text-[9px] leading-4 font-black tracking-wider">VOS</span>}
                                                        {total != null && <PastillaFranja valor={total * progreso} franjas={franjas} />}
                                                        {esLider && <PastillaGanador enCurso={esMesActual} mes={nombreMes} />}
                                                        {esLider && !esMesActual && lider.racha >= 2 && <PastillaRacha racha={lider.racha} />}
                                                        <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform duration-300 ${abiertoEste ? 'rotate-180' : ''}`} />
                                                    </div>
                                                    {total != null ? (
                                                        <>
                                                            <BarraFranjas valor={total * progreso} escala={escala} franjas={franjas} />
                                                            <div className="text-[11px] leading-4 text-slate-400 truncate">
                                                                <FaltaParaFranja total={total} franjas={franjas} />
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
                                            <Celda valor={vendido(v, 'UYU')} columna="vendido" primera enDolares={enDolares(vendido(v, 'UYU'))} />
                                            <Celda valor={vendido(v, 'USD')} columna="vendido" primera />
                                            <td className="px-3 py-2 text-center tabular-nums border-l border-slate-100 text-slate-600">{v.ventas}</td>
                                            <CeldaTotal valor={total} comision={total != null ? comisionDe(total, franjas) : null} />
                                        </tr>
                                        {abiertoEste && <DetalleVentas idUsuario={v.idUsuario} anio={anio} mes={mes} columnas={COLUMNAS} />}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                        {!loading && data.length > 0 && (
                            <tfoot>
                                <tr className="bg-slate-50 border-t-2 border-slate-200 font-black">
                                    <td className="px-4 py-3 text-[11px] uppercase tracking-wider text-slate-500">Total</td>
                                    <Celda valor={tot.UYU} columna="vendido" total primera enDolares={enDolares(tot.UYU)} />
                                    <Celda valor={tot.USD} columna="vendido" total primera />
                                    <td className="px-3 py-3 text-center tabular-nums border-l border-slate-200 text-slate-600">{tot.ventas}</td>
                                    <CeldaTotal valor={cotizacion > 0 ? r2(tot.USD + tot.UYU / cotizacion) : null} comision={totalComisiones} total />
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            <div className="mt-4 flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <Users size={13} className="mt-0.5 shrink-0" />
                <span>
                    <b>Vendido</b> es la suma de las ventas de promos que cada vendedor cargó en «Ventas de salón» con fecha de este mes, sin las anuladas.
                    {' '}Tocá un vendedor para ver sus ventas. <b>Total unificado en US$</b> suma lo vendido en dólares y lo vendido en pesos pasado a dólares
                    {cotizacion
                        ? <> con {esMesActual ? 'la cotización del día' : `la última cotización de ${nombreMes}`} ({cotFecha ? `${diaMes(cotFecha)}, ` : ''}<b>$ {money(cotizacion)}</b>).</>
                        : <>; falta la cotización para calcularlo.</>}
                    {' '}<b>Comisión:</b> el porcentaje de la franja alcanzada sobre todo el total unificado
                    {franjas.length > 0 ? <> ({franjas.map(f => `desde US$ ${f.desde.toLocaleString('es-UY')}, ${f.texto}`).join('; ')}).</> : <> (sin franjas cargadas).</>}
                    {' '}<b>Ganadores:</b> el primero de cada mes por total unificado; en el mes en curso es provisorio.
                    {' '}Estas ventas se cargan a mano y no se cruzan con las facturas: no cambian «Ventas por vendedor» ni Contabilidad.
                </span>
            </div>
        </div>
    );
}
