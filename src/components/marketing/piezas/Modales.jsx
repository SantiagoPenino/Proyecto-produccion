import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Loader2, ArrowLeft, ImageOff, Check } from 'lucide-react';
import { cargarPrecios, cargarVitrina, cargarFotos, fmtPrecio } from './datos';

// Ventanas del compositor: elegir un producto de la lista de precios para llenar la pieza, y
// elegir una foto de la vitrina. En el celular van a pantalla completa.

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const Ventana = ({ titulo, onCerrar, onVolver, children, pie }) => {
    useEffect(() => {
        const h = (e) => { if (e.key === 'Escape') onCerrar(); };
        window.addEventListener('keydown', h);
        return () => window.removeEventListener('keydown', h);
    }, [onCerrar]);
    return (
        <div className="fixed inset-0 z-[6000] bg-slate-900/40 flex items-center justify-center sm:p-4" onMouseDown={onCerrar}>
            <div className="bg-white w-full h-full sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl shadow-xl flex flex-col" onMouseDown={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-5 py-4 border-b border-slate-100">
                    {onVolver && (
                        <button onClick={onVolver} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100" title="Volver">
                            <ArrowLeft size={17} />
                        </button>
                    )}
                    <h2 className="flex-1 text-base font-black text-slate-800">{titulo}</h2>
                    <button onClick={onCerrar} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100" title="Cerrar">
                        <X size={17} />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
                {pie && <div className="px-5 py-4 border-t border-slate-100">{pie}</div>}
            </div>
        </div>
    );
};

const Buscador = ({ valor, onCambiar, placeholder }) => (
    <div className="relative mb-3">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
            autoFocus
            value={valor}
            onChange={e => onCambiar(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-200"
        />
    </div>
);

const Cargando = ({ texto }) => (
    <div className="flex items-center gap-2 text-slate-400 text-sm py-12 justify-center">
        <Loader2 size={18} className="animate-spin" /> {texto}
    </div>
);

// Grilla de fotos de un producto de la vitrina. `extra` agrega opciones al principio (sin foto, etc.).
const GrillaFotos = ({ producto, elegida, onElegir, extra = [] }) => {
    const [fotos, setFotos] = useState(null);
    useEffect(() => {
        let vivo = true;
        setFotos(null);
        cargarFotos(producto).then(f => vivo && setFotos(f)).catch(() => vivo && setFotos([]));
        return () => { vivo = false; };
    }, [producto]);
    if (!fotos) return <Cargando texto="Cargando fotos..." />;
    return (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
            {extra.map(op => (
                <button key={op.id} onClick={() => onElegir(op.valor)}
                    className={`aspect-square rounded-xl border-2 flex flex-col items-center justify-center gap-1 text-[11px] font-bold text-slate-500 px-2 text-center ${elegida === op.valor ? 'border-brand-cyan bg-sky-50' : 'border-slate-200 hover:border-slate-300'}`}>
                    <op.icono size={18} className="text-slate-400" />
                    {op.nombre}
                </button>
            ))}
            {fotos.map(f => (
                <button key={f.src} onClick={() => onElegir(f.src)} title={f.nombre}
                    className={`relative aspect-square rounded-xl border-2 overflow-hidden bg-slate-50 ${elegida === f.src ? 'border-brand-cyan' : 'border-slate-200 hover:border-slate-300'}`}>
                    <img src={f.src} alt="" className="w-full h-full object-contain" loading="lazy" />
                    <span className="absolute bottom-0 inset-x-0 bg-white/90 text-[10px] font-bold text-slate-600 truncate px-1.5 py-0.5">{f.nombre}</span>
                    {elegida === f.src && (
                        <span className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-brand-cyan text-white flex items-center justify-center"><Check size={12} /></span>
                    )}
                </button>
            ))}
            {!fotos.length && !extra.length && <p className="col-span-full text-sm text-slate-400 py-6 text-center">Este producto no tiene fotos en la vitrina.</p>}
        </div>
    );
};

// ---------- elegir producto ----------

export const ModalProducto = ({ onCerrar, onElegir }) => {
    const [productos, setProductos] = useState(null);
    const [vitrina, setVitrina] = useState({});
    const [busqueda, setBusqueda] = useState('');
    const [elegido, setElegido] = useState(null);
    const [moneda, setMoneda] = useState('USD');
    const [foto, setFoto] = useState('');
    const [error, setError] = useState(false);

    useEffect(() => {
        let vivo = true;
        cargarPrecios().then(p => vivo && setProductos(p)).catch(() => { if (vivo) { setError(true); setProductos([]); } });
        cargarVitrina().then((v) => {
            if (!vivo) return;
            const mapa = {};
            v.forEach((p) => { mapa[p.ProIdProducto] = p; });
            setVitrina(mapa);
        }).catch(() => { /* sin vitrina: se elige igual, sin fotos */ });
        return () => { vivo = false; };
    }, []);

    const filtrados = useMemo(() => {
        if (!productos) return [];
        const q = normalizar(busqueda.trim());
        const lista = q
            ? productos.filter(p => [p.Descripcion, p.CodArticulo, p.grupo, p.descripcionLista, vitrina[p.ProIdProducto]?.TituloVenta].some(v => normalizar(v).includes(q)))
            : productos;
        return lista.slice(0, 120);
    }, [productos, busqueda, vitrina]);

    const elegir = (p) => {
        setElegido(p);
        setMoneda(p.precioUSD != null ? 'USD' : 'UYU');
        setFoto(vitrina[p.ProIdProducto]?.Portada || '');
    };

    if (elegido) {
        const enVitrina = vitrina[elegido.ProIdProducto];
        const titulo = (enVitrina?.TituloVenta || '').trim() || elegido.Descripcion;
        const precio = moneda === 'UYU' ? elegido.precioUYU : elegido.precioUSD;
        return (
            <Ventana
                titulo={titulo}
                onCerrar={onCerrar}
                onVolver={() => setElegido(null)}
                pie={(
                    <div className="flex items-center gap-3">
                        <p className="flex-1 text-xs text-slate-500">
                            Llena el título, el precio, el dato técnico y la etiqueta de la pieza. Si falta alguna de esas capas, la crea.
                        </p>
                        <button
                            onClick={() => onElegir({ titulo, grupo: elegido.grupo, descripcionLista: elegido.descripcionLista, moneda, precio, foto: foto || null })}
                            className="px-4 py-2.5 rounded-xl bg-brand-cyan text-white text-sm font-black hover:opacity-90"
                        >
                            Usar en la pieza
                        </button>
                    </div>
                )}
            >
                <div className="space-y-5">
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">Precio</p>
                        <div className="flex gap-2">
                            {[['USD', 'US$', elegido.precioUSD], ['UYU', '$', elegido.precioUYU]].map(([id, signo, valor]) => (
                                <button key={id} disabled={valor == null} onClick={() => setMoneda(id)}
                                    className={`px-4 py-2.5 rounded-xl border-2 text-sm font-black tabular-nums ${moneda === id ? 'border-brand-cyan bg-sky-50 text-slate-800' : 'border-slate-200 text-slate-600 hover:border-slate-300'} disabled:opacity-40 disabled:cursor-not-allowed`}>
                                    {signo} {valor != null ? fmtPrecio(valor) : '—'}
                                </button>
                            ))}
                        </div>
                        {precio == null && <p className="text-xs text-rose-600 mt-2">Este producto no tiene precio cargado: la capa de precio queda vacía.</p>}
                    </div>
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-1">Dato técnico</p>
                        <p className="text-sm text-slate-600">{elegido.descripcionLista || <span className="text-slate-400">Sin descripción para la lista: queda vacío para completarlo a mano.</span>}</p>
                    </div>
                    <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-slate-400 mb-2">Foto</p>
                        {enVitrina ? (
                            <GrillaFotos
                                producto={enVitrina}
                                elegida={foto}
                                onElegir={setFoto}
                                extra={[{ id: 'nada', valor: '', nombre: 'No cambiar la foto', icono: ImageOff }]}
                            />
                        ) : (
                            <p className="text-sm text-slate-400">El producto no está en la vitrina de la tienda: la foto no cambia.</p>
                        )}
                    </div>
                </div>
            </Ventana>
        );
    }

    return (
        <Ventana titulo="Elegir producto" onCerrar={onCerrar}>
            <Buscador valor={busqueda} onCambiar={setBusqueda} placeholder="Buscar por producto, código o categoría..." />
            {!productos ? <Cargando texto="Cargando productos..." /> : error ? (
                <p className="text-center py-10 text-rose-600 text-sm">No se pudo cargar la lista de precios. Probá de nuevo en un momento.</p>
            ) : !filtrados.length ? (
                <p className="text-center py-10 text-slate-400 text-sm">No hay productos que coincidan.</p>
            ) : (
                <div className="divide-y divide-slate-100 -mx-2">
                    {filtrados.map((p) => {
                        const v = vitrina[p.ProIdProducto];
                        return (
                            <button key={p.ProIdProducto} onClick={() => elegir(p)}
                                className="w-full flex items-center gap-3 px-2 py-2.5 text-left rounded-xl hover:bg-slate-50">
                                <div className="w-11 h-11 rounded-lg bg-slate-50 border border-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                                    {v?.Portada ? <img src={v.Portada} alt="" className="w-full h-full object-contain" loading="lazy" /> : <ImageOff size={15} className="text-slate-300" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-slate-700 truncate">{(v?.TituloVenta || '').trim() || p.Descripcion || p.CodArticulo}</p>
                                    <p className="text-[11px] text-slate-400 truncate">{[p.grupo, p.CodArticulo].filter(Boolean).join(' · ')}{p.borrado ? ' · borrado en el ERP' : ''}</p>
                                </div>
                                <div className="text-right shrink-0 text-xs font-black tabular-nums text-slate-600">
                                    {p.precioUSD != null && <div>US$ {fmtPrecio(p.precioUSD)}</div>}
                                    {p.precioUYU != null && <div className="text-slate-400">$ {fmtPrecio(p.precioUYU)}</div>}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </Ventana>
    );
};

// ---------- foto de la vitrina ----------

export const ModalFotoVitrina = ({ onCerrar, onElegir }) => {
    const [productos, setProductos] = useState(null);
    const [busqueda, setBusqueda] = useState('');
    const [elegido, setElegido] = useState(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let vivo = true;
        cargarVitrina().then(v => vivo && setProductos(v)).catch(() => { if (vivo) { setError(true); setProductos([]); } });
        return () => { vivo = false; };
    }, []);

    const filtrados = useMemo(() => {
        if (!productos) return [];
        const q = normalizar(busqueda.trim());
        return productos
            .filter(p => p.Portada)
            .filter(p => !q || [p.TituloVenta, p.Descripcion, p.CodArticulo, p.CategoriaVitrina].some(v => normalizar(v).includes(q)))
            .slice(0, 120);
    }, [productos, busqueda]);

    if (elegido) {
        return (
            <Ventana titulo={(elegido.TituloVenta || '').trim() || elegido.Descripcion} onCerrar={onCerrar} onVolver={() => setElegido(null)}>
                <GrillaFotos producto={elegido} elegida={null} onElegir={src => onElegir(src)} />
            </Ventana>
        );
    }

    return (
        <Ventana titulo="Foto de la vitrina" onCerrar={onCerrar}>
            <Buscador valor={busqueda} onCambiar={setBusqueda} placeholder="Buscar producto de la vitrina..." />
            {!productos ? <Cargando texto="Cargando vitrina..." /> : error ? (
                <p className="text-center py-10 text-rose-600 text-sm">No se pudo cargar la vitrina. Probá de nuevo en un momento.</p>
            ) : !filtrados.length ? (
                <p className="text-center py-10 text-slate-400 text-sm">No hay productos con foto que coincidan.</p>
            ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                    {filtrados.map(p => (
                        <button key={p.ProIdProducto} onClick={() => setElegido(p)} title={p.TituloVenta || p.Descripcion}
                            className="rounded-xl border border-slate-200 hover:border-brand-cyan overflow-hidden text-left bg-white">
                            <div className="aspect-square bg-slate-50">
                                <img src={p.Portada} alt="" className="w-full h-full object-contain" loading="lazy" />
                            </div>
                            <p className="text-[11px] font-bold text-slate-600 truncate px-2 py-1.5">{(p.TituloVenta || '').trim() || p.Descripcion}</p>
                        </button>
                    ))}
                </div>
            )}
        </Ventana>
    );
};
