import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../../services/api';
import { toast } from 'sonner';
import { Search, Check, X, ChevronDown, ChevronRight, Loader2, Tag, Pencil } from 'lucide-react';

// [MARKETING 21/08] /marketing/precios — Precios para marketing: el MISMO catálogo completo
// que /admin/base-prices (GET /prices/base), agrupado por familia/categoría en grupos
// colapsables. UNA fila por artículo con DOS columnas de precio ($ pesos y US$ dólares),
// cada una editable inline (click en la celda → precio → Enter). Guarda con el endpoint
// del admin (POST /prices/base → PreciosBase, upsert por artículo+moneda).
// Perfiles y precios escalonados por cantidad siguen en el admin.

const fmtNum = (v) => {
    const n = Number(v);
    if (v == null || isNaN(n)) return null;
    return n.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const MarketingPreciosPage = () => {
    const [filas, setFilas] = useState([]);            // crudo de /prices/base (una fila por moneda)
    const [cargando, setCargando] = useState(true);
    const [busqueda, setBusqueda] = useState('');
    const [abiertos, setAbiertos] = useState({});
    const [editando, setEditando] = useState(null);    // `${ProIdProducto}-${'UYU'|'USD'}`
    const [nuevoPrecio, setNuevoPrecio] = useState('');
    const [guardando, setGuardando] = useState(false);

    // [DEEP-LINK] ?producto=<ProIdProducto> (viene del "Editar en Precios" del editor de
    // productos): abre el grupo del producto, scrollea hasta su fila y la destaca un rato.
    const [searchParams] = useSearchParams();
    const targetId = parseInt(searchParams.get('producto'), 10) || null;
    const [destacado, setDestacado] = useState(null);
    const saltoHecho = useRef(false);
    useEffect(() => {
        if (!targetId || cargando || saltoHecho.current) return;
        const fila = filas.find(r => r.ProIdProducto === targetId);
        if (!fila) return;
        saltoHecho.current = true;
        const grupo = (fila.NombreReferenciaGrupo || fila.GrupoNombre || 'OTROS').trim() || 'OTROS';
        setAbiertos(a => ({ ...a, [grupo]: true }));
        setDestacado(targetId);
        setTimeout(() => {
            document.getElementById(`mkt-precio-${targetId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
        const t = setTimeout(() => setDestacado(null), 3500);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetId, cargando, filas]);

    const cargar = async () => {
        try {
            const res = await api.get('/prices/base');
            setFilas((Array.isArray(res.data) ? res.data : [])
                .filter(r => r.Mostrar !== 0 && r.Mostrar !== false));
        } catch (e) {
            toast.error('No se pudo cargar el catálogo de precios');
        } finally {
            setCargando(false);
        }
    };
    useEffect(() => { cargar(); }, []);

    const q = busqueda.trim().toLowerCase();

    // Pivot: una fila por artículo con su precio en cada moneda, agrupado por categoría.
    const grupos = useMemo(() => {
        const porProducto = {};
        filas.forEach(r => {
            if (q && ![r.Descripcion, r.CodArticulo, r.NombreReferenciaGrupo, r.GrupoNombre, r.DescripcionLista]
                .some(v => (v || '').toLowerCase().includes(q))) return;
            const key = r.ProIdProducto;
            if (!porProducto[key]) {
                porProducto[key] = {
                    ProIdProducto: r.ProIdProducto,
                    CodArticulo: (r.CodArticulo || '').trim(),
                    Descripcion: (r.Descripcion || '').trim(),
                    // Texto que sale en la columna "Descripción" de las listas del portal
                    // y de la landing (antes mostraban un guion fijo).
                    descripcionLista: (r.DescripcionLista || '').trim(),
                    grupo: (r.NombreReferenciaGrupo || r.GrupoNombre || 'OTROS').trim() || 'OTROS',
                    precioUYU: null,
                    precioUSD: null,
                    // Visibilidad en las listas de precios (Articulos.EnListaPrecios/Publica; sin dato = visible)
                    enListaPrecios: r.EnListaPrecios !== 0 && r.EnListaPrecios !== false,
                    enListaPublica: r.EnListaPublica !== 0 && r.EnListaPublica !== false,
                    // El flag no alcanza: el portal además exige no-borrado y precio cargado.
                    borrado: r.Borrado === 1 || r.Borrado === true,
                };
            }
            if (r.Precio != null) {
                if (r.MonIdMoneda === 1) porProducto[key].precioUYU = Number(r.Precio);
                else porProducto[key].precioUSD = Number(r.Precio);
            }
        });
        const map = {};
        Object.values(porProducto).forEach(p => { (map[p.grupo] = map[p.grupo] || []).push(p); });
        return Object.keys(map).sort().map(nombre => ({
            nombre,
            items: map[nombre].sort((a, b) => a.Descripcion.localeCompare(b.Descripcion)),
        }));
    }, [filas, q]);

    const totalVisibles = grupos.reduce((acc, g) => acc + g.items.length, 0);

    const empezarEdicion = (p, moneda) => {
        setEditando(`${p.ProIdProducto}-${moneda}`);
        const actual = moneda === 'UYU' ? p.precioUYU : p.precioUSD;
        setNuevoPrecio(actual != null ? String(actual) : '');
    };
    const cancelar = () => { setEditando(null); setNuevoPrecio(''); };

    const guardar = async (p, moneda) => {
        const precio = parseFloat(String(nuevoPrecio).replace(',', '.'));
        if (isNaN(precio) || precio < 0) { toast.error('Escribí un precio válido'); return; }
        setGuardando(true);
        try {
            await api.post('/prices/base', {
                codArticulo: p.CodArticulo,
                proIdProducto: p.ProIdProducto,
                precio,
                moneda,
            });
            setFilas(prev => {
                const monId = moneda === 'UYU' ? 1 : 2;
                const existe = prev.some(r => r.ProIdProducto === p.ProIdProducto && r.MonIdMoneda === monId);
                if (existe) {
                    return prev.map(r => (r.ProIdProducto === p.ProIdProducto && r.MonIdMoneda === monId)
                        ? { ...r, Precio: precio } : r);
                }
                // El artículo no tenía precio en esa moneda: clonar una de sus filas con la nueva
                const base = prev.find(r => r.ProIdProducto === p.ProIdProducto);
                return base ? [...prev, { ...base, Precio: precio, MonIdMoneda: monId, Moneda: moneda }] : prev;
            });
            toast.success(`${p.Descripcion || p.CodArticulo}: precio en ${moneda === 'UYU' ? 'pesos' : 'dólares'} actualizado`);
            cancelar();
        } catch (e) {
            toast.error('No se pudo guardar el precio');
        } finally {
            setGuardando(false);
        }
    };

    // Toggle de visibilidad del producto en UNA lista de precios (portal / pública).
    // Optimista: cambia al toque y revierte con toast si el guardado falla.
    const toggleLista = async (p, campo) => {
        const valores = {
            EnListaPrecios: campo === 'EnListaPrecios' ? !p.enListaPrecios : p.enListaPrecios,
            EnListaPublica: campo === 'EnListaPublica' ? !p.enListaPublica : p.enListaPublica,
        };
        const aplicar = (v) => setFilas(prev => prev.map(r => r.ProIdProducto === p.ProIdProducto
            ? { ...r, EnListaPrecios: v.EnListaPrecios ? 1 : 0, EnListaPublica: v.EnListaPublica ? 1 : 0 } : r));
        aplicar(valores);
        try {
            await api.put('/prices/lista-flags', { proIdProducto: p.ProIdProducto, ...valores });
        } catch (e) {
            aplicar({ EnListaPrecios: p.enListaPrecios, EnListaPublica: p.enListaPublica });
            toast.error('No se pudo guardar la visibilidad');
        }
    };

    // [DESCRIPCIÓN 27/08] Texto que acompaña al producto en las listas del portal y de la
    // landing. Se edita inline bajo el nombre (Enter guarda, Esc cancela); vacío = guion.
    const [editandoDesc, setEditandoDesc] = useState(null); // ProIdProducto en edición
    const [nuevaDesc, setNuevaDesc] = useState('');
    const empezarDesc = (p) => { setEditandoDesc(p.ProIdProducto); setNuevaDesc(p.descripcionLista || ''); };
    const cancelarDesc = () => { setEditandoDesc(null); setNuevaDesc(''); };
    const guardarDesc = async (p) => {
        const texto = nuevaDesc.trim().substring(0, 500);
        setFilas(prev => prev.map(r => r.ProIdProducto === p.ProIdProducto ? { ...r, DescripcionLista: texto } : r));
        cancelarDesc();
        try {
            await api.put('/prices/descripcion-lista', { proIdProducto: p.ProIdProducto, descripcion: texto });
        } catch (e) {
            setFilas(prev => prev.map(r => r.ProIdProducto === p.ProIdProducto ? { ...r, DescripcionLista: p.descripcionLista } : r));
            toast.error('No se pudo guardar la descripción');
        }
    };

    // Por qué el producto no puede salir en las listas por más que el flag esté prendido.
    // Mismos filtros que /api/precios-publicos (Mostrar ya se filtró al cargar).
    const bloqueo = (p) => {
        if (p.borrado) return 'Borrado en el ERP: no sale en ninguna lista';
        if (p.precioUYU == null && p.precioUSD == null) return 'Sin precio cargado: no sale en ninguna lista';
        return null;
    };

    const ToggleLista = ({ activo, onClick, title, bloqueado }) => (
        <button type="button" onClick={bloqueado ? undefined : onClick} disabled={!!bloqueado}
            title={bloqueado || title}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${
                bloqueado ? 'bg-slate-100 cursor-not-allowed' : activo ? 'bg-emerald-500' : 'bg-slate-200'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full shadow transition-transform ${
                bloqueado ? 'bg-slate-300' : 'bg-white'} ${activo && !bloqueado ? 'translate-x-4' : ''}`} />
        </button>
    );

    // Celda de precio de UNA moneda: valor + lápiz, o input inline si está en edición.
    const CeldaPrecio = ({ p, moneda }) => {
        const valor = moneda === 'UYU' ? p.precioUYU : p.precioUSD;
        const enEdicion = editando === `${p.ProIdProducto}-${moneda}`;
        if (enEdicion) {
            return (
                <div className="flex items-center gap-1 justify-end">
                    <input
                        autoFocus
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={nuevoPrecio}
                        onChange={e => setNuevoPrecio(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') guardar(p, moneda); if (e.key === 'Escape') cancelar(); }}
                        className="w-24 px-2 py-1.5 rounded-lg border border-sky-300 text-sm font-black text-right focus:outline-none focus:ring-2 focus:ring-sky-200"
                    />
                    <button onClick={() => guardar(p, moneda)} disabled={guardando}
                        className="w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center hover:bg-emerald-600 disabled:opacity-50 shrink-0" title="Guardar">
                        {guardando ? <Loader2 size={13} className="animate-spin" /> : <Check size={14} />}
                    </button>
                    <button onClick={cancelar}
                        className="w-7 h-7 rounded-lg border border-slate-200 text-slate-400 flex items-center justify-center hover:bg-slate-100 shrink-0" title="Cancelar">
                        <X size={13} />
                    </button>
                </div>
            );
        }
        return (
            <button
                onClick={() => empezarEdicion(p, moneda)}
                className="group w-full flex items-center justify-end gap-1.5 py-1 rounded-lg hover:bg-sky-50"
                title={`Cambiar precio en ${moneda === 'UYU' ? 'pesos' : 'dólares'}`}
            >
                <span className={`text-sm tabular-nums ${valor != null ? 'font-black text-slate-800' : 'font-bold text-slate-300'}`}>
                    {valor != null ? fmtNum(valor) : '—'}
                </span>
                <Pencil size={12} className="text-slate-300 group-hover:text-sky-500 shrink-0" />
            </button>
        );
    };

    return (
        <div className="p-4 md:p-6 max-w-5xl mx-auto">
            <div className="mb-5">
                <h1 className="text-2xl font-black text-slate-800">Precios</h1>
                <p className="text-sm text-slate-500 mt-1">
                    Todo el catálogo agrupado por categoría, con el precio en pesos y en dólares. Click en el valor para cambiarlo, Enter para guardar.
                </p>
            </div>

            <div className="relative max-w-md mb-4">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                    value={busqueda}
                    onChange={e => setBusqueda(e.target.value)}
                    placeholder="Buscar por producto, código o categoría..."
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
                />
            </div>

            {cargando ? (
                <div className="flex items-center gap-2 text-slate-400 text-sm py-16 justify-center">
                    <Loader2 size={18} className="animate-spin" /> Cargando catálogo...
                </div>
            ) : totalVisibles === 0 ? (
                <div className="text-center py-16 text-slate-400 text-sm">No hay productos que coincidan.</div>
            ) : (
                <div className="space-y-2.5">
                    {grupos.map(g => {
                        const abierto = q ? true : !!abiertos[g.nombre];
                        return (
                            <div key={g.nombre} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                                <button
                                    onClick={() => setAbiertos(a => ({ ...a, [g.nombre]: !a[g.nombre] }))}
                                    className="w-full flex items-center gap-2.5 px-4 py-3.5 hover:bg-slate-50 text-left"
                                >
                                    {abierto ? <ChevronDown size={17} className="text-slate-400" /> : <ChevronRight size={17} className="text-slate-400" />}
                                    <Tag size={14} className="text-slate-300" />
                                    <span className="text-sm font-black text-slate-700 uppercase tracking-wide flex-1">{g.nombre}</span>
                                    <span className="text-xs font-bold text-slate-400 bg-slate-100 rounded-full px-2.5 py-0.5">{g.items.length}</span>
                                </button>

                                {abierto && (
                                    <div className="border-t border-slate-100">
                                        {/* Encabezado de columnas */}
                                        <div className="flex items-center gap-3 pl-11 pr-4 py-2 bg-slate-50/80 border-b border-slate-100">
                                            <span className="flex-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Producto</span>
                                            <span className="w-36 text-right text-[10px] font-black uppercase tracking-wider text-slate-400">$ Pesos</span>
                                            <span className="w-36 text-right text-[10px] font-black uppercase tracking-wider text-slate-400">US$ Dólares</span>
                                            <span className="w-14 text-center text-[10px] font-black uppercase tracking-wider text-slate-400" title="Lista de precios del portal (clientes logueados)">Portal</span>
                                            <span className="w-14 text-center text-[10px] font-black uppercase tracking-wider text-slate-400" title="Lista pública de la landing">Pública</span>
                                        </div>
                                        <div className="divide-y divide-slate-50">
                                            {g.items.map(p => (
                                                <div key={p.ProIdProducto} id={`mkt-precio-${p.ProIdProducto}`}
                                                    className={`flex items-center gap-3 pl-11 pr-4 py-2 transition-colors duration-700 ${destacado === p.ProIdProducto ? 'bg-amber-100' : 'hover:bg-slate-50/60'}`}>
                                                    <div className="flex-1 min-w-0">
                                                        <p className="text-sm font-bold text-slate-700 truncate">
                                                            {p.Descripcion || p.CodArticulo}
                                                            <span className="ml-2 text-[11px] text-slate-400 font-semibold">{p.CodArticulo}</span>
                                                            {bloqueo(p) && (
                                                                <span title={bloqueo(p)}
                                                                    className="ml-2 align-middle text-[9px] font-black uppercase tracking-wider text-rose-600 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">
                                                                    {p.borrado ? 'Borrado' : 'Sin precio'}
                                                                </span>
                                                            )}
                                                        </p>
                                                        {/* Descripción de las listas: click para editar, Enter guarda */}
                                                        {editandoDesc === p.ProIdProducto ? (
                                                            <input
                                                                autoFocus
                                                                value={nuevaDesc}
                                                                maxLength={500}
                                                                onChange={e => setNuevaDesc(e.target.value)}
                                                                onBlur={() => guardarDesc(p)}
                                                                onKeyDown={e => { if (e.key === 'Enter') guardarDesc(p); if (e.key === 'Escape') cancelarDesc(); }}
                                                                placeholder="Descripción que ve el cliente en la lista de precios"
                                                                className="mt-0.5 w-full px-2 py-1 rounded-lg border border-sky-300 text-[12px] focus:outline-none focus:ring-2 focus:ring-sky-200"
                                                            />
                                                        ) : (
                                                            <button
                                                                onClick={() => empezarDesc(p)}
                                                                title="Descripción que se muestra en las listas de precios"
                                                                className="mt-0.5 block max-w-full text-left truncate rounded px-1 -ml-1 hover:bg-sky-50"
                                                            >
                                                                {p.descripcionLista
                                                                    ? <span className="text-[12px] text-slate-500">{p.descripcionLista}</span>
                                                                    : <span className="text-[11px] text-slate-300 font-semibold">+ agregar descripción</span>}
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div className="w-36 shrink-0"><CeldaPrecio p={p} moneda="UYU" /></div>
                                                    <div className="w-36 shrink-0"><CeldaPrecio p={p} moneda="USD" /></div>
                                                    <div className="w-14 shrink-0 flex justify-center">
                                                        <ToggleLista activo={p.enListaPrecios} bloqueado={bloqueo(p)}
                                                            onClick={() => toggleLista(p, 'EnListaPrecios')}
                                                            title={p.enListaPrecios ? 'Visible en la lista del portal — click para ocultar' : 'Oculto de la lista del portal — click para mostrar'} />
                                                    </div>
                                                    <div className="w-14 shrink-0 flex justify-center">
                                                        <ToggleLista activo={p.enListaPublica} bloqueado={bloqueo(p)}
                                                            onClick={() => toggleLista(p, 'EnListaPublica')}
                                                            title={p.enListaPublica ? 'Visible en la lista pública — click para ocultar' : 'Oculto de la lista pública — click para mostrar'} />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default MarketingPreciosPage;
