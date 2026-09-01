import React, { useState, useEffect, useRef } from 'react';
import api from '../../services/apiClient';
import { BookOpen, Calendar, DollarSign, Search, Loader2, X, Filter, ChevronDown, ChevronUp } from 'lucide-react';

const fmt = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const PAGE_SIZE = 50;

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
    <div className="h-full bg-[#f1f5f9] p-8 overflow-y-auto font-sans text-slate-800">
      <div className="max-w-6xl mx-auto flex flex-col gap-6">

        {/* ENCABEZADO */}
        <div className="flex justify-between items-start bg-white p-8 rounded-[2rem] shadow-sm border border-slate-200">
          <div>
            <h1 className="text-3xl font-black text-slate-800 flex items-center gap-4 tracking-tight">
              <BookOpen className="text-amber-500" size={36} /> Libro Diario / Mayor
            </h1>
            <p className="text-slate-500 font-bold uppercase tracking-widest text-[10px] mt-2">Auditoría contable bimonetaria · Mostrando <span className="text-indigo-600">{asientos.length}</span> de {total} asientos</p>
          </div>
          {/* Total cuadre — de TODOS los asientos del filtro, no sólo de los mostrados */}
          {total > 0 && (
            <div className="text-right bg-slate-50 border border-slate-100 rounded-2xl px-6 py-4 shadow-inner">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Total Debe / Haber (UYU) · los {total} asientos del filtro</p>
              <p className="text-2xl font-black text-emerald-600 font-mono tracking-tighter">
                $ {fmt(totalDebeFiltro)} / $ {fmt(totalHaberFiltro)}
              </p>
            </div>
          )}
        </div>

        {/* BARRA DE BÚSQUEDA Y FILTROS */}
        <div className="bg-white border border-slate-200 shadow-sm rounded-[2rem] p-6 flex flex-wrap gap-4 items-end">

          {/* Búsqueda libre */}
          <div className="flex-1 min-w-[200px] flex flex-col gap-2">
            <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest flex items-center gap-1 px-1"><Search size={14} className="text-indigo-400"/> Buscar Asiento</label>
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Concepto, cuenta, N° asiento u OP..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full bg-slate-50/50 border-2 border-slate-100 pl-12 pr-4 py-3 rounded-2xl text-slate-800 font-bold text-sm outline-none focus:border-amber-500 focus:bg-white shadow-inner transition-all"
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 bg-white shadow-sm p-1 rounded-lg border border-slate-200">
                  <X size={14}/>
                </button>
              )}
            </div>
          </div>

          {/* Desde */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest flex items-center gap-1 px-1"><Calendar size={14} className="text-indigo-400"/> Desde</label>
            <input
              type="date"
              value={fechaDesde}
              onChange={e => setFechaDesde(e.target.value)}
              className="bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-4 py-3 font-bold text-sm text-slate-800 outline-none focus:border-amber-500 focus:bg-white shadow-inner transition-all"
            />
          </div>

          {/* Hasta */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest px-1">Hasta</label>
            <input
              type="date"
              value={fechaHasta}
              onChange={e => setFechaHasta(e.target.value)}
              className="bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-4 py-3 font-bold text-sm text-slate-800 outline-none focus:border-amber-500 focus:bg-white shadow-inner transition-all"
            />
          </div>

          {/* Tipo de asiento */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase font-black text-slate-400 tracking-widest flex items-center gap-1 px-1"><Filter size={14} className="text-indigo-400"/> Origen</label>
            <select
              value={filtroConcepto}
              onChange={e => setFiltroConcepto(e.target.value)}
              className="bg-slate-50/50 border-2 border-slate-100 rounded-2xl px-4 py-3 font-bold text-sm text-slate-800 outline-none focus:border-amber-500 focus:bg-white shadow-inner transition-all cursor-pointer"
            >
              <option value="">Todos los orígenes</option>
              {origenes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          {/* Botón Filtrar — aplica SOLO el rango de fechas; la búsqueda y el origen se aplican solos */}
          <button
            onClick={aplicarFiltroFechas}
            title="Aplica el rango de fechas. La búsqueda y el origen se aplican solos, sin apretar este botón."
            className="flex items-center gap-2 px-8 py-3 rounded-2xl bg-amber-500 hover:bg-black text-white text-sm font-black transition-all self-end shadow-xl hover:shadow-2xl hover:-translate-y-0.5 active:scale-95"
          >
            <Search size={18}/> FILTRAR POR FECHA
          </button>

          {/* Limpiar */}
          {hayFiltros && (
            <button onClick={limpiarFiltros} className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-sm font-black transition-all self-end shadow-sm">
              <X size={18}/> LIMPIAR
            </button>
          )}
        </div>

        {/* LISTA DE ASIENTOS */}
        {loading ? (
          <div className="py-20 bg-white border border-slate-200 rounded-[2.5rem] text-center flex flex-col items-center gap-4">
            <Loader2 className="animate-spin text-amber-500" size={48}/>
            <p className="font-black text-slate-400 uppercase tracking-widest text-sm">Cargando libro mayor...</p>
          </div>
        ) : asientos.length === 0 ? (
          <div className="py-20 bg-white border border-slate-200 rounded-[2.5rem] text-center flex flex-col items-center gap-4">
            <BookOpen size={48} className="text-slate-300"/>
            <p className="font-black text-slate-400 uppercase tracking-widest text-sm">Sin resultados para los filtros aplicados</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {asientos.map(asi => {
              const isOpen = expandedIds.has(asi.AsiId);
              const dateObj = new Date(asi.AsiFecha);
              // Los totales vienen sumados del servidor: la tarjeta cerrada no
              // necesita las líneas, y así no hay que traerlas para todo el libro.
              const totalDebe = Number(asi.TotalDebe || 0);
              const totalHaber = Number(asi.TotalHaber || 0);
              const cuadra = Math.abs(totalDebe - totalHaber) < 0.01;
              const lineas = lineasPorAsiento[asi.AsiId];
              return (
                <div key={asi.AsiId} className={`bg-white border-2 hover:border-amber-300 rounded-[1.5rem] shadow-sm hover:shadow-xl transition-all overflow-hidden ${isOpen ? 'border-amber-300 shadow-md ring-4 ring-amber-50' : 'border-slate-100'}`}>

                  {/* CABECERA — siempre visible, clickeable para expandir */}
                  <div
                    className="flex justify-between items-center px-8 py-5 cursor-pointer select-none bg-white hover:bg-slate-50 transition-colors"
                    onClick={() => toggleExpand(asi.AsiId)}
                  >
                    <div className="flex items-center gap-5 flex-wrap">
                      <span className="text-amber-700 font-black font-mono text-sm bg-amber-100 border border-amber-200 px-3 py-1 rounded-xl shadow-sm">#{asi.AsiId}</span>
                      <div>
                        <p className="font-black text-slate-800 text-lg tracking-tight leading-none">{asi.AsiConcepto}</p>
                        <div className="flex items-center gap-3 mt-2 text-[10px] uppercase text-slate-400 font-black tracking-widest">
                          <span className="flex items-center gap-1.5"><Calendar size={14} className="text-indigo-400"/> {dateObj.toLocaleDateString('es-UY')} {dateObj.toLocaleTimeString('es-UY', { hour: '2-digit', minute: '2-digit' })}</span>
                          {asi.AsiOrigen && <span className="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-lg text-slate-500">{asi.AsiOrigen}</span>}
                          {asi.TcaIdTransaccion && (
                            <button
                              onClick={e => { e.stopPropagation(); handleViewOP(asi.TcaIdTransaccion); }}
                              className="bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white px-2.5 py-0.5 rounded-lg border border-indigo-200 transition-all font-black"
                            >
                              VER OP #{asi.TcaIdTransaccion}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-right hidden sm:block">
                        <p className="text-[10px] font-black uppercase text-slate-400 mb-0.5 tracking-widest">Debe / Haber (UYU)</p>
                        <p className={`font-black font-mono text-base ${cuadra ? 'text-emerald-600' : 'text-rose-600'}`}>
                          $ {fmt(totalDebe)} / $ {fmt(totalHaber)}
                          {!cuadra && <span className="ml-2 text-rose-500 font-sans tracking-normal">⚠ DESCUADRE</span>}
                        </p>
                      </div>
                      <div className={`p-2 rounded-xl transition-colors ${isOpen ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'}`}>
                        {isOpen ? <ChevronUp size={20}/> : <ChevronDown size={20}/>}
                      </div>
                    </div>
                  </div>

                  {/* DETALLE — sólo visible cuando está expandido */}
                  {isOpen && !lineas && (
                    <div className="border-t border-slate-100 bg-slate-50/50 px-8 py-8 flex items-center justify-center gap-3">
                      {cargandoLineas === asi.AsiId && <Loader2 className="animate-spin text-amber-500" size={20}/>}
                      <span className="font-black text-slate-400 uppercase tracking-widest text-[11px]">
                        {cargandoLineas === asi.AsiId ? 'Cargando el detalle del asiento...' : 'No se pudo traer el detalle de este asiento'}
                      </span>
                    </div>
                  )}

                  {isOpen && lineas && (
                    <div className="border-t border-slate-100 bg-slate-50/50 px-8 pb-6 pt-5">
                      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-8 gap-y-3 text-sm">
                        <div className="font-black text-[10px] tracking-widest uppercase text-slate-400 mb-2 border-b border-slate-200 pb-2">Cuenta Contable</div>
                        <div className="font-black text-[10px] tracking-widest uppercase text-slate-400 mb-2 border-b border-slate-200 pb-2 text-right">Monto Original</div>
                        <div className="font-black text-[10px] tracking-widest uppercase text-slate-400 mb-2 border-b border-slate-200 pb-2 text-right w-36">Debe (UYU)</div>
                        <div className="font-black text-[10px] tracking-widest uppercase text-slate-400 mb-2 border-b border-slate-200 pb-2 text-right w-36">Haber (UYU)</div>

                        {lineas.map((l, i) => (
                          <React.Fragment key={i}>
                            <div className="flex items-center gap-3 py-1">
                              <span className="text-indigo-700 font-black font-mono text-xs bg-indigo-100 border border-indigo-200 px-2 py-0.5 rounded-lg shadow-sm">{l.CueCodigo}</span>
                              <span className="font-bold text-slate-700">{l.CueNombre}</span>
                            </div>
                            <div className="text-right text-slate-500 font-mono text-sm py-1 flex justify-end font-bold items-center">
                              {l.MonedaId === 2
                                ? <span className="text-emerald-600 bg-emerald-50 px-2 rounded-md">USD {fmt(l.ImporteOriginal)}</span>
                                : <span>$ {fmt(l.ImporteOriginal)}</span>
                              }
                            </div>
                            <div className={`text-right font-black font-mono text-base py-1 ${l.DebeUYU > 0 ? 'text-slate-800' : 'text-slate-300'}`}>
                              {l.DebeUYU > 0 ? `$ ${fmt(l.DebeUYU)}` : '-'}
                            </div>
                            <div className={`text-right font-black font-mono text-base py-1 ${l.HaberUYU > 0 ? 'text-slate-800' : 'text-slate-300'}`}>
                              {l.HaberUYU > 0 ? `$ ${fmt(l.HaberUYU)}` : '-'}
                            </div>
                          </React.Fragment>
                        ))}

                        {/* TOTALES */}
                        <div className="col-span-2 text-right pt-4 mt-2 border-t-2 border-slate-200 font-black text-slate-500 uppercase tracking-widest text-[10px] pb-1">Total Cuadre UYU:</div>
                        <div className="text-right pt-4 mt-2 border-t-2 border-slate-200 font-black text-emerald-600 font-mono text-lg pb-1">$ {fmt(totalDebe)}</div>
                        <div className="text-right pt-4 mt-2 border-t-2 border-slate-200 font-black text-emerald-600 font-mono text-lg pb-1">$ {fmt(totalHaber)}</div>
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
                className="self-center mt-2 mb-4 flex items-center gap-3 px-10 py-4 rounded-2xl bg-white border-2 border-slate-200 hover:border-amber-400 text-slate-700 text-sm font-black uppercase tracking-widest shadow-sm hover:shadow-lg transition-all disabled:opacity-50"
              >
                {cargandoMas
                  ? <><Loader2 className="animate-spin text-amber-500" size={18}/> Cargando...</>
                  : <>Cargar {Math.min(PAGE_SIZE, total - asientos.length)} asientos más (quedan {total - asientos.length})</>}
              </button>
            ) : (
              <p className="self-center mt-2 mb-4 font-black text-slate-400 uppercase tracking-widest text-[10px]">
                Fin del listado · {total} asientos
              </p>
            )}
          </div>
        )}
      </div>

      {/* Modal OP */}
      {selectedOP && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60  p-4 animate-in fade-in" onClick={e => e.target === e.currentTarget && setSelectedOP(null)}>
          <div className="bg-white border border-slate-200 rounded-[2.5rem] w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95">
            <div className="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
              <h2 className="text-xl font-black text-slate-800 flex items-center gap-3 tracking-tight"><BookOpen size={24} className="text-indigo-600"/> Transacción de Caja <span className="text-indigo-600">#{selectedOP.TcaIdTransaccion}</span></h2>
              <button onClick={() => setSelectedOP(null)} className="text-slate-400 hover:text-rose-600 bg-white hover:bg-rose-50 p-2 border border-slate-200 shadow-sm rounded-xl transition-all"><X size={20}/></button>
            </div>
            <div className="flex-1 overflow-auto p-10 flex flex-col gap-10">
              <div className="flex justify-between items-end border-b-2 border-slate-100 pb-6">
                <div>
                  <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Cliente Vinculado</h3>
                  <p className="text-2xl font-black text-slate-800 tracking-tight">{selectedOP.NombreCliente}</p>
                  <p className="text-xs font-bold text-slate-500 mt-2 uppercase tracking-widest flex items-center gap-1.5"><Calendar size={14}/> {new Date(selectedOP.TcaFecha).toLocaleString('es-UY')}</p>
                </div>
                <div className="text-right">
                  <h3 className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">Total Cobrado (Base UYU)</h3>
                  <p className="text-4xl font-black text-emerald-600 font-mono tracking-tighter">${fmt(selectedOP.TcaTotalCobrado)}</p>
                </div>
              </div>

              {selectedOP.detalle?.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black text-slate-400 mb-4 tracking-widest uppercase flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-slate-300"></div> Comprobantes Aplicados</h4>
                  <div className="bg-white border rounded-[1.5rem] shadow-sm border-slate-200 overflow-hidden">
                    <table className="w-full text-sm text-slate-700">
                      <thead className="bg-slate-50 text-[10px] uppercase font-black text-slate-400 tracking-widest border-b border-slate-200">
                        <tr><th className="px-5 py-4 text-left">Referencia</th><th className="px-5 py-4 text-left">Ref ID</th><th className="px-5 py-4 text-right">Monto Original</th><th className="px-5 py-4 text-right">Ajuste</th><th className="px-5 py-4 text-right">Final</th></tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedOP.detalle.map((d, i) => (
                          <tr key={i} className="hover:bg-slate-50 transition-colors">
                            <td className="px-5 py-4 font-bold">{d.TdeCodigoReferencia || '-'}</td>
                            <td className="px-5 py-4 font-mono font-bold text-slate-500">{d.TdeReferenciaId}</td>
                            <td className="px-5 py-4 text-right"><span className="font-black font-mono text-slate-400">${fmt(d.TdeImporteOriginal)}</span></td>
                            <td className="px-5 py-4 text-right font-black font-mono text-amber-500">{d.TdeAjuste !== 0 ? `$${fmt(d.TdeAjuste)}` : '-'}</td>
                            <td className="px-5 py-4 text-right font-black font-mono text-slate-800 text-lg">${fmt(d.TdeImporteFinal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {selectedOP.pagos?.length > 0 && (
                <div>
                  <h4 className="text-[10px] font-black text-slate-400 mb-4 tracking-widest uppercase flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-slate-300"></div> Métodos de Pago</h4>
                  <div className="flex flex-col gap-3">
                    {selectedOP.pagos.map((p, i) => (
                      <div key={i} className="flex justify-between items-center bg-white border border-slate-200 shadow-sm hover:shadow-md transition-shadow rounded-2xl p-4 px-6">
                        <div className="flex items-center gap-4">
                          <div className="bg-indigo-50 p-2 rounded-xl border border-indigo-100 text-indigo-600">
                              <DollarSign size={20}/>
                          </div>
                          <span className="font-black text-slate-800">{p.MPaDescripcionMetodo}</span>
                        </div>
                        <div className="flex items-center gap-6">
                          {p.PagCotizacion && p.PagCotizacion !== 1 && (
                            <span className="text-xs text-slate-400 font-black uppercase tracking-widest border border-slate-200 px-2 py-0.5 rounded-lg bg-slate-50">TC: x{fmt(p.PagCotizacion)}</span>
                          )}
                          <span className="font-black text-emerald-600 font-mono text-2xl tracking-tighter">{p.MonSimbolo || '$'} {fmt(p.PagMontoPago)}</span>
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
