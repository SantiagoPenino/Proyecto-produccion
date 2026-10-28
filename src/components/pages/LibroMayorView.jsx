import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/apiClient';
import { BookOpen, Calendar, DollarSign, Search, Loader2, X, Filter, ChevronDown, ChevronUp, AlertTriangle } from 'lucide-react';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAGE_SIZE = 50;

// Estética nueva (28/10/2026): encabezado con ícono brand-cyan sin fondo, tarjetas blancas con borde, filtros con
// Selector/SelectorFecha (antes el calendario del navegador, en mm/dd/yyyy), naranja e índigo → brand-cyan, montos en
// negro (el color queda para el descuadre), «$»/«US$» en vez de UYU/USD, horas de 24 h y la ventana de la OP en z-[6000].
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const CAMPO = 'w-full pl-9 pr-9 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
const ROTULO = 'text-[10px] font-black uppercase tracking-widest text-zinc-400';
const CHIP = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide whitespace-nowrap';
const TH = 'px-4 py-3 text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';

const fechaHora = (f) => {
  const d = new Date(f);
  return `${d.toLocaleDateString('es-UY')} ${d.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
};
// En pantalla, «$» y «US$» (la base guarda U$S en algunas monedas)
const simbolo = (s) => (s === 'U$S' || s === 'USD' ? 'US$' : (s || '$'));

export default function LibroMayorView() {
  const [asientos, setAsientos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cargandoMas, setCargandoMas] = useState(false);
  const [selectedOP, setSelectedOP] = useState(null);

  // Resumen de TODO el filtro (lo calcula el servidor; no es lo que hay en pantalla)
  const [total, setTotal] = useState(0);
  const [hayMas, setHayMas] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [totalDebeFiltro, setTotalDebeFiltro] = useState(0);
  const [totalHaberFiltro, setTotalHaberFiltro] = useState(0);

  // Filtros
  const [searchTerm, setSearchTerm] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [filtroConcepto, setFiltroConcepto] = useState('');
  const [origenes, setOrigenes] = useState([]);

  // Filtros ya aplicados contra el servidor. Las fechas se aplican con el botón
  // FILTRAR; la búsqueda y el origen se aplican solos.
  const [aplicado, setAplicado] = useState({ desde: '', hasta: '', origen: '', q: '' });

  const [expandedIds, setExpandedIds] = useState(new Set());
  const [lineasPorAsiento, setLineasPorAsiento] = useState({});
  const [cargandoLineas, setCargandoLineas] = useState(null);

  // Candado: si el usuario cambia de filtro mientras una página viene en camino,
  // esa respuesta vieja se descarta en vez de mezclarse con la lista nueva.
  const pedidoVigente = useRef(0);

  const cargarPagina = (f, page) => {
    const esPrimera = page === 1;
    const miPedido = ++pedidoVigente.current;
    esPrimera ? setLoading(true) : setCargandoMas(true);

    const params = new URLSearchParams();
    if (f.desde)  params.append('desde',  f.desde);
    if (f.hasta)  params.append('hasta',  f.hasta);
    if (f.origen) params.append('origen', f.origen);
    if (f.q)      params.append('q',      f.q);
    params.append('page', page);
    params.append('pageSize', PAGE_SIZE);

    api.get(`/contabilidad/erp/libro-mayor?${params}`).then(res => {
      if (miPedido !== pedidoVigente.current) return; // llegó tarde: ya hay otro filtro
      if (res.data.success) {
        setAsientos(prev => esPrimera ? res.data.data : [...prev, ...res.data.data]);
        setTotal(res.data.total || 0);
        setHayMas(!!res.data.hayMas);
        setTotalDebeFiltro(res.data.totalDebeFiltro || 0);
        setTotalHaberFiltro(res.data.totalHaberFiltro || 0);
        setPagina(page);
      }
      setLoading(false); setCargandoMas(false);
    }).catch(() => { setLoading(false); setCargandoMas(false); });
  };

  // Búsqueda: 400 ms de respiro para no pegarle al servidor en cada tecla
  useEffect(() => {
    const t = setTimeout(() => {
      setAplicado(a => a.q === searchTerm.trim() ? a : { ...a, q: searchTerm.trim() });
    }, 400);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // El origen se aplica solo, sin apretar FILTRAR
  useEffect(() => {
    setAplicado(a => a.origen === filtroConcepto ? a : { ...a, origen: filtroConcepto });
  }, [filtroConcepto]);

  // Cualquier cambio de filtro vuelve a la primera página
  useEffect(() => {
    setExpandedIds(new Set());
    cargarPagina(aplicado, 1);
  }, [aplicado]);

  // Combo de orígenes: sale de la base, no de recorrer los asientos cargados
  useEffect(() => {
    api.get('/contabilidad/erp/libro-mayor/origenes')
      .then(res => { if (res.data?.success) setOrigenes(res.data.data.map(o => o.Origen)); })
      .catch(() => {});
  }, []);

  const handleViewOP = async (tcaId) => {
    try {
      const res = await api.get(`/contabilidad/caja/transaccion/${tcaId}`);
      if (res.data?.success && res.data?.data) setSelectedOP(res.data.data);
    } catch (err) { console.error(err); }
  };

  // El detalle del asiento se pide recién al expandirlo, y queda cacheado
  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

    if (!lineasPorAsiento[id]) {
      setCargandoLineas(id);
      api.get(`/contabilidad/erp/libro-mayor/${id}/lineas`)
        .then(res => {
          if (res.data?.success) setLineasPorAsiento(prev => ({ ...prev, [id]: res.data.data }));
        })
        .catch(() => {})
        .finally(() => setCargandoLineas(c => (c === id ? null : c)));
    }
  };

  const limpiarFiltros = () => {
    setSearchTerm('');
    setFechaDesde('');
    setFechaHasta('');
    setFiltroConcepto('');
    setAplicado({ desde: '', hasta: '', origen: '', q: '' });
  };

  const aplicarFiltroFechas = () => setAplicado(a => ({ ...a, desde: fechaDesde, hasta: fechaHasta }));

  const hayFiltros = searchTerm || fechaDesde || fechaHasta || filtroConcepto;

  return (
    <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">

        {/* ENCABEZADO */}
        <div className="flex flex-wrap items-center gap-3">
          <BookOpen size={30} className="text-brand-cyan shrink-0" />
          <div className="min-w-[220px] flex-1">
            <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Libro Diario / Mayor</h1>
            <p className="text-sm text-zinc-500 mt-1">
              Auditoría contable bimonetaria · mostrando <b className="text-zinc-700">{asientos.length.toLocaleString('es-UY')}</b> de <b className="text-zinc-700">{total.toLocaleString('es-UY')}</b> asientos
            </p>
          </div>
          {/* Total cuadre — de TODOS los asientos del filtro, no sólo de los mostrados */}
          {total > 0 && (
            <div className={`${CARD} px-4 py-2.5 w-full sm:w-auto sm:ml-auto sm:text-right`}>
              <p className={ROTULO}>Total debe / haber ($) · los {total.toLocaleString('es-UY')} asientos del filtro</p>
              <p className="text-lg sm:text-xl font-black text-zinc-900 font-mono tabular-nums mt-0.5">
                <span className="whitespace-nowrap">$ {fmt(totalDebeFiltro)}</span> / <span className="whitespace-nowrap">$ {fmt(totalHaberFiltro)}</span>
              </p>
            </div>
          )}
        </div>

        {/* BARRA DE BÚSQUEDA Y FILTROS */}
        <div className={`${CARD} p-4 grid grid-cols-2 gap-3 lg:flex lg:flex-wrap lg:items-end`}>

          {/* Búsqueda libre */}
          <div className="min-w-0 col-span-2 lg:flex-1 lg:min-w-[240px]">
            <span className={ETIQUETA}><Search size={12} className="text-brand-cyan" /> Buscar asiento</span>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" size={15} />
              <input
                type="text"
                placeholder="Concepto, cuenta, N° asiento u OP..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                aria-label="Buscar asiento"
                className={CAMPO}
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} title="Borrar la búsqueda" aria-label="Borrar la búsqueda"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100">
                  <X size={14}/>
                </button>
              )}
            </div>
          </div>

          {/* Desde */}
          <div className="min-w-0 lg:w-40">
            <span className={ETIQUETA}><Calendar size={12} className="text-brand-cyan" /> Desde</span>
            <SelectorFecha filtro vaciable className="w-full" value={fechaDesde} placeholder="Desde" aria-label="Fecha desde"
              onChange={e => setFechaDesde(e.target.value)} />
          </div>

          {/* Hasta */}
          <div className="min-w-0 lg:w-40">
            <span className={ETIQUETA}>Hasta</span>
            <SelectorFecha filtro vaciable className="w-full" value={fechaHasta} placeholder="Hasta" aria-label="Fecha hasta"
              onChange={e => setFechaHasta(e.target.value)} />
          </div>

          {/* Tipo de asiento */}
          <div className="min-w-0 col-span-2 lg:col-span-1 lg:w-52">
            <span className={ETIQUETA}><Filter size={12} className="text-brand-cyan" /> Origen</span>
            <Selector filtro className="w-full" value={filtroConcepto} aria-label="Origen"
              onChange={e => setFiltroConcepto(e.target.value)}>
              <option value="">Todos los orígenes</option>
              {origenes.map(t => <option key={t} value={t}>{t}</option>)}
            </Selector>
          </div>

          {/* Botón Filtrar — aplica SOLO el rango de fechas; la búsqueda y el origen se aplican solos */}
          <button
            onClick={aplicarFiltroFechas}
            title="Aplica el rango de fechas. La búsqueda y el origen se aplican solos, sin apretar este botón."
            className={`${BTN_PRINCIPAL} ${hayFiltros ? '' : 'col-span-2'} lg:col-span-1`}
          >
            <Search size={15}/> Filtrar por fecha
          </button>

          {/* Limpiar */}
          {hayFiltros && (
            <button onClick={limpiarFiltros} className={BTN_SECUNDARIO}>
              <X size={15} className="text-zinc-400"/> Limpiar
            </button>
          )}
        </div>

        {/* LISTA DE ASIENTOS */}
        {loading ? (
          <div className={`${CARD} py-16 text-center flex flex-col items-center gap-3`}>
            <Loader2 className="animate-spin text-brand-cyan" size={32}/>
            <p className="text-sm text-zinc-400">Cargando el libro mayor...</p>
          </div>
        ) : asientos.length === 0 ? (
          <div className={`${CARD} py-16 px-4 text-center flex flex-col items-center gap-2`}>
            <BookOpen size={40} className="text-brand-cyan"/>
            <p className="text-sm font-bold text-zinc-700">Sin resultados para los filtros aplicados</p>
            <p className="text-xs text-zinc-400">Probá con otro rango de fechas, otro origen o menos palabras.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {asientos.map(asi => {
              const isOpen = expandedIds.has(asi.AsiId);
              // Los totales vienen sumados del servidor: la tarjeta cerrada no
              // necesita las líneas, y así no hay que traerlas para todo el libro.
              const totalDebe = Number(asi.TotalDebe || 0);
              const totalHaber = Number(asi.TotalHaber || 0);
              const cuadra = Math.abs(totalDebe - totalHaber) < 0.01;
              const lineas = lineasPorAsiento[asi.AsiId];
              return (
                <div key={asi.AsiId} className={`${CARD} overflow-hidden transition-colors ${isOpen ? 'border-zinc-300' : 'hover:border-zinc-300'}`}>

                  {/* CABECERA — siempre visible, clickeable para expandir */}
                  <div
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 sm:px-5 py-3.5 cursor-pointer select-none hover:bg-zinc-50 transition-colors"
                    onClick={() => toggleExpand(asi.AsiId)}
                  >
                    <div className="flex items-start gap-3 min-w-0 flex-1 basis-[280px]">
                      <span className="shrink-0 font-mono text-xs font-bold text-zinc-600 bg-zinc-50 border border-zinc-200 px-2 py-0.5 rounded-lg mt-0.5">#{asi.AsiId}</span>
                      <div className="min-w-0">
                        <p className="font-bold text-zinc-900 text-sm sm:text-base leading-snug">{asi.AsiConcepto}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs text-zinc-500">
                          <span className="inline-flex items-center gap-1.5"><Calendar size={13} className="text-brand-cyan"/> {fechaHora(asi.AsiFecha)}</span>
                          {asi.AsiOrigen && <span className={`${CHIP} bg-zinc-50 text-zinc-500 border-zinc-200`}>{asi.AsiOrigen}</span>}
                          {asi.TcaIdTransaccion && (
                            <button
                              onClick={e => { e.stopPropagation(); handleViewOP(asi.TcaIdTransaccion); }}
                              className={`${CHIP} bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20 hover:bg-brand-cyan hover:text-white transition-colors`}
                            >
                              Ver OP #{asi.TcaIdTransaccion}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 ml-auto">
                      <div className="text-right">
                        <p className={ROTULO}>Debe / Haber ($)</p>
                        <p className={`font-bold font-mono text-sm sm:text-base tabular-nums ${cuadra ? 'text-zinc-900' : 'text-brand-magenta'}`}>
                          <span className="whitespace-nowrap">$ {fmt(totalDebe)}</span> / <span className="whitespace-nowrap">$ {fmt(totalHaber)}</span>
                        </p>
                        {!cuadra && (
                          <span className={`${CHIP} mt-1 bg-brand-magenta/10 text-brand-magenta border-brand-magenta/20`}>
                            <AlertTriangle size={11}/> Descuadre
                          </span>
                        )}
                      </div>
                      <div className={`p-1.5 rounded-lg transition-colors ${isOpen ? 'bg-brand-cyan/10 text-brand-cyan' : 'bg-zinc-100 text-zinc-400'}`}>
                        {isOpen ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}
                      </div>
                    </div>
                  </div>

                  {/* DETALLE — sólo visible cuando está expandido */}
                  {isOpen && !lineas && (
                    <div className="border-t border-zinc-100 bg-zinc-50/60 px-5 py-6 flex items-center justify-center gap-2.5">
                      {cargandoLineas === asi.AsiId && <Loader2 className="animate-spin text-brand-cyan" size={18}/>}
                      <span className="text-sm text-zinc-400">
                        {cargandoLineas === asi.AsiId ? 'Cargando el detalle del asiento...' : 'No se pudo traer el detalle de este asiento'}
                      </span>
                    </div>
                  )}

                  {isOpen && lineas && (
                    <div className="border-t border-zinc-100 bg-zinc-50/60 px-4 sm:px-5 pb-4 pt-3 overflow-x-auto">
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-6 gap-y-2 text-sm min-w-[560px]">
                        <div className={`${ROTULO} border-b border-zinc-200 pb-2`}>Cuenta contable</div>
                        <div className={`${ROTULO} border-b border-zinc-200 pb-2 text-right`}>Monto original</div>
                        <div className={`${ROTULO} border-b border-zinc-200 pb-2 text-right w-32`}>Debe ($)</div>
                        <div className={`${ROTULO} border-b border-zinc-200 pb-2 text-right w-32`}>Haber ($)</div>

                        {lineas.map((l, i) => (
                          <React.Fragment key={i}>
                            <div className="flex items-center gap-2.5 py-0.5 min-w-0">
                              <span className="shrink-0 font-mono text-[11px] font-bold text-zinc-600 bg-white border border-zinc-200 px-1.5 py-0.5 rounded-md">{l.CueCodigo}</span>
                              <span className="font-semibold text-zinc-800 truncate">{l.CueNombre}</span>
                            </div>
                            <div className="text-right text-zinc-500 font-mono text-sm py-0.5 flex justify-end items-center tabular-nums">
                              {l.MonedaId === 2
                                ? <span className="text-brand-cyan bg-brand-cyan/10 px-1.5 rounded-md font-bold">US$ {fmt(l.ImporteOriginal)}</span>
                                : <span>$ {fmt(l.ImporteOriginal)}</span>
                              }
                            </div>
                            <div className={`text-right font-bold font-mono py-0.5 tabular-nums ${l.DebeUYU > 0 ? 'text-zinc-900' : 'text-zinc-300'}`}>
                              {l.DebeUYU > 0 ? `$ ${fmt(l.DebeUYU)}` : '-'}
                            </div>
                            <div className={`text-right font-bold font-mono py-0.5 tabular-nums ${l.HaberUYU > 0 ? 'text-zinc-900' : 'text-zinc-300'}`}>
                              {l.HaberUYU > 0 ? `$ ${fmt(l.HaberUYU)}` : '-'}
                            </div>
                          </React.Fragment>
                        ))}

                        {/* TOTALES */}
                        <div className={`${ROTULO} col-span-2 text-right pt-3 mt-1 border-t border-zinc-300`}>Total del asiento ($)</div>
                        <div className={`text-right pt-3 mt-1 border-t border-zinc-300 font-black font-mono tabular-nums ${cuadra ? 'text-zinc-900' : 'text-brand-magenta'}`}>$ {fmt(totalDebe)}</div>
                        <div className={`text-right pt-3 mt-1 border-t border-zinc-300 font-black font-mono tabular-nums ${cuadra ? 'text-zinc-900' : 'text-brand-magenta'}`}>$ {fmt(totalHaber)}</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* PAGINADO — la pantalla arranca con los 50 asientos más nuevos */}
            {hayMas ? (
              <button
                onClick={() => cargarPagina(aplicado, pagina + 1)}
                disabled={cargandoMas}
                className={`${BTN_SECUNDARIO} self-center mt-1 mb-2 px-5`}
              >
                {cargandoMas
                  ? <><Loader2 className="animate-spin text-brand-cyan" size={15}/> Cargando...</>
                  : <>Cargar {Math.min(PAGE_SIZE, total - asientos.length)} asientos más (quedan {(total - asientos.length).toLocaleString('es-UY')})</>}
              </button>
            ) : (
              <p className={`${ROTULO} self-center mt-1 mb-2`}>
                Fin del listado · {total.toLocaleString('es-UY')} asientos
              </p>
            )}
          </div>
        )}

      {/* Modal OP */}
      {selectedOP && (
        <div className="fixed inset-0 z-[6000] flex items-center justify-center bg-black/40 p-4" onClick={e => e.target === e.currentTarget && setSelectedOP(null)}>
          <div className="bg-white border border-zinc-200 rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-xl overflow-hidden">
            <div className="px-5 sm:px-6 py-4 border-b border-zinc-100 flex justify-between items-center gap-3">
              <h2 className="text-lg font-black text-zinc-900 flex items-center gap-2.5 min-w-0">
                <BookOpen size={22} className="text-brand-cyan shrink-0"/>
                <span className="truncate">Transacción de caja <span className="font-mono text-brand-cyan">#{selectedOP.TcaIdTransaccion}</span></span>
              </h2>
              <button onClick={() => setSelectedOP(null)} title="Cerrar" aria-label="Cerrar" className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors"><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-auto p-5 sm:p-6 flex flex-col gap-6">
              <div className="flex flex-wrap justify-between items-end gap-4 pb-5 border-b border-zinc-100">
                <div className="min-w-0">
                  <h3 className={`${ROTULO} mb-1`}>Cliente vinculado</h3>
                  <p className="text-xl font-black text-zinc-900">{selectedOP.NombreCliente}</p>
                  <p className="text-xs text-zinc-500 mt-1.5 flex items-center gap-1.5"><Calendar size={13} className="text-brand-cyan"/> {new Date(selectedOP.TcaFecha).toLocaleString('es-UY', { hourCycle: 'h23' })}</p>
                </div>
                <div className="text-right">
                  <h3 className={`${ROTULO} mb-1`}>Total cobrado ($)</h3>
                  <p className="text-3xl font-black text-zinc-900 font-mono tabular-nums">$ {fmt(selectedOP.TcaTotalCobrado)}</p>
                </div>
              </div>

              {selectedOP.detalle?.length > 0 && (
                <div>
                  <h4 className={`${ROTULO} mb-2`}>Comprobantes aplicados</h4>
                  <div className="border border-zinc-200 rounded-xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm text-zinc-700">
                        <thead className="bg-zinc-50 border-b border-zinc-200">
                          <tr><th className={`${TH} text-left`}>Referencia</th><th className={`${TH} text-left`}>Ref ID</th><th className={`${TH} text-right`}>Monto original</th><th className={`${TH} text-right`}>Ajuste</th><th className={`${TH} text-right`}>Final</th></tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {selectedOP.detalle.map((d, i) => {
                            // Los importes del comprobante van en la moneda de la orden (antes siempre «$»,
                            // aunque fuera en dólares: la OP 22563 mostraba «$ 63,58» por US$ 63,58)
                            const s = simbolo(d.RefMonedaSimbolo);
                            return (
                            <tr key={i} className="hover:bg-zinc-50 transition-colors">
                              <td className="px-4 py-3 font-semibold text-zinc-800">{d.TdeCodigoReferencia || '-'}</td>
                              <td className="px-4 py-3 font-mono text-zinc-500">{d.TdeReferenciaId}</td>
                              <td className="px-4 py-3 text-right font-mono text-zinc-400 tabular-nums whitespace-nowrap">{s} {fmt(d.TdeImporteOriginal)}</td>
                              <td className="px-4 py-3 text-right font-mono font-bold text-amber-600 tabular-nums whitespace-nowrap">{d.TdeAjuste !== 0 ? `${s} ${fmt(d.TdeAjuste)}` : '-'}</td>
                              <td className="px-4 py-3 text-right font-mono font-black text-zinc-900 tabular-nums whitespace-nowrap">{s} {fmt(d.TdeImporteFinal)}</td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {selectedOP.pagos?.length > 0 && (
                <div>
                  <h4 className={`${ROTULO} mb-2`}>Métodos de pago</h4>
                  <div className="flex flex-col gap-2">
                    {selectedOP.pagos.map((p, i) => (
                      <div key={i} className="flex flex-wrap justify-between items-center gap-3 border border-zinc-200 rounded-xl px-4 py-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <DollarSign size={18} className="text-brand-cyan shrink-0"/>
                          <span className="font-bold text-zinc-800">{p.MPaDescripcionMetodo}</span>
                        </div>
                        <div className="flex items-center gap-3 ml-auto">
                          {p.PagCotizacion && p.PagCotizacion !== 1 && (
                            <span className={`${CHIP} bg-zinc-50 text-zinc-500 border-zinc-200`}>TC x{fmt(p.PagCotizacion)}</span>
                          )}
                          <span className="font-black text-zinc-900 font-mono text-lg tabular-nums">{simbolo(p.MonSimbolo)} {fmt(p.PagMontoPago)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
