import React, { useState, useEffect, useRef } from 'react';
import { Microscope, Search, SearchX, Loader2, ScanSearch, UserCheck, Users, Globe, UserX } from 'lucide-react';
import api from '../../services/api';
import { toast } from 'sonner';

// Estética nueva (28/10/2026): pestaña «Inteligencia de Precios» clara (zinc + brand-cyan), lista de clientes de a 50
// (antes dibujaba los ~6.000 de una), niveles con número y cantidad, tablas por cantidad limpias (en el celular, una
// tarjeta por producto), montos en formato uruguayo y US$ cuando la regla está en dólares. En el celular la lista va
// arriba y el reporte abajo (antes el reporte quedaba fuera de la pantalla). Consultas, estados y armado de los
// grupos sin cambios.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ROTULO = 'text-[10px] font-black uppercase tracking-widest text-zinc-400';
const TH = 'px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap';
const CHIP_CIAN = 'bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20';
const CHIP_GRIS = 'bg-zinc-100 text-zinc-500 border-zinc-200';
const claseModo = (elegido) => `flex-1 text-xs font-bold py-1.5 rounded-lg transition-colors ${elegido ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`;
const claseItem = (elegido) => `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-colors select-none ${elegido
    ? 'bg-brand-cyan/10 border-brand-cyan/20'
    : 'border-transparent hover:bg-zinc-50'}`;

// Montos y porcentajes en formato uruguayo; «US$» si la regla está en dólares (MonIdMoneda 2), «$» si no
const fmtMonto = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v ?? ''); };
const fmtPct = (v) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString('es-UY', { maximumFractionDigits: 2 }) : String(v ?? ''); };
const simbolo = (r) => (r?.MonIdMoneda === 2 ? 'US$' : '$');
// Cantidad con su palabra en singular o plural ("1 cliente", "6.014 clientes")
const cuenta = (n, uno, varios) => `${Number(n).toLocaleString('es-UY')} ${n === 1 ? uno : varios}`;
const valorRegla = (r) => (r.TipoRegla.includes('percent') ? `${fmtPct(r.Valor)}%` : `${simbolo(r)} ${fmtMonto(r.Valor)}`);

// Título de cada nivel del reporte del cliente: número, texto y cantidad
const tituloNivel = (n, texto, cantidad) => (
    <div className="flex items-center gap-2.5 pb-2.5 mb-3 border-b border-zinc-100">
        <span className="w-6 h-6 rounded-lg border border-brand-cyan/20 bg-brand-cyan/10 text-brand-cyan text-[11px] font-black flex items-center justify-center shrink-0">{n}</span>
        <h4 className="flex-1 min-w-0 text-sm sm:text-base font-black text-zinc-800">{texto}</h4>
        <span className={`${CHIP} ${CHIP_GRIS} tabular-nums`}>{cantidad}</span>
    </div>
);
const vacioNivel = (texto) => <p className="text-sm text-zinc-400 bg-zinc-50 border border-zinc-100 rounded-xl px-4 py-3">{texto}</p>;

// En el celular, una tarjeta por producto en vez de la tabla por cantidades (una vista sola: no se dibujan las dos)
const MQ_TABLA = '(min-width: 768px)';
function useConTabla() {
    const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
    useEffect(() => {
        const mq = window.matchMedia(MQ_TABLA);
        const cambio = () => setConTabla(mq.matches);
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, []);
    return conTabla;
}

// Lista de clientes de a 50 (patrón useDeAPoco de ExcepcionesDeudaView): con la búsqueda vacía llegan ~6.000 y se
// dibujaban todos. Al acercarse al final se agregan 50 más. Vuelve a 50 cuando cambian las claves de reinicio (la
// lista que manda el contenedor, el filtro o la vista): filteredCustomers es un arreglo nuevo en cada render, por eso
// no se usa como clave.
const DE_A = 50;
const contenedorConScroll = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) return p;
    }
    return null;
};
function useDeAPoco(total, ...reinicio) {
    const [cuantos, setCuantos] = useState(DE_A);
    useEffect(() => { setCuantos(DE_A); }, reinicio); // eslint-disable-line react-hooks/exhaustive-deps
    const centinela = useRef(null);
    useEffect(() => {
        const el = centinela.current;
        if (!el || cuantos >= total) return undefined;
        // También si el aviso quedó arriba de la pantalla (un scroll rápido lo salteó)
        const obs = new IntersectionObserver(([e]) => {
            if (e.isIntersecting || (e.rootBounds && e.boundingClientRect.bottom < e.rootBounds.top)) setCuantos(c => c + DE_A);
        }, { root: contenedorConScroll(el), rootMargin: '0px 0px 400px 0px' });
        obs.observe(el);
        return () => obs.disconnect();
    }, [cuantos, total, ...reinicio]); // eslint-disable-line react-hooks/exhaustive-deps
    return [Math.min(cuantos, total), centinela];
}

