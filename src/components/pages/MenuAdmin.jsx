import React, { useState, useEffect, useCallback, Children, isValidElement, Fragment } from 'react';
import { ListTree, Plus, GripVertical, ChevronDown, ChevronRight, Link2, Pencil, Trash2, Loader2, FolderOpen, X, Save } from 'lucide-react';
import { toast } from 'sonner';
import { menuService } from '../../services/api';
import Selector from '../ui/Selector';
import useConfirmar from '../ui/useConfirmar';

// Mapeo de FontAwesome para visualización
const iconMap = {
    'fa-shield-halved': 'fa-shield-halved',
    'fa-industry': 'fa-industry',
    'fa-users': 'fa-users',
    'fa-key': 'fa-key',
    'fa-file-lines': 'fa-file-lines',
    'fa-layer-group': 'fa-layer-group',
    'fa-boxes-stacked': 'fa-boxes-stacked',
    'fa-home': 'fa-home',
    'fa-truck': 'fa-truck',
    'fa-screwdriver-wrench': 'fa-screwdriver-wrench',
    'fa-building': 'fa-building',
    'fa-database': 'fa-database',
    'fa-gear': 'fa-gear',
    'fa-chart-pie': 'fa-chart-pie',
    'fa-comments': 'fa-comments',
    'fa-print': 'fa-print',
    'fa-fire': 'fa-fire',
    'fa-vest': 'fa-vest',
    'fa-shirt': 'fa-shirt',
    'fa-circle-dot': 'fa-circle-dot',
    'fa-diagram-project': 'fa-diagram-project',
    'fa-table-columns': 'fa-table-columns'
};

const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const ENTRADA = 'w-full px-3 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 outline-none transition-colors hover:border-zinc-300 focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ETIQUETA = 'block mb-1.5 text-[11px] font-black uppercase tracking-widest text-zinc-400';

// Valores de los <option> (también los que vienen de un .map).
const valoresDe = (hijos) => {
    const salida = [];
    Children.forEach(hijos, (h) => {
        if (!isValidElement(h)) return;
        if (h.type === Fragment) { salida.push(...valoresDe(h.props.children)); return; }
        if (h.type === 'option') salida.push(String(h.props.value ?? ''));
    });
    return salida;
};

// <select> del formulario con el Selector propio. El valor viaja en un input con el mismo name, así handleSave lo
// sigue leyendo con FormData. Como el nativo, si el valor inicial no está entre las opciones vale la primera.
const SelectorCampo = ({ name, defaultValue, children, ...props }) => {
    const [valor, setValor] = useState(String(defaultValue ?? ''));
    const valores = valoresDe(children);
    const efectivo = valores.includes(valor) ? valor : (valores[0] ?? '');
    return (
        <>
            <Selector value={efectivo} onChange={(e) => setValor(e.target.value)} className="w-full" {...props}>{children}</Selector>
            <input type="hidden" name={name} value={efectivo} />
        </>
    );
};

