// ─────────────────────────────────────────────────────────────────────────────
// Editor de reglas de un beneficio (specs/40 RN-BEN.02/03): alcance (artículo,
// grupo o servicio completo) + tipo (precio fijo, % sobre LISTA, monto) + valor.
// Reglas en el formato que espera el backend: { alcance, proIdProducto, codArticulo,
// codGrupo, areaId, tipo, valor, cantidadMinima, descripcion }.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useEffect, useMemo, useState } from 'react';
import { Plus, X, Search } from 'lucide-react';
import { benApi, sym, ALCANCES, TIPOS_REGLA } from './beneficiosUi';

const nuevaRegla = () => ({ alcance: 'ARTICULO', proIdProducto: null, codArticulo: '', codGrupo: '', areaId: '', tipo: 'fixed', valor: '', cantidadMinima: 1, descripcion: '' });

export default function EditorReglasBeneficio({ value, onChange, monedaId = 1 }) {
  const reglas = value || [];
  const [cat, setCat] = useState({ articulos: [], grupos: [], areas: [] });
  const [busq, setBusq] = useState({});          // idx → texto
  const [resultados, setResultados] = useState({}); // idx → artículos
  const [filtroGrupo, setFiltroGrupo] = useState({}); // idx → Grupo (para acotar la búsqueda)
  const [buscando, setBuscando] = useState({});  // idx → bool, mientras espera la respuesta
  const seqRef = React.useRef({}); // idx → nº de pedido en curso, para ignorar respuestas viejas que llegan tarde

  useEffect(() => { benApi.get('/catalogo').then(r => setCat({ articulos: r.articulos || [], grupos: r.grupos || [], areas: r.areas || [] })).catch(() => {}); }, []);

  const set = (i, patch) => onChange(reglas.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const quitar = (i) => onChange(reglas.filter((_, k) => k !== i));
  const agregar = () => onChange([...reglas, nuevaRegla()]);

  // Busca por texto Y/O por grupo (specs/40): con un grupo elegido alcanza para listar,
  // sin necesidad de tipear. Ignora respuestas que ya quedaron viejas (evita que un
  // resultado lento pise a uno más nuevo si el usuario sigue tipeando).
  const buscar = async (i, q, grupo = filtroGrupo[i] || '') => {
    setBusq(b => ({ ...b, [i]: q }));
    const texto = (q || '').trim();
    if (texto.length < 2 && !grupo) { setResultados(r => ({ ...r, [i]: [] })); setBuscando(x => ({ ...x, [i]: false })); return; }
    const pedido = (seqRef.current[i] || 0) + 1;
    seqRef.current[i] = pedido;
    setBuscando(x => ({ ...x, [i]: true }));
    try {
      const params = new URLSearchParams();
      if (texto) params.set('q', texto);
      if (grupo) params.set('grupo', grupo);
      const r = await benApi.get(`/catalogo?${params.toString()}`);
      if (seqRef.current[i] !== pedido) return; // llegó una respuesta más vieja que la última pedida: se descarta
      setResultados(x => ({ ...x, [i]: r.articulos || [] }));
    } catch { if (seqRef.current[i] === pedido) setResultados(x => ({ ...x, [i]: [] })); }
    finally { if (seqRef.current[i] === pedido) setBuscando(x => ({ ...x, [i]: false })); }
  };
  const cambiarGrupoFiltro = (i, grupo) => { setFiltroGrupo(g => ({ ...g, [i]: grupo })); buscar(i, busq[i] || '', grupo); };
  const elegirArt = (i, a) => {
    set(i, { proIdProducto: a.ProIdProducto, codArticulo: a.CodArticulo, descripcion: a.Descripcion, precioLista: a.PrecioLista, monLista: a.MonLista });
    setBusq(b => ({ ...b, [i]: '' })); setResultados(r => ({ ...r, [i]: [] })); setFiltroGrupo(g => ({ ...g, [i]: '' }));
  };
  const grupos = useMemo(() => cat.grupos || [], [cat]);

  return (
    <div className="border border-zinc-200 rounded-xl overflow-hidden bg-white">
      <div className="grid grid-cols-[minmax(0,1fr)_170px_120px_70px_28px] gap-2 items-center px-3 py-2 bg-zinc-50 text-[10px] font-black text-zinc-400 uppercase tracking-widest">
        <span>Aplica a</span><span>Tipo</span><span>Valor</span><span title="Cantidad mínima por pedido para que aplique">Mín.</span><span />
      </div>
      {reglas.length === 0 && <p className="px-3 py-3 text-xs text-slate-500">Todavía no hay reglas. Agregá al menos una: un artículo, un grupo entero o un servicio completo.</p>}
      {reglas.map((r, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_170px_120px_70px_28px] gap-2 items-start px-3 py-2 border-t border-zinc-100">
          <div className="space-y-1.5">
            <select value={r.alcance} onChange={e => set(i, { alcance: e.target.value, proIdProducto: null, codArticulo: '', codGrupo: '', areaId: '', descripcion: '' })}
              className="w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-xs font-bold text-zinc-700 bg-white">
              {ALCANCES.map(a => <option key={a.v} value={a.v}>{a.l}</option>)}
            </select>
            {r.alcance === 'ARTICULO' && (
              <div>
                {r.proIdProducto ? (
                  <div className="flex items-center justify-between gap-2 border border-emerald-200 bg-emerald-50 rounded-lg px-2 py-1.5 text-xs">
                    <span className="font-bold text-emerald-800 truncate">{r.descripcion || r.codArticulo}</span>
                    <span className="text-[10px] text-emerald-700 font-mono shrink-0">#{r.codArticulo}{r.precioLista ? ` · lista ${sym(r.monLista)} ${Number(r.precioLista).toFixed(2)}` : ''}</span>
                    <button type="button" onClick={() => set(i, { proIdProducto: null, codArticulo: '', descripcion: '' })} className="text-emerald-700 hover:text-rose-600"><X size={12} /></button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex gap-1.5">
                      <div className="flex-1 flex items-center gap-2 border border-zinc-200 rounded-lg px-2 py-1.5">
                        <Search size={12} className="text-zinc-400 shrink-0" />
                        <input value={busq[i] || ''} onChange={e => buscar(i, e.target.value)} placeholder="Buscar por nombre o código…" className="w-full text-xs outline-none" />
                      </div>
                      <select value={filtroGrupo[i] || ''} onChange={e => cambiarGrupoFiltro(i, e.target.value)}
                        title="Acotar por grupo/familia — con esto elegido ya se lista, sin necesidad de tipear"
                        className="w-32 shrink-0 border border-zinc-200 rounded-lg px-1.5 text-[11px] font-semibold text-zinc-600 bg-white">
                        <option value="">Todos los grupos</option>
                        {grupos.map(g => <option key={g.Grupo} value={g.Grupo}>{g.Grupo} — {g.Nombre}</option>)}
                      </select>
                    </div>
                    {/* Lista de resultados EN EL FLUJO normal (no flotante): así nunca queda tapada
                        ni cortada por el scroll del modal que la contiene. */}
                    {buscando[i] && <p className="text-[11px] text-zinc-400 px-1 py-1">Buscando…</p>}
                    {!buscando[i] && (busq[i]?.trim().length >= 2 || filtroGrupo[i]) && (resultados[i] || []).length === 0 && (
                      <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">Sin resultados. Probá con otra palabra, el código, o elegí un grupo de la lista.</p>
                    )}
                    {(resultados[i] || []).length > 0 && (
                      <div className="max-h-52 overflow-y-auto bg-white border border-zinc-200 rounded-lg shadow-sm divide-y divide-zinc-100">
                        {resultados[i].map(a => (
                          <button type="button" key={a.ProIdProducto} onClick={() => elegirArt(i, a)} className="w-full text-left px-3 py-1.5 hover:bg-cyan-50 text-xs flex justify-between gap-2">
                            <span className="truncate"><span className="font-bold text-zinc-800">{a.Descripcion}</span> <span className="text-zinc-400 font-mono">#{a.CodArticulo}</span></span>
                            <span className="text-zinc-500 shrink-0">{a.Grupo ? `grupo ${a.Grupo}` : ''}{a.PrecioLista ? ` · ${sym(a.MonLista)} ${Number(a.PrecioLista).toFixed(2)}` : ''}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {r.alcance === 'GRUPO' && (
              <select value={r.codGrupo || ''} onChange={e => set(i, { codGrupo: e.target.value })} className="w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                <option value="">— Elegir grupo / familia —</option>
                {grupos.map(g => <option key={g.Grupo} value={g.Grupo}>{g.Grupo} — {g.Nombre} ({g.N})</option>)}
              </select>
            )}
            {r.alcance === 'AREA' && (
              <select value={r.areaId || ''} onChange={e => set(i, { areaId: e.target.value })} className="w-full border border-zinc-200 rounded-lg px-2 py-1.5 text-xs bg-white">
                <option value="">— Elegir servicio —</option>
                {(cat.areas || []).map(a => <option key={a.AreaID} value={a.AreaID}>{a.Nombre} ({a.AreaID})</option>)}
              </select>
            )}
          </div>
          <select value={r.tipo} onChange={e => set(i, { tipo: e.target.value })} className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs font-bold text-zinc-700 bg-white">
            {TIPOS_REGLA.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
          </select>
          <div className="flex items-center gap-1 border border-zinc-200 rounded-lg px-2 py-1 bg-white">
            <span className="text-[10px] font-bold text-zinc-400">{r.tipo === 'percentage' ? '%' : sym(monedaId)}</span>
            <input type="number" step="0.01" min="0" value={r.valor} onChange={e => set(i, { valor: e.target.value })} className="w-full text-xs font-mono font-bold outline-none text-right" />
          </div>
          <input type="number" min="1" value={r.cantidadMinima || 1} onChange={e => set(i, { cantidadMinima: e.target.value })} className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs font-mono text-right" />
          <button type="button" onClick={() => quitar(i)} title="Quitar esta regla" className="text-zinc-400 hover:text-rose-600 mt-1.5"><X size={14} /></button>
        </div>
      ))}
      <div className="px-3 py-2 border-t border-zinc-100 flex items-center justify-between gap-2">
        <button type="button" onClick={agregar} className="inline-flex items-center gap-1 text-[11px] font-bold text-cyan-700 hover:text-cyan-900"><Plus size={12} /> Agregar artículo, grupo o servicio completo</button>
        <span className="text-[10px] text-zinc-400">El % se calcula siempre sobre el precio de lista. Si dos reglas alcanzan al mismo artículo gana la más específica.</span>
      </div>
    </div>
  );
}