const PriceReports = ({ customers = [], onSearch }) => {
    const [profiles, setProfiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [viewMode, setViewMode] = useState('clients'); // 'clients' | 'profiles'
    const [filterCust, setFilterCust] = useState('');

    // Selected Data
    const [selectedClient, setSelectedClient] = useState(null);
    const [selectedProfile, setSelectedProfile] = useState(null);
    
    // Results
    const [clientReport, setClientReport] = useState(null);
    const [profileReport, setProfileReport] = useState(null);

    useEffect(() => {
        // Load initial basic lists to populate selects
        api.get('/profiles').then(res => setProfiles(res.data)).catch(console.error);
        
        // Initial search to load customers if needed
        if (customers.length === 0 && onSearch) {
             onSearch(''); 
        }
    }, [customers.length, onSearch]);

    const handleSearchClient = async (cliId) => {
        if (!cliId) return;
        setLoading(true);
        setProfileReport(null);
        setSelectedClient(cliId);
        try {
            const res = await api.get(`/reports/client/${cliId}`);
            setClientReport(res.data);
        } catch (e) {
            toast.error("Error cargando reporte del cliente");
        } finally {
            setLoading(false);
        }
    };

    const handleSearchProfile = async (pId) => {
        if (!pId) return;
        setLoading(true);
        setClientReport(null);
        setSelectedProfile(pId);
        try {
            const res = await api.get(`/reports/profile/${pId}/clients`);
            // we also want to display profile name
            const profileMeta = profiles.find(p => p.ID.toString() === pId.toString());
            setProfileReport({
                profile: profileMeta,
                clients: res.data
            });
        } catch (e) {
            toast.error("Error buscando clientes del perfil");
        } finally {
            setLoading(false);
        }
    };

    // Filtrado Clientes
    const filteredCustomers = customers.filter(c => {
        if (!filterCust) return true;
        const lowerFilter = filterCust.toLowerCase();
        const cName = c.Nombre || c.NombreFantasia || '';
        return cName.toLowerCase().includes(lowerFilter) || String(c.CliIdCliente).includes(lowerFilter);
    });

    // Estética nueva (28/10/2026): tabla o tarjetas según el ancho y lista de clientes de a 50
    const conTabla = useConTabla();
    const [cuantos, centinela] = useDeAPoco(filteredCustomers.length, customers, filterCust, viewMode);
    const faltan = filteredCustomers.length - cuantos;

    return (
        <div className="h-full min-h-0 flex flex-col lg:flex-row gap-4 overflow-y-auto lg:overflow-hidden text-zinc-700">
            {/* SIDEBAR DE CONTROL */}
            <div className={`${CARD} lg:w-[340px] lg:h-full shrink-0 flex flex-col overflow-hidden`}>
                <div className="p-3 sm:p-4 border-b border-zinc-100 flex flex-col gap-3 shrink-0">
                    <div className="flex items-center gap-2">
                        <Microscope size={18} className="text-brand-cyan shrink-0" />
                        <h2 className={`${ROTULO} text-[11px] flex-1 min-w-0`}>Auditoría de Precios</h2>
                        <span className={`${CHIP} ${CHIP_GRIS} tabular-nums`}>
                            {viewMode === 'clients'
                                ? cuenta(filteredCustomers.length, 'cliente', 'clientes')
                                : cuenta(profiles.length, 'perfil', 'perfiles')}
                        </span>
                    </div>

                    {/* Switch Mode */}
                    <div className="flex rounded-xl border border-zinc-200 bg-white p-1 gap-1 select-none" role="tablist" aria-label="Tipo de reporte">
                        <button
                            type="button"
                            role="tab"
                            aria-selected={viewMode === 'clients'}
                            onClick={() => setViewMode('clients')}
                            className={claseModo(viewMode === 'clients')}
                        >
                            Visión Cliente
                        </button>
                        <button
                            type="button"
                            role="tab"
                            aria-selected={viewMode === 'profiles'}
                            onClick={() => setViewMode('profiles')}
                            className={claseModo(viewMode === 'profiles')}
                        >
                            Visión Perfil
                        </button>
                    </div>

                    {/* Searcher for Clients */}
                    {viewMode === 'clients' && (
                        <div className="relative">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                            <input
                                className={CAMPO}
                                placeholder="Buscar por nombre o ID..."
                                aria-label="Buscar cliente por nombre o ID"
                                value={filterCust}
                                onChange={e => {
                                    setFilterCust(e.target.value);
                                    if (onSearch) onSearch(e.target.value);
                                }}
                            />
                        </div>
                    )}
                </div>

                {/* List Content (en el celular, con alto tope para que el reporte quede a mano abajo) */}
                <div className="flex-1 min-h-0 overflow-y-auto max-h-80 lg:max-h-none p-2">
                    {viewMode === 'clients' ? (
                        <div className="flex flex-col gap-0.5">
                            {filteredCustomers.length === 0 ? (
                                <div className="px-4 py-10 flex flex-col items-center text-center">
                                    <SearchX size={40} className="mb-3 text-brand-cyan" />
                                    <span className="text-sm font-bold text-zinc-700">No se encontraron clientes.</span>
                                </div>
                            ) : (
                                filteredCustomers.slice(0, cuantos).map(c => {
                                    const cId = c.CliIdCliente;
                                    const cName = c.Nombre || c.NombreFantasia || `Cliente ${cId}`;
                                    const isSelected = selectedClient === cId;

                                    // Extract initials
                                    const words = cName.split(' ').filter(Boolean);
                                    let initials = '?';
                                    if (words.length > 1) {
                                        initials = (words[0][0] + words[1][0]).toUpperCase();
                                    } else if (words.length === 1) {
                                        initials = words[0].substring(0, 2).toUpperCase();
                                    }

                                    return (
                                        <button
                                            type="button"
                                            key={cId}
                                            onClick={() => handleSearchClient(cId)}
                                            className={claseItem(isSelected)}
                                        >
                                            <span className={`w-9 h-9 rounded-xl flex items-center justify-center text-xs font-black shrink-0 ${isSelected ? 'bg-brand-cyan text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                                                {initials}
                                            </span>
                                            <span className="flex-1 min-w-0">
                                                <span className={`block text-sm font-bold truncate ${isSelected ? 'text-brand-cyan' : 'text-zinc-800'}`} title={cName}>{cName}</span>
                                                <span className="block text-[11px] text-zinc-400 font-mono mt-0.5">
                                                    ID: {cId}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })
                            )}
                            {faltan > 0 && (
                                <div ref={centinela} className="py-3 text-center text-xs text-zinc-400 tabular-nums">
                                    Mostrando {cuantos.toLocaleString('es-UY')} de {filteredCustomers.length.toLocaleString('es-UY')}…
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col gap-0.5">
                            {profiles.map(p => {
                                const isSelected = selectedProfile === p.ID;
                                return (
                                    <button
                                        type="button"
                                        key={p.ID}
                                        onClick={() => handleSearchProfile(p.ID)}
                                        className={`${claseItem(isSelected)} items-start`}
                                    >
                                        <span className="flex-1 min-w-0">
                                            <span className={`flex items-center justify-between gap-2 text-sm font-bold ${isSelected ? 'text-brand-cyan' : 'text-zinc-800'}`}>
                                                <span className="truncate">{p.Nombre}</span>
                                                {p.EsGlobal && <span className="shrink-0" title="Perfil Global"><Globe size={15} className="text-brand-cyan" aria-label="Perfil Global" /></span>}
                                            </span>
                                            <span className="block text-xs text-zinc-400 line-clamp-2 mt-0.5">{p.Descripcion || 'Sin descripción'}</span>
                                        </span>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* RESULTS PANE */}
            <div className={`${CARD} flex-1 min-w-0 shrink-0 lg:shrink lg:h-full lg:overflow-y-auto custom-scrollbar relative p-4 sm:p-5`}>
                {loading && (
                    <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center rounded-2xl">
                        <Loader2 size={32} className="animate-spin text-brand-cyan" />
                    </div>
                )}

                {!clientReport && !profileReport && !loading && (
                    <div className="min-h-[260px] h-full flex flex-col items-center justify-center text-center px-4">
                        <ScanSearch size={40} className="mb-3 text-brand-cyan" />
                        <h3 className="text-sm font-bold text-zinc-700">Panel Analítico</h3>
                        <p className="text-xs text-zinc-400 mt-1">Selecciona un elemento en el panel izquierdo para desplegar el reporte.</p>
                    </div>
                )}

                {/* REPORTE CLIENTE */}
                {clientReport && (
                    <div className="animate-fade-in">
                        <div className="flex items-start gap-3 pb-4 mb-5 border-b border-zinc-100">
                            <UserCheck size={22} className="text-brand-cyan shrink-0 mt-1" />
                            <div className="min-w-0 flex-1">
                                <p className={ROTULO}>Análisis de Cliente</p>
                                <h3 className="text-lg sm:text-xl font-black text-zinc-900 leading-tight break-words mt-0.5">
                                    {clientReport.cliente?.IDCliente || clientReport.cliente?.Nombre}
                                </h3>
                                <p className="text-zinc-400 font-mono text-xs mt-1">ID Interno: {clientReport.cliente?.CliIdCliente}</p>
                            </div>
                        </div>

                        <div className="flex flex-col gap-7">
                            {/* Nivel 1: Excepciones */}
                            <div>
                                {tituloNivel(1, 'Excepciones Directas (Precios Especiales)', cuenta(clientReport.excepciones.length, 'precio', 'precios'))}
                                {clientReport.excepciones.length === 0 ? (
                                    vacioNivel('Este cliente no tiene precios fijos ni excepciones pisadas manualmente.')
                                ) : (
                                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-2">
                                        {clientReport.excepciones.map((ex, i) => (
                                            <div key={i} className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 min-w-0">
                                                <div className="font-mono font-bold text-sm text-zinc-800 truncate" title={ex.CodArticulo}>{ex.CodArticulo}</div>
                                                <div className="text-sm font-black tabular-nums text-brand-cyan mt-0.5">
                                                    {ex.TipoRegla === 'percentage' || ex.TipoRegla === 'percentage_discount' || ex.TipoRegla === 'percentage_surcharge' ?
                                                        `${ex.TipoRegla.includes('surcharge')?'+':'-'}${fmtPct(ex.Valor)}%` :
                                                        `${simbolo(ex)} ${fmtMonto(ex.Valor)}`
                                                    }
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Nivel 2: Perfiles Asignados */}
                            <div>
                                {tituloNivel(2, 'Perfiles y Convenios Aplicados', cuenta(clientReport.perfilesAsignados.length, 'perfil', 'perfiles'))}
                                {clientReport.perfilesAsignados.length === 0 ? (
                                    vacioNivel('El cliente no pertenece a ningún grupo de precios especial.')
                                ) : (
                                    <div className="flex flex-col gap-3">
                                        {clientReport.perfilesAsignados.map(p => {
                                            const rules = clientReport.reglasPerfiles.filter(r => r.PerfilID === p.ID);
                                            return (
                                                <div key={p.ID} className="rounded-xl border border-zinc-200 overflow-hidden">
                                                    <div className="bg-zinc-50 px-3 sm:px-4 py-2.5 border-b border-zinc-200 flex justify-between items-center gap-3">
                                                        <span className="flex items-center gap-2 min-w-0 font-bold text-sm text-zinc-800">
                                                            <Users size={16} className="text-brand-cyan shrink-0" />
                                                            <span className="min-w-0 break-words sm:truncate">{p.Nombre}</span>
                                                        </span>
                                                        <span className={`${CHIP} ${CHIP_CIAN} tabular-nums`}>{rules.length} reglas</span>
                                                    </div>
                                                    <div className="overflow-x-auto">
                                                        {(() => {
                                                            // Agrupar por producto (CodArticulo)
                                                            const grouped = {};
                                                            rules.forEach(r => {
                                                                const key = r.CodArticulo || r.CodGrupo || 'TOTAL';
                                                                if (!grouped[key]) grouped[key] = { rows: [], desc: r.Descripcion };
                                                                grouped[key].rows.push(r);
                                                            });
                                                            const products = Object.keys(grouped);
                                                            const hasQty = rules.some(r => r.CantidadMinima > 1);
                                                            if (hasQty) {
                                                                const allQtys = [...new Set(rules.map(r => r.CantidadMinima || 1))].sort((a,b)=>a-b);
                                                                if (!conTabla) {
                                                                    // Celular: una tarjeta por producto con sus escalas
                                                                    return (
                                                                        <div className="p-3 flex flex-col gap-2">
                                                                            {products.map(prod => {
                                                                                const g = grouped[prod];
                                                                                return (
                                                                                    <div key={prod} className="rounded-xl border border-zinc-200 bg-white p-3">
                                                                                        <div className="font-bold text-sm text-zinc-800 break-words">{prod}</div>
                                                                                        {g.desc && g.desc !== prod && <div className="text-[11px] text-zinc-400 mt-0.5">{g.desc}</div>}
                                                                                        <div className="grid grid-cols-3 gap-1.5 mt-2">
                                                                                            {allQtys.map(q => {
                                                                                                const match = g.rows.find(r => (r.CantidadMinima || 1) === q);
                                                                                                return (
                                                                                                    <div key={q} className="rounded-lg bg-zinc-50 px-2 py-1.5 min-w-0">
                                                                                                        <div className="text-[10px] font-bold text-zinc-400 whitespace-nowrap">≥ {q} u.</div>
                                                                                                        {match ? (
                                                                                                            <div className={`text-xs font-mono font-bold tabular-nums truncate ${match.TipoRegla.includes('percent') ? 'text-brand-cyan' : 'text-zinc-800'}`}>
                                                                                                                {valorRegla(match)}
                                                                                                            </div>
                                                                                                        ) : <div className="text-xs text-zinc-300">—</div>}
                                                                                                    </div>
                                                                                                );
                                                                                            })}
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    );
                                                                }
                                                                return (
                                                                    <table className="w-full text-xs">
                                                                        <thead className="bg-white border-b border-zinc-200">
                                                                            <tr>
                                                                                <th className={`${TH} text-left min-w-[200px]`}>Producto / Grupo</th>
                                                                                {allQtys.map(q => (
                                                                                    <th key={q} className={`${TH} text-right min-w-[70px]`}>≥ {q} u.</th>
                                                                                ))}
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-zinc-100">
                                                                            {products.map(prod => {
                                                                                const g = grouped[prod];
                                                                                return (
                                                                                    <tr key={prod} className="hover:bg-zinc-50">
                                                                                        <td className="px-3 py-2">
                                                                                            <div className="font-bold text-zinc-800">{prod}</div>
                                                                                            {g.desc && g.desc !== prod && <div className="text-[10px] text-zinc-400 mt-0.5">{g.desc}</div>}
                                                                                        </td>
                                                                                        {allQtys.map(q => {
                                                                                            const match = g.rows.find(r => (r.CantidadMinima || 1) === q);
                                                                                            return (
                                                                                                <td key={q} className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                                                                                                    {match ? (
                                                                                                        <span className={`font-bold ${match.TipoRegla.includes('percent') ? 'text-brand-cyan' : 'text-zinc-800'}`}>
                                                                                                            {valorRegla(match)}
                                                                                                        </span>
                                                                                                    ) : <span className="text-zinc-300">—</span>}
                                                                                                </td>
                                                                                            );
                                                                                        })}
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                );
                                                            }
                                                            // Sin cantidades: vista simple de chips
                                                            return (
                                                                <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2 empty:hidden">
                                                                    {rules.map((r, i) => (
                                                                        <div key={i} className="text-xs bg-white border border-zinc-200 rounded-lg px-2.5 py-1.5 flex justify-between items-center gap-2 min-w-0">
                                                                            <span className="font-bold text-zinc-700 truncate" title={r.CodArticulo}>{r.CodArticulo || <span className="text-zinc-300">—</span>}</span>
                                                                            <span className="font-mono font-bold tabular-nums text-brand-cyan shrink-0">
                                                                                {valorRegla(r)}
                                                                            </span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Nivel 3: Globales (más apagados: es la base que aplica a todos) */}
                            <div>
                                {tituloNivel(3, 'Políticas Globales Base', cuenta(clientReport.perfilesGlobales.length, 'perfil', 'perfiles'))}
                                {clientReport.perfilesGlobales.length === 0 ? (
                                    vacioNivel('No hay perfiles globales activos en la red.')
                                ) : (
                                    <div className="flex flex-col gap-3">
                                        {clientReport.perfilesGlobales.map(p => {
                                            const rules = clientReport.reglasGlobales.filter(r => r.PerfilID === p.ID);
                                            return (
                                                <div key={p.ID} className="rounded-xl border border-zinc-200 bg-zinc-50/60 overflow-hidden">
                                                    <div className="bg-zinc-50 px-3 sm:px-4 py-2.5 border-b border-zinc-200 flex justify-between items-center gap-3">
                                                        <span className="flex items-center gap-2 min-w-0 font-bold text-sm text-zinc-600">
                                                            <Globe size={15} className="text-brand-cyan shrink-0" />
                                                            <span className="min-w-0 break-words sm:truncate">{p.Nombre}</span>
                                                        </span>
                                                        <span className={`${CHIP} ${CHIP_GRIS} tabular-nums`}>{rules.length} items</span>
                                                    </div>
                                                    <div className="overflow-x-auto">
                                                        {(() => {
                                                            const grouped = {};
                                                            rules.forEach(r => {
                                                                const key = r.CodArticulo || r.CodGrupo || 'TOTAL';
                                                                if (!grouped[key]) grouped[key] = { rows: [], desc: r.Descripcion };
                                                                grouped[key].rows.push(r);
                                                            });
                                                            const products = Object.keys(grouped);
                                                            const hasQty = rules.some(r => r.CantidadMinima > 1);
                                                            if (hasQty) {
                                                                const allQtys = [...new Set(rules.map(r => r.CantidadMinima || 1))].sort((a,b)=>a-b);
                                                                if (!conTabla) {
                                                                    // Celular: una tarjeta por producto con sus escalas
                                                                    return (
                                                                        <div className="p-2.5 flex flex-col gap-2">
                                                                            {products.map(prod => {
                                                                                const g = grouped[prod];
                                                                                return (
                                                                                    <div key={prod} className="rounded-xl border border-zinc-200 bg-white p-3">
                                                                                        <div className="font-bold text-sm text-zinc-700 break-words">{prod}</div>
                                                                                        {g.desc && g.desc !== prod && <div className="text-[11px] text-zinc-400 mt-0.5">{g.desc}</div>}
                                                                                        <div className="grid grid-cols-3 gap-1.5 mt-2">
                                                                                            {allQtys.map(q => {
                                                                                                const match = g.rows.find(r => (r.CantidadMinima || 1) === q);
                                                                                                return (
                                                                                                    <div key={q} className="rounded-lg bg-zinc-50 px-2 py-1.5 min-w-0">
                                                                                                        <div className="text-[10px] font-bold text-zinc-400 whitespace-nowrap">≥ {q}</div>
                                                                                                        {match ? (
                                                                                                            <div className="text-xs font-mono font-bold tabular-nums truncate text-zinc-700">
                                                                                                                {valorRegla(match)}
                                                                                                            </div>
                                                                                                        ) : <div className="text-xs text-zinc-300">—</div>}
                                                                                                    </div>
                                                                                                );
                                                                                            })}
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    );
                                                                }
                                                                return (
                                                                    <table className="w-full text-[11px] bg-white">
                                                                        <thead className="border-b border-zinc-200">
                                                                            <tr>
                                                                                <th className={`${TH} text-left min-w-[180px]`}>Producto</th>
                                                                                {allQtys.map(q => (
                                                                                    <th key={q} className={`${TH} text-right min-w-[60px]`}>≥ {q}</th>
                                                                                ))}
                                                                            </tr>
                                                                        </thead>
                                                                        <tbody className="divide-y divide-zinc-100">
                                                                            {products.map(prod => {
                                                                                const g = grouped[prod];
                                                                                return (
                                                                                    <tr key={prod} className="hover:bg-zinc-50">
                                                                                        <td className="px-3 py-2">
                                                                                            <div className="font-bold text-zinc-700">{prod}</div>
                                                                                            {g.desc && g.desc !== prod && <div className="text-[10px] text-zinc-400 mt-0.5">{g.desc}</div>}
                                                                                        </td>
                                                                                        {allQtys.map(q => {
                                                                                            const match = g.rows.find(r => (r.CantidadMinima || 1) === q);
                                                                                            return (
                                                                                                <td key={q} className="px-3 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                                                                                                    {match ? (
                                                                                                        <span className="font-bold text-zinc-700">
                                                                                                            {valorRegla(match)}
                                                                                                        </span>
                                                                                                    ) : <span className="text-zinc-300">—</span>}
                                                                                                </td>
                                                                                            );
                                                                                        })}
                                                                                    </tr>
                                                                                );
                                                                            })}
                                                                        </tbody>
                                                                    </table>
                                                                );
                                                            }
                                                            return (
                                                                <div className="p-2.5 flex flex-wrap gap-1.5 empty:hidden">
                                                                    {rules.map((r, i) => (
                                                                        <span key={i} className="text-[11px] bg-white border border-zinc-200 rounded-lg px-2 py-0.5 font-mono text-zinc-500">
                                                                            {r.CodArticulo || '—'}: <span className="font-bold text-zinc-700 tabular-nums">{valorRegla(r)}</span>
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            );
                                                        })()}
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* REPORTE PERFIL */}
                {profileReport && (
                    <div className="animate-fade-in h-full flex flex-col">
                        <div className="flex flex-wrap items-start gap-3 pb-4 mb-5 border-b border-zinc-100">
                            <Users size={22} className="text-brand-cyan shrink-0 mt-1" />
                            <div className="min-w-[200px] flex-1">
                                <p className={ROTULO}>Perfil</p>
                                <h3 className="text-lg sm:text-xl font-black text-zinc-900 leading-tight break-words mt-0.5">
                                    {profileReport.profile?.Nombre}
                                </h3>
                                <p className="text-zinc-400 text-xs mt-1">{profileReport.clients.length} clientes asimilados registrados (exclusivo clientes en BDD).</p>
                            </div>
                            {profileReport.profile?.EsGlobal && (
                                <span className={`${CHIP} ${CHIP_CIAN}`}>
                                    <Globe size={13} /> PERFIL GLOBAL (Afecta a todos)
                                </span>
                            )}
                        </div>

                        <div className="flex-1">
                            {profileReport.clients.length === 0 ? (
                                <div className="flex flex-col items-center justify-center text-center px-4 py-12 border border-dashed border-zinc-200 rounded-2xl">
                                    <UserX size={40} className="mb-3 text-brand-cyan" />
                                    <p className="text-sm font-bold text-zinc-700">Ningún cliente tiene asignado este perfil de manera cruzada explícita.</p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                                    {profileReport.clients.map(c => (
                                        <div key={c.CliIdCliente} className="rounded-xl border border-zinc-200 bg-white p-3 hover:border-brand-cyan/40 transition-colors min-w-0">
                                            <div className="font-bold text-zinc-800 text-sm mb-2 truncate" title={c.Nombre || c.NombreFantasia}>
                                                {c.Nombre || c.NombreFantasia || 'Desconocido'}
                                            </div>
                                            <div className="flex flex-wrap gap-1.5 text-[11px] font-mono">
                                                <span className="bg-brand-cyan/10 text-brand-cyan border border-brand-cyan/20 px-2 py-0.5 rounded-lg" title="IDCliente (código sistema)">
                                                    IDCliente: {c.IDCliente || '—'}
                                                </span>
                                                <span className="bg-zinc-100 text-zinc-600 border border-zinc-200 px-2 py-0.5 rounded-lg" title="CliIdCliente (ID interno)">
                                                    CliIdCliente: {c.CliIdCliente}
                                                </span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default PriceReports;
