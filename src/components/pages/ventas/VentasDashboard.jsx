import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { toast } from 'sonner';
import { BarChart3, ChevronRight, Download, Search, UserX, Users } from 'lucide-react';
import api from '../../../services/apiClient';
import { fmtFecha } from '../../../utils/fechas';
import { errorDe, INPUT, BTN_PRIMARIO } from './solicitudesComunes';
import { FilaFecha, FilaVerPor, Chip, KpiCard, rangoDeFiltros, paramsAmbito, descargarCSV, TopClientesSection } from '../ContabilidadReportesPage';

/* ══════════════════════════════════════════════════════════════════════
   DASHBOARD DE VENTAS — CLIENTES  (/vendedores/dashboard) — 23/10/2026

   Con el formato de Reportes de Administración (ContabilidadReportesPage):
   menú de reportes a la izquierda y cada reporte con sus filtros (FECHA,
   VER POR sector / área, y acá también el VENDEDOR). Reportes:
     · Clientes que no compran: ninguna orden cargada en los últimos N días
       (60 por defecto) pero sí antes; de cada uno, su estado, su vendedor,
       la última compra y lo que compraba en los 6 meses anteriores.
     · Resumen de clientes: lo del período (clientes que compraron, nuevos,
       pedidos, importes) y los 10 con más pedidos.
     · Top Clientes: el MISMO reporte de Administración (TopClientesSection),
       por monto facturado, con el detalle de comprobantes; acá además con
       la fila VENDEDOR (solo los clientes de esa cartera).
   Backend de los dos primeros: ventasDashboardController.js. Órdenes sin
   canceladas, fallas ni reposiciones.
   ══════════════════════════════════════════════════════════════════════ */

const REPORTES = [
    { id: 'sin-compras', label: 'Clientes que no compran', icon: UserX, color: 'text-amber-500',
        desc: 'Clientes sin ninguna orden cargada en los últimos N días (60 por defecto): estado, vendedor, última compra y lo que compraban' },
    { id: 'resumen', label: 'Resumen de clientes', icon: BarChart3, color: 'text-brand-cyan',
        desc: 'Clientes que compraron en el período, nuevos, pedidos e importes, y los 10 con más pedidos' },
    { id: 'top-clientes', label: 'Top Clientes', icon: Users, color: 'text-violet-500',
        desc: 'Ranking de clientes por monto facturado, con el detalle de sus comprobantes (el mismo reporte de Administración)' },
];