// Estética nueva (22/10/2026): fondo claro, tarjetas blancas con borde, íconos de Lucide en brand-cyan sin fondo,
// Selector propio en el formulario y confirmación/avisos del sistema (antes window.confirm y alert). El ícono de
// cada ítem sigue siendo el de FontAwesome guardado en el campo Icono (es el dato que se edita acá).
const MenuAdmin = () => {
    const [modulos, setModulos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [editando, setEditando] = useState(null);
    const [nuevoModulo, setNuevoModulo] = useState(null);
    const [expandidos, setExpandidos] = useState(new Set());
    const [draggedItem, setDraggedItem] = useState(null);
    const [confirmar, ventanaConfirmar] = useConfirmar();

    const cargarDatos = useCallback(async () => {
        setLoading(true);
        try {
            // Usamos el servicio real. Si falla el endpoint (porque no existe en backend aun),
            // usaremos fallback vacío o lo que venga.
            const data = await menuService.getAll();
            setModulos(Array.isArray(data) ? data : []);

            // Auto expandir primeros niveles
            if (Array.isArray(data)) {
                const rootIds = data.filter(m => !m.IdPadre).map(m => m.IdModulo);
                setExpandidos(new Set(rootIds));
            }
        } catch (error) {
            console.error("Error cargando módulos", error);
            // Fallback visual si falla backend
            setModulos([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        cargarDatos();
    }, [cargarDatos]);

    const construirArbol = useCallback((items, padreId = null) => {
        // Validar que items sea array
        if (!Array.isArray(items)) return [];

        return items
            .filter(item => item.IdPadre === padreId)
            .sort((a, b) => (a.IndiceOrden || 0) - (b.IndiceOrden || 0))
            .map(item => ({
                ...item,
                hijos: construirArbol(items, item.IdModulo)
            }));
    }, []);

    const toggleExpandir = (id) => {
        const nSet = new Set(expandidos);
        if (nSet.has(id)) nSet.delete(id);
        else nSet.add(id);
        setExpandidos(nSet);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const itemData = {
            IdModulo: editando?.IdModulo,
            Titulo: formData.get('Titulo'),
            Ruta: formData.get('Ruta') || null,
            Icono: formData.get('Icono') || null,
            IdPadre: formData.get('IdPadre') ? parseInt(formData.get('IdPadre')) : null,
            IndiceOrden: parseInt(formData.get('IndiceOrden')) || 0,
            Activo: true
        };

        try {
            if (editando) {
                await menuService.update(editando.IdModulo, itemData);
            } else {
                await menuService.create(itemData);
            }
            setEditando(null);
            setNuevoModulo(null);
            cargarDatos();
        } catch (error) {
            toast.error("Error al guardar: " + (error.message || 'Error desconocido'));
        }
    };

    const handleDelete = async (id) => {
        if (await confirmar({ titulo: '¿Deseas eliminar este elemento y sus referencias?', confirmar: 'Eliminar', peligro: true })) {
            try {
                await menuService.delete(id);
                cargarDatos();
            } catch (error) {
                toast.error("Error al eliminar: " + (error.message || 'Error desconocido'));
            }
        }
    };

    const onDrop = async (e, targetItem) => {
        e.preventDefault();
        if (!draggedItem || draggedItem.IdModulo === targetItem.IdModulo) return;

        // Actualización optimista local
        const nuevosModulos = modulos.map(m => {
            if (m.IdModulo === draggedItem.IdModulo) {
                return {
                    ...m,
                    IdPadre: targetItem.IdPadre,
                    IndiceOrden: (targetItem.IndiceOrden || 0) + 0.1
                };
            }
            return m;
        });

        setModulos(nuevosModulos.sort((a, b) => (a.IndiceOrden || 0) - (b.IndiceOrden || 0)));

        // Guardado en backend (reordenamiento simple)
        try {
            // Aquí llamaríamos a un endpoint de reordenamiento masivo o actualizaríamos el item arrastrado
            // Por simplicidad, actualizamos solo el movido
            await menuService.update(draggedItem.IdModulo, {
                ...draggedItem,
                IdPadre: targetItem.IdPadre,
                IndiceOrden: (targetItem.IndiceOrden || 0) + 0.1
            });
            // Luego recargamos para asegurar consistencia
            cargarDatos();
        } catch (err) {
            console.error("Error al mover", err);
            cargarDatos(); // Revertir
        }
    };

    const cerrarModal = () => { setEditando(null); setNuevoModulo(null); };

    // Cada raíz es una tarjeta; sus hijos van adentro, sangrados con una línea punteada por nivel.
    const RenderNodo = ({ item, nivel = 0 }) => {
        const tieneHijos = item.hijos && item.hijos.length > 0;
        const isExpandido = expandidos.has(item.IdModulo);
        const esRaiz = nivel === 0;

        return (
            <div className={esRaiz ? `${CARD} overflow-hidden` : ''}>
                <div
                    draggable
                    onDragStart={(e) => { setDraggedItem(item); e.target.style.opacity = '0.5'; }}
                    onDragEnd={(e) => { setDraggedItem(null); e.target.style.opacity = '1'; }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDrop(e, item)}
                    data-fila
                    className={`group flex items-center gap-1.5 sm:gap-2 transition-colors
                        ${esRaiz ? 'px-2 sm:px-3 py-2.5 hover:bg-zinc-50' : 'px-1.5 sm:px-2 py-1.5 rounded-xl border border-transparent hover:bg-white hover:border-zinc-200'}
                        ${draggedItem?.IdModulo === item.IdModulo ? 'ring-2 ring-brand-cyan/40 opacity-50' : ''}`}
                >
                    <GripVertical size={16} className="shrink-0 text-zinc-300 cursor-grab group-hover:text-zinc-400 transition-colors" aria-hidden="true" />
                    <button
                        type="button"
                        onClick={() => toggleExpandir(item.IdModulo)}
                        title={isExpandido ? 'Contraer' : 'Expandir'}
                        className={`w-7 h-7 shrink-0 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors ${!tieneHijos ? 'invisible' : ''}`}
                    >
                        {isExpandido ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>

                    <span className="w-6 shrink-0 inline-flex items-center justify-center text-brand-cyan" aria-hidden="true">
                        <i className={`fa-solid ${item.Icono || 'fa-layer-group'} ${esRaiz ? 'text-base' : 'text-sm'}`}></i>
                    </span>

                    <div className="flex-1 min-w-0 ml-1">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className={`truncate ${esRaiz ? 'text-[15px] font-black text-zinc-900' : 'text-sm font-bold text-zinc-700'}`}>
                                {item.Titulo || item.Nombre}
                            </span>
                            {item.IdPadre && (
                                <span className="hidden sm:inline-block shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full border border-zinc-200 bg-zinc-50 text-zinc-500 uppercase tracking-wide">
                                    Sub
                                </span>
                            )}
                            {esRaiz && tieneHijos && (
                                <span className="shrink-0 text-[11px] font-bold text-zinc-400 tabular-nums">{item.hijos.length}</span>
                            )}
                        </div>
                        {item.Ruta && (
                            <span className="flex items-center gap-1 mt-0.5 text-[11px] font-mono text-zinc-400 min-w-0">
                                <Link2 size={11} className="shrink-0" aria-hidden="true" />
                                <span className="truncate">{item.Ruta}</span>
                            </span>
                        )}
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                        <button
                            type="button"
                            onClick={() => setEditando(item)}
                            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-brand-cyan hover:bg-brand-cyan/5 transition-colors"
                            title="Editar"
                        >
                            <Pencil size={15} />
                        </button>
                        <button
                            type="button"
                            onClick={() => handleDelete(item.IdModulo)}
                            className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-zinc-400 hover:text-brand-magenta hover:bg-brand-magenta/5 transition-colors"
                            title="Eliminar"
                        >
                            <Trash2 size={15} />
                        </button>
                    </div>
                </div>

                {tieneHijos && isExpandido && (
                    <div className={esRaiz
                        ? 'border-t border-zinc-100 bg-zinc-50/70 py-2 pr-2 pl-4 sm:pl-10 space-y-0.5'
                        : 'mt-0.5 ml-3 sm:ml-6 border-l-2 border-dashed border-zinc-200 pl-2 space-y-0.5'}>
                        {item.hijos.map(hijo => (
                            <RenderNodo key={hijo.IdModulo} item={hijo} nivel={nivel + 1} />
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700">

            {/* Encabezado */}
            <div className="flex flex-wrap items-center gap-3 mb-5">
                <ListTree size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Menú del Sistema</h1>
                    <p className="text-sm text-zinc-500 mt-1">Gestión de jerarquía y accesos API</p>
                </div>
                <button
                    type="button"
                    onClick={() => setNuevoModulo({ IdPadre: null, Titulo: '', Ruta: '', Icono: '', IndiceOrden: modulos.length })}
                    className={`${BTN_PRINCIPAL} w-full sm:w-auto`}
                >
                    <Plus size={16} />
                    <span>Nuevo Item</span>
                </button>
            </div>

            {/* Contenedor del Menú */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 mb-3 px-1">
                <h3 className="text-[11px] font-black uppercase tracking-widest text-zinc-400 flex items-center gap-2">
                    Estructura visual
                    {loading && <Loader2 size={14} className="animate-spin text-brand-cyan" />}
                </h3>
                <span className="text-xs text-zinc-400">Arrastrá una fila sobre otra para moverla a su lugar</span>
            </div>

            <div className="space-y-3 pb-10">
                {modulos.length > 0 ? (
                    construirArbol(modulos).map(root => (
                        <RenderNodo key={root.IdModulo} item={root} />
                    ))
                ) : !loading && (
                    <div className={`${CARD} flex flex-col items-center justify-center text-center py-16 px-4`}>
                        <FolderOpen size={40} className="mb-3 text-brand-cyan" />
                        <p className="text-sm font-bold text-zinc-700">No se encontraron módulos</p>
                        <p className="text-xs text-zinc-400 mt-1">Crea el primer elemento del menú</p>
                    </div>
                )}
            </div>

            {/* Modal Formulario */}
            {(editando || nuevoModulo) && (
                <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-labelledby="menu-admin-titulo">
                    <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between gap-3 shrink-0">
                            <div className="flex items-center gap-3 min-w-0">
                                {editando ? <Pencil size={20} className="text-brand-cyan shrink-0" /> : <Plus size={20} className="text-brand-cyan shrink-0" />}
                                <div className="min-w-0">
                                    <h2 id="menu-admin-titulo" className="text-lg font-black text-zinc-800 leading-tight truncate">
                                        {editando ? 'Editar Item' : 'Nuevo Registro'}
                                    </h2>
                                    <p className="text-[11px] font-black uppercase tracking-widest text-zinc-400 mt-0.5">Sincronización de Base de Datos</p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={cerrarModal}
                                title="Cerrar"
                                className="p-2 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors shrink-0"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <form onSubmit={handleSave} className="flex flex-col min-h-0 flex-1">
                            <div className="p-5 space-y-4 overflow-y-auto">
                                <div>
                                    <label htmlFor="menu-titulo" className={ETIQUETA}>Etiqueta del Menú</label>
                                    <input
                                        id="menu-titulo"
                                        name="Titulo"
                                        required
                                        defaultValue={editando?.Titulo || editando?.Nombre || ''}
                                        placeholder="Ej: Administración de Roles"
                                        className={`${ENTRADA} font-bold`}
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label htmlFor="menu-ruta" className={ETIQUETA}>Ruta Navegación</label>
                                        <input
                                            id="menu-ruta"
                                            name="Ruta"
                                            defaultValue={editando?.Ruta || ''}
                                            placeholder="/admin/mod"
                                            className={`${ENTRADA} font-mono`}
                                        />
                                    </div>
                                    <div>
                                        <label htmlFor="menu-icono" className={ETIQUETA}>Icono (FontAwesome)</label>
                                        <input
                                            id="menu-icono"
                                            name="Icono"
                                            defaultValue={editando?.Icono || ''}
                                            placeholder="fa-home"
                                            className={`${ENTRADA} font-mono`}
                                        />
                                    </div>
                                </div>

                                <div>
                                    <span className={ETIQUETA}>Jerarquía (Elemento Padre)</span>
                                    <SelectorCampo
                                        name="IdPadre"
                                        defaultValue={editando?.IdPadre || nuevoModulo?.IdPadre || ''}
                                        aria-label="Jerarquía (Elemento Padre)"
                                        anchoLista={300}
                                    >
                                        <option value="">-- Nodo Raíz (Sin Padre) --</option>
                                        {modulos
                                            .filter(m => editando ? m.IdModulo !== editando.IdModulo : true)
                                            .sort((a, b) => (a.Titulo || a.Nombre).localeCompare(b.Titulo || b.Nombre))
                                            .map(m => (
                                                <option key={m.IdModulo} value={m.IdModulo}>{m.Titulo || m.Nombre}</option>
                                            ))
                                        }
                                    </SelectorCampo>
                                </div>

                                <div>
                                    <label htmlFor="menu-orden" className={ETIQUETA}>Orden (Índice)</label>
                                    <input
                                        id="menu-orden"
                                        name="IndiceOrden"
                                        type="number"
                                        step="1"
                                        defaultValue={editando?.IndiceOrden || nuevoModulo?.IndiceOrden || 0}
                                        className={`${ENTRADA} tabular-nums`}
                                    />
                                </div>
                            </div>

                            <div className="px-5 py-3 bg-zinc-50 border-t border-zinc-100 flex flex-wrap justify-end gap-2 shrink-0">
                                <button type="button" onClick={cerrarModal} className={BTN_SECUNDARIO}>Cancelar</button>
                                <button type="submit" className={BTN_PRINCIPAL}>
                                    <Save size={15} />
                                    <span>Guardar Cambios</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {ventanaConfirmar}
        </div>
    );
};

export default MenuAdmin;