// La cartera elegida se comparte con Vista 360 del Cliente (VendedorCliente360.jsx)
const LS_VENDEDOR = 'vendedor360_cartera';
const DIAS_DEFECTO = 60;
const money = (n) => (Number(n) || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = (n) => (Number(n) || 0).toLocaleString('es-UY');

const ESTADOS = [
    { v: 'TODOS', l: 'Todos' },
    { v: 'ACTIVO', l: 'Activos' },
    { v: 'BLOQUEADO', l: 'Bloqueados' },
    { v: 'INACTIVO', l: 'Inactivos' },
    { v: 'SIN', l: 'Sin estado' },
];
const COLOR_ESTADO = {
    ACTIVO: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    BLOQUEADO: 'bg-red-50 text-red-700 border-red-200',
    INACTIVO: 'bg-slate-100 text-slate-500 border-slate-200',
};

function PastillaEstado({ estado }) {
    return (
        <span className={`inline-block px-1.5 py-0.5 rounded border text-[10px] leading-4 font-black tracking-wider ${COLOR_ESTADO[estado] || 'bg-amber-50 text-amber-700 border-amber-200'}`}
            title={estado ? `Estado de la ficha del cliente: ${estado}` : 'La ficha del cliente no tiene estado cargado'}>
            {estado || 'SIN ESTADO'}
        </span>
    );
}

// Importe en las dos monedas y cuántas órdenes no tienen precio
function Importe({ importe, ordenes }) {
    const nada = !(importe.USD > 0) && !(importe.UYU > 0);
    return (
        <div className="tabular-nums whitespace-nowrap">
            {importe.USD > 0 && <div className="font-bold text-slate-700">US$ {money(importe.USD)}</div>}
            {importe.UYU > 0 && <div className="font-bold text-slate-700">$ {money(importe.UYU)}</div>}
            {nada && <div className="text-slate-300">—</div>}
            {importe.sinPrecio > 0 && (
                <div className="text-[10px] text-amber-600" title="Órdenes sin precio en depósito: no suman al importe">
                    {importe.sinPrecio === ordenes ? 'ninguna con precio' : `${importe.sinPrecio} sin precio`}
                </div>
            )}
        </div>
    );
}

function Servicios({ servicios }) {
    return (
        <div className="flex flex-wrap gap-1">
            {servicios.map(s => (
                <span key={s.servicio} className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-800 text-[10px] leading-4 font-bold whitespace-nowrap"
                    title={`${s.servicio}: ${s.ordenes} ${s.ordenes === 1 ? 'orden' : 'órdenes'}`}>
                    {s.servicio} · {s.ordenes}
                </span>
            ))}
        </div>
    );
}

// [23/10/2026] El IDCliente primero (con qué se reconoce al cliente), después el nombre, el código y el tipo
function Cliente({ c }) {
    return (
        <div className="min-w-0">
            <div className="font-semibold text-teal-700 truncate">{c.alias || c.nombre}</div>
            {c.alias && <div className="text-[11px] text-slate-600 truncate" title={c.razonSocial && c.razonSocial !== c.nombre ? c.razonSocial : undefined}>{c.nombre}</div>}
            <div className="text-[10px] text-slate-400 font-mono truncate">
                {c.codCliente ?? '—'}{c.tipoCliente ? ` · ${c.tipoCliente}` : ''}
            </div>
        </div>
    );
}

// Fila VENDEDOR, con el mismo estilo de FECHA y VER POR
function FilaVendedor({ vendedores, vendedor, onVendedor }) {
    return (
        <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-bold text-slate-500 shrink-0 tracking-wide">VENDEDOR</span>
            <Chip active={!vendedor} onClick={() => onVendedor('')}>Todos</Chip>
            {vendedores.map(v => (
                <Chip key={v.VendedorID} active={vendedor === v.VendedorID} onClick={() => onVendedor(v.VendedorID)}>
                    <span title={`${v.CantClientes} clientes en su cartera`}>{v.Etiqueta}</span>
                </Chip>
            ))}
        </div>
    );
}

// Filtros que comparten los reportes propios de Ventas: VER POR y VENDEDOR (la cartera queda recordada)
function useFiltrosVentas() {
    const [verPor, setVerPor] = useState('sector');
    const [ambito, setAmbito] = useState('Todas');
    const [vendedores, setVendedores] = useState([]);
    const [vendedor, setVendedor] = useState(() => { try { return localStorage.getItem(LS_VENDEDOR) || ''; } catch { return ''; } });
    useEffect(() => {
        api.get('/vendedor-360/vendedores')
            .then(r => setVendedores(r.data.data || []))
            .catch(() => setVendedores([]));
    }, []);
    const elegirVendedor = (id) => {
        setVendedor(id);
        try { if (id) localStorage.setItem(LS_VENDEDOR, id); else localStorage.removeItem(LS_VENDEDOR); } catch { /* sin almacenamiento */ }
    };
    const params = useMemo(() => ({ ...paramsAmbito(ambito), ...(vendedor ? { vendedor } : {}) }), [ambito, vendedor]);
    return { verPor, setVerPor, ambito, setAmbito, vendedores, vendedor, elegirVendedor, params };
}

// ─── Clientes que no compran ──────────────────────────────────────────────────
function SinComprasSection({ opciones }) {
    const fv = useFiltrosVentas();
    const [diasTexto, setDiasTexto] = useState(String(DIAS_DEFECTO));
    const [dias, setDias] = useState(DIAS_DEFECTO);
    const [res, setRes] = useState(null);   // { data, datosDesde, meses }
    const [cargando, setCargando] = useState(false);
    const [estado, setEstado] = useState('TODOS');
    const [buscar, setBuscar] = useState('');

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const r = await api.get('/vendedor-360/dashboard/sin-compras', { params: { dias, ...fv.params } });
            setRes(r.data);
        } catch (e) {
            toast.error(errorDe(e));
            setRes(null);
        } finally { setCargando(false); }
    }, [dias, fv.params]);
    useEffect(() => { cargar(); }, [cargar]);

    const aplicarDias = () => {
        const n = Number(diasTexto);
        if (!Number.isInteger(n) || n < 1 || n > 3650) { toast.error('Poné una cantidad de días entre 1 y 3650.'); return; }
        setDias(n);
    };
    const lista = useMemo(() => {
        const texto = buscar.trim().toLowerCase();
        return (res?.data || []).filter(c => {
            if (estado === 'SIN' ? !!c.estado : estado !== 'TODOS' && c.estado !== estado) return false;
            if (!texto) return true;
            return [c.nombre, c.razonSocial, c.alias, String(c.codCliente ?? ''), c.vendedor].some(x => String(x || '').toLowerCase().includes(texto));
        });
    }, [res, estado, buscar]);
    const cuentaEstado = (v) => (res?.data || []).filter(c => (v === 'TODOS' ? true : v === 'SIN' ? !c.estado : c.estado === v)).length;
    const meses = res?.meses || 6;

    const exportar = () => descargarCSV(`clientes-sin-compras-${dias}-dias.csv`,
        ['IDCliente', 'Cliente', 'Razon social', 'Codigo', 'Estado', 'Tipo', 'Vendedor', 'Telefono', 'Email', 'Ultima compra', 'Dias sin comprar',
            `Servicios (${meses} meses antes)`, 'Pedidos', 'Ordenes', 'Importe US$', 'Importe $', 'Ordenes sin precio'],
        lista.map(c => [c.alias, c.nombre, c.razonSocial, c.codCliente, c.estado || 'SIN ESTADO', c.tipoCliente, c.vendedor, c.telefono, c.email,
            c.ultimaCompra, c.diasSinComprar, c.servicios.map(s => `${s.servicio} ${s.ordenes}`).join(' / '),
            c.pedidos, c.ordenes, c.importe.USD, c.importe.UYU, c.importe.sinPrecio]));

    const nombreVendedor = fv.vendedor ? (fv.vendedores.find(v => v.VendedorID === fv.vendedor)?.Etiqueta || fv.vendedor) : null;
    const textoAmbito = fv.ambito === 'Todas' ? null : fv.ambito.startsWith('S:')
        ? `el sector ${(opciones.sectores || []).find(s => String(s.id) === fv.ambito.slice(2))?.nombre || ''}`
        : fv.ambito.slice(2);
    const conDatos = lista.filter(c => c.importe.USD > 0 || c.importe.UYU > 0);

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-500 shrink-0 tracking-wide">NO COMPRAN HACE</span>
                    <input value={diasTexto} onChange={e => setDiasTexto(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') aplicarDias(); }}
                        inputMode="numeric" className="text-xs border border-slate-300 rounded-lg px-2 py-1 w-16 text-center font-bold tabular-nums outline-none focus:ring-2 focus:ring-brand-cyan/30"
                        aria-label="Cantidad de días sin comprar" />
                    <span className="text-[11px] text-slate-500">días corridos</span>
                    <button onClick={aplicarDias} className={BTN_PRIMARIO} disabled={Number(diasTexto) === dias}
                        title="Buscar los clientes sin ninguna orden cargada en esa cantidad de días">Buscar</button>
                </div>
                <FilaVerPor verPor={fv.verPor} onVerPor={fv.setVerPor} ambito={fv.ambito} onAmbito={fv.setAmbito} opciones={opciones} />
                <FilaVendedor vendedores={fv.vendedores} vendedor={fv.vendedor} onVendedor={fv.elegirVendedor} />
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-500 shrink-0 tracking-wide">ESTADO</span>
                    {ESTADOS.map(e => (
                        <Chip key={e.v} active={estado === e.v} onClick={() => setEstado(e.v)}>{e.l} ({cuentaEstado(e.v)})</Chip>
                    ))}
                    <div className="relative ml-2">
                        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={buscar} onChange={e => setBuscar(e.target.value)} placeholder="Buscar IDCliente, nombre o vendedor"
                            className={`${INPUT} !w-56 !pl-7 !py-1 !text-xs`} />
                    </div>
                    <button onClick={exportar} disabled={lista.length === 0}
                        className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-all shadow-sm"
                        title="Descargar esta lista (con los filtros de arriba) en un archivo CSV para Excel">
                        <Download size={13} /> Exportar CSV
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <KpiCard label={`Clientes sin compras hace ${dias} días`} value={res ? entero(lista.length) : '—'}
                    sub={res && lista.length !== res.data.length ? `de ${entero(res.data.length)} sin el filtro de estado o búsqueda` : 'compraron antes, ninguna orden desde entonces'} color="#f59e0b" />
                <KpiCard label="Activos que dejaron de comprar" value={res ? entero(lista.filter(c => c.estado === 'ACTIVO').length) : '—'} sub="con la ficha en ACTIVO" color="#059669" />
                <KpiCard label={`Lo que compraban (${meses} meses antes)`} value={res ? `US$ ${money(conDatos.reduce((s, c) => s + c.importe.USD, 0))}` : '—'}
                    sub={res ? `+ $ ${money(conDatos.reduce((s, c) => s + c.importe.UYU, 0))}` : ''} color="#8b5cf6" />
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-bold text-xs text-slate-700">
                        Clientes que no compran hace {dias} días{textoAmbito ? ` en ${textoAmbito}` : ''}{nombreVendedor ? ` · cartera de ${nombreVendedor}` : ''}
                    </span>
                    <span className="text-[11px] text-slate-400">{cargando ? 'Buscando…' : `${entero(lista.length)} clientes · lo que compraban en los ${meses} meses anteriores a su última compra`}</span>
                </div>
                {cargando && !res ? (
                    <div className="flex items-center justify-center py-14"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-cyan" /></div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-slate-50/50 border-b border-slate-100">
                                <tr>
                                    <th className="px-3 py-2 text-left text-slate-500 font-semibold">Cliente</th>
                                    <th className="px-3 py-2 text-left text-slate-500 font-semibold">Estado</th>
                                    <th className="px-3 py-2 text-left text-slate-500 font-semibold">Vendedor</th>
                                    <th className="px-3 py-2 text-left text-slate-500 font-semibold whitespace-nowrap">Última compra</th>
                                    <th className="px-3 py-2 text-left text-slate-500 font-semibold" title="Los servicios que usaba en los meses anteriores a su última compra, con cuántas órdenes de cada uno">Qué compraba</th>
                                    <th className="px-3 py-2 text-center text-slate-500 font-semibold">Pedidos</th>
                                    <th className="px-3 py-2 text-right text-slate-500 font-semibold">Importe</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {lista.map(c => (
                                    <tr key={c.cliIdCliente} className="hover:bg-cyan-50/40 align-top">
                                        <td className="px-3 py-2 max-w-[280px]">
                                            <Cliente c={c} />
                                            {(c.telefono || c.email) && <div className="text-[10px] text-slate-500 truncate">{[c.telefono, c.email].filter(Boolean).join(' · ')}</div>}
                                        </td>
                                        <td className="px-3 py-2"><PastillaEstado estado={c.estado} /></td>
                                        <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{c.vendedor || '—'}</td>
                                        <td className="px-3 py-2 whitespace-nowrap">
                                            <div className="font-semibold text-slate-700 tabular-nums">{fmtFecha(c.ultimaCompra)}</div>
                                            <div className={`text-[10px] font-bold ${c.diasSinComprar >= dias * 2 ? 'text-red-600' : 'text-amber-600'}`}>hace {entero(c.diasSinComprar)} días</div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <Servicios servicios={c.servicios} />
                                            {c.ventana.recortada && (
                                                <div className="text-[10px] text-slate-400 mt-0.5" title={`Hay órdenes en el sistema desde el ${fmtFecha(res?.datosDesde)}: los meses anteriores no se pueden ver`}>
                                                    desde el {fmtFecha(res?.datosDesde)} (antes no hay datos)
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-center tabular-nums">
                                            <div className="font-bold">{entero(c.pedidos)}</div>
                                            <div className="text-[10px] text-slate-400">{entero(c.ordenes)} órdenes</div>
                                        </td>
                                        <td className="px-3 py-2 text-right"><Importe importe={c.importe} ordenes={c.ordenes} /></td>
                                    </tr>
                                ))}
                                {res && !lista.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">Ningún cliente con estos filtros.</td></tr>}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <p className="text-[11px] text-slate-400">
                <b>No compra</b> = no tiene ninguna orden cargada en esos días corridos, pero sí antes. Con un sector o un área elegidos, se mira solo eso
                (puede seguir comprando otros servicios). Las órdenes canceladas, las fallas y las reposiciones no cuentan como compra.
                El importe sale del precio de cada orden en depósito; las que no lo tienen se cuentan como «sin precio».
            </p>
        </div>
    );
}

// ─── Resumen de clientes ──────────────────────────────────────────────────────
function ResumenSection({ opciones }) {
    const fv = useFiltrosVentas();
    const [f, setFRaw] = useState({ preset: '30d', desde: '', hasta: '' });
    const setF = (p) => setFRaw(x => ({ ...x, ...p }));
    const [resumen, setResumen] = useState(null);
    const [cargando, setCargando] = useState(false);
    const rango = rangoDeFiltros(f);

    const cargar = useCallback(async () => {
        if (!rango.desde || !rango.hasta) return;
        setCargando(true);
        try {
            const r = await api.get('/vendedor-360/dashboard/resumen', { params: { ...rango, ...fv.params } });
            setResumen(r.data.data);
        } catch (e) {
            toast.error(errorDe(e));
            setResumen(null);
        } finally { setCargando(false); }
    }, [rango.desde, rango.hasta, fv.params]); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { cargar(); }, [cargar]);

    const exportar = () => descargarCSV(`resumen-clientes-${rango.desde}-${rango.hasta}.csv`,
        ['#', 'IDCliente', 'Cliente', 'Codigo', 'Estado', 'Vendedor', 'Servicios', 'Pedidos', 'Ordenes', 'Importe US$', 'Importe $', 'Ordenes sin precio'],
        (resumen?.top || []).map((c, i) => [i + 1, c.alias, c.nombre, c.codCliente, c.estado || 'SIN ESTADO', c.vendedor, c.servicios.map(s => `${s.servicio} ${s.ordenes}`).join(' / '),
            c.pedidos, c.ordenes, c.importe.USD, c.importe.UYU, c.importe.sinPrecio]));

    return (
        <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2.5">
                <FilaFecha f={f} setF={setF} />
                <FilaVerPor verPor={fv.verPor} onVerPor={fv.setVerPor} ambito={fv.ambito} onAmbito={fv.setAmbito} opciones={opciones} />
                <div className="flex items-center gap-3 flex-wrap">
                    <FilaVendedor vendedores={fv.vendedores} vendedor={fv.vendedor} onVendedor={fv.elegirVendedor} />
                    <button onClick={exportar} disabled={!resumen?.top?.length}
                        className="ml-auto flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-semibold rounded-lg transition-all shadow-sm">
                        <Download size={13} /> Exportar CSV
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <KpiCard label="Clientes que compraron" value={resumen ? entero(resumen.clientes) : '—'} sub="con al menos una orden en el período" color="#0891b2" />
                <KpiCard label="Clientes nuevos" value={resumen ? entero(resumen.nuevos) : '—'} sub="su primera orden fue en el período" color="#059669" />
                <KpiCard label="Pedidos" value={resumen ? entero(resumen.pedidos) : '—'} sub={resumen ? `${entero(resumen.ordenes)} órdenes` : ''} color="#4f46e5" />
                <KpiCard label="Importe US$" value={resumen ? `US$ ${money(resumen.importe.USD)}` : '—'} sub="órdenes con precio en dólares" color="#0f766e" />
                <KpiCard label="Importe $" value={resumen ? `$ ${money(resumen.importe.UYU)}` : '—'}
                    sub={resumen && resumen.importe.sinPrecio > 0 ? `${entero(resumen.importe.sinPrecio)} órdenes sin precio` : 'órdenes con precio en pesos'} color="#b45309" />
            </div>

            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    <span className="font-bold text-xs text-slate-700">Los 10 clientes con más pedidos del período</span>
                    <span className="text-[11px] text-slate-400">{cargando ? 'Cargando…' : 'por pedidos; el importe sale del precio de cada orden'}</span>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50/50 border-b border-slate-100">
                            <tr>
                                <th className="px-3 py-2 text-left text-slate-400 font-semibold w-10">#</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-semibold">Cliente</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-semibold">Estado</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-semibold">Vendedor</th>
                                <th className="px-3 py-2 text-left text-slate-500 font-semibold">Servicios</th>
                                <th className="px-3 py-2 text-center text-slate-500 font-semibold">Pedidos</th>
                                <th className="px-3 py-2 text-right text-slate-500 font-semibold">Importe</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50">
                            {(resumen?.top || []).map((c, i) => (
                                <tr key={c.cliIdCliente} className="hover:bg-cyan-50/40 align-top">
                                    <td className="px-3 py-2">
                                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-lg text-[11px] font-extrabold ${i < 3 ? 'bg-brand-cyan text-white' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                                    </td>
                                    <td className="px-3 py-2 max-w-[260px]"><Cliente c={c} /></td>
                                    <td className="px-3 py-2"><PastillaEstado estado={c.estado} /></td>
                                    <td className="px-3 py-2 text-slate-600 whitespace-nowrap">{c.vendedor || '—'}</td>
                                    <td className="px-3 py-2"><Servicios servicios={c.servicios} /></td>
                                    <td className="px-3 py-2 text-center tabular-nums">
                                        <div className="font-bold">{entero(c.pedidos)}</div>
                                        <div className="text-[10px] text-slate-400">{entero(c.ordenes)} órdenes</div>
                                    </td>
                                    <td className="px-3 py-2 text-right"><Importe importe={c.importe} ordenes={c.ordenes} /></td>
                                </tr>
                            ))}
                            {resumen && !resumen.top.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-slate-400">Ningún cliente con órdenes en el período.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>
            <p className="text-[11px] text-slate-400">
                Sale de las órdenes cargadas en el período (sin canceladas, fallas ni reposiciones). <b>Nuevo</b> = su primera orden fue en el período.
                Para el ranking por monto facturado, con sus comprobantes, está <b>Top Clientes</b>.
            </p>
        </div>
    );
}

// ─── Top Clientes ─────────────────────────────────────────────────────────────
// El reporte de Administración tal cual (TopClientesSection), con la fila VENDEDOR: solo los clientes de esa cartera
function TopClientesVentas({ opciones }) {
    const fv = useFiltrosVentas();
    const paramsExtra = useMemo(() => (fv.vendedor ? { vendedor: fv.vendedor } : null), [fv.vendedor]);
    return (
        <TopClientesSection opciones={opciones} paramsExtra={paramsExtra}
            filtroExtra={<FilaVendedor vendedores={fv.vendedores} vendedor={fv.vendedor} onVendedor={fv.elegirVendedor} />} />
    );
}

export default function VentasDashboard() {
    const [activo, setActivo] = useState('sin-compras');
    const [opciones, setOpciones] = useState({ areas: [], sectores: [] });
    // Las mismas opciones que Reportes de Administración (Top Clientes usa también la cotización del día)
    useEffect(() => {
        api.get('/contabilidad/reportes/ventas-filtros').then(r => setOpciones({
            areas: r.data.areas || [],
            monedas: r.data.monedas || [],
            cotizacionDolar: r.data.cotizacionDolar || null,
            sectores: r.data.sectores || [],
            areasSinSector: r.data.areasSinSector || [],
        })).catch(() => {});
    }, []);
    const rep = REPORTES.find(r => r.id === activo);

    return (
        <div className="flex h-full bg-slate-50 overflow-hidden">
            {/* ── Menú de reportes (como Reportes de Administración) ── */}
            <aside className="w-56 bg-white border-r border-slate-200 flex flex-col shrink-0 shadow-sm">
                <div className="px-4 py-3.5 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                        <BarChart3 size={17} className="text-brand-cyan" />
                        <span className="font-bold text-slate-800 text-sm">Dashboard de ventas</span>
                    </div>
                </div>
                <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
                    {REPORTES.map(r => {
                        const Icon = r.icon;
                        const on = activo === r.id;
                        return (
                            <button key={r.id} onClick={() => setActivo(r.id)} title={r.desc}
                                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-all group ${on
                                    ? 'bg-brand-cyan text-white shadow-md shadow-brand-cyan/20'
                                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'}`}>
                                <Icon size={14} className={on ? 'text-white shrink-0' : `${r.color} shrink-0 opacity-80`} />
                                <span className="text-xs font-medium truncate flex-1">{r.label}</span>
                                {on && <ChevronRight size={11} className="text-white/70 shrink-0" />}
                            </button>
                        );
                    })}
                </nav>
            </aside>

            {/* ── Contenido ── */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="bg-white border-b border-slate-200 px-5 py-3 shadow-sm shrink-0">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-1.5 min-w-0">
                            {rep && (() => { const I = rep.icon; return <I size={15} className={rep.color} />; })()}
                            <span className="font-bold text-slate-700 text-sm">{rep?.label}</span>
                            <span className="text-[11px] text-slate-400 truncate hidden md:inline">· {rep?.desc}</span>
                        </div>
                    </div>
                </div>
                {/* Cada reporte trae sus filtros y se vuelve a leer al cambiarlos (como los de Administración) */}
                <div className="flex-1 overflow-auto p-4 space-y-4">
                    {activo === 'sin-compras' ? <SinComprasSection opciones={opciones} />
                        : activo === 'resumen' ? <ResumenSection opciones={opciones} />
                            : <TopClientesVentas opciones={opciones} />}
                </div>
            </div>
        </div>
    );
}
