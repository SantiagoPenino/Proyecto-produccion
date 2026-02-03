import React, { useState, useEffect, useMemo } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';

// --- COMPONENTE TREENODE RECURSIVO ---
const TreeNode = ({ node, level = 0, onSelect, selectedId, expanded, toggleExpand, isLinkedFn }) => {
    const hasChildren = node.children && node.children.length > 0;
    const isExpanded = expanded[node.id];

    // Si es hoja (item final)
    if (!hasChildren) {
        const isSelected = selectedId === node.data.id;
        const isLinked = isLinkedFn ? isLinkedFn(node.data) : false;

        return (
            <div
                className={`
                    flex items-center py-1 px-2 cursor-pointer text-sm
                    ${isSelected ? 'bg-indigo-100 text-indigo-900 font-medium' : 'hover:bg-slate-50 text-slate-700'}
                    ${isLinked ? 'text-green-700' : ''}
                `}
                style={{ paddingLeft: `${level * 20 + 24}px` }}
                onClick={(e) => { e.stopPropagation(); onSelect(node.data); }}
            >
                <i className={`fa-solid ${isLinked ? 'fa-link' : 'fa-cube'} mr-2 text-xs ${isLinked ? 'text-green-500' : 'text-slate-400'}`}></i>
                <span className="truncate">{node.label}</span>
                {node.data.extra && <span className="ml-2 text-xs text-slate-400 bg-slate-100 px-1 rounded">{node.data.extra}</span>}
            </div>
        );
    }

    // Si es rama (carpeta)
    return (
        <div>
            <div
                className="flex items-center py-1 px-2 cursor-pointer hover:bg-slate-100/50 text-sm font-semibold text-slate-600 select-none"
                style={{ paddingLeft: `${level * 20}px` }}
                onClick={(e) => { e.stopPropagation(); toggleExpand(node.id); }}
            >
                <span className="w-5 h-5 flex items-center justify-center mr-1 text-slate-400">
                    <i className={`fa-solid ${isExpanded ? 'fa-folder-open text-amber-400' : 'fa-folder text-amber-300'}`}></i>
                </span>
                <span className="truncate">{node.label}</span>
                <span className="ml-2 text-[10px] bg-slate-100 text-slate-400 px-1.5 rounded-full">{node.children.length}</span>
            </div>

            {isExpanded && (
                <div className="border-l border-slate-100 ml-4">
                    {node.children.map(child => (
                        <TreeNode
                            key={child.id}
                            node={child}
                            level={level + 1}
                            onSelect={onSelect}
                            selectedId={selectedId}
                            expanded={expanded}
                            toggleExpand={toggleExpand}
                            isLinkedFn={isLinkedFn}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};


const ProductsIntegration = () => {
    // --- ESTADOS ---
    const [localArticles, setLocalArticles] = useState([]);
    const [remoteProducts, setRemoteProducts] = useState([]);

    // Filtros
    const [filterLocal, setFilterLocal] = useState("");
    const [filterRemote, setFilterRemote] = useState("");

    // Selección
    const [selectedLocal, setSelectedLocal] = useState(null);
    const [selectedRemote, setSelectedRemote] = useState(null);

    const [loadingLocal, setLoadingLocal] = useState(false);
    const [loadingRemote, setLoadingRemote] = useState(false);
    const [linking, setLinking] = useState(false);

    // Estado Árbol
    const [expandedLocal, setExpandedLocal] = useState({});
    const [expandedRemote, setExpandedRemote] = useState({});

    // --- CARGA DE DATOS ---
    useEffect(() => {
        loadLocal();
        loadRemote();
    }, []);

    const loadLocal = () => {
        setLoadingLocal(true);
        api.get('/products-integration/local')
            .then(res => setLocalArticles(res.data))
            .catch(err => toast.error("Error locales"))
            .finally(() => setLoadingLocal(false));
    };

    const loadRemote = () => {
        setLoadingRemote(true);
        api.get('/products-integration/remote')
            .then(res => setRemoteProducts(res.data))
            .catch(err => toast.error("Error remotos: " + (err.response?.data?.error || err.message)))
            .finally(() => setLoadingRemote(false));
    };

    // --- BUILDERS DE ÁRBOL ---

    // 1. Árbol Local: Grupo -> Articulo (Sin nivel SupFlia 1 redundante)
    const localTree = useMemo(() => {
        const root = { id: 'root', label: 'Artículos', children: [] };
        const mapGrp = {};

        // Filtrado previo
        const search = filterLocal.toLowerCase();
        const filtered = localArticles.filter(art =>
            !search ||
            (art.Descripcion || "").toLowerCase().includes(search) ||
            (art.CodArticulo || "").toLowerCase().includes(search)
        );

        filtered.forEach(art => {
            // Saltamos el nivel 1 (SupFlia)
            const grpName = art.Grupo || 'Sin Grupo';

            // Nivel 1 (Antes 2): Grupo
            if (!mapGrp[grpName]) {
                mapGrp[grpName] = {
                    id: `grp-${grpName}`,
                    label: grpName,
                    children: [],
                    data: null
                };
                root.children.push(mapGrp[grpName]);
            }

            // Nivel 2: Hoja (Articulo)
            mapGrp[grpName].children.push({
                id: `art-${art.CodArticulo}`,
                // Formato Label: Codigo : X = Descripcion
                label: `Codigo : ${art.CodArticulo} = ${art.Descripcion}`,
                children: [],
                data: { ...art, id: art.CodArticulo }
            });
        });

        // Ordenar alfabéticamente los grupos
        root.children.sort((a, b) => a.label.localeCompare(b.label));

        // Auto-expandir si hay filtro activo
        if (search && search.length > 2) {
            const newExpanded = {};
            root.children.forEach(grp => {
                newExpanded[grp.id] = true;
            });
        }

        return root.children;
    }, [localArticles, filterLocal]);

    // 2. Árbol Remoto: SubMarca -> Producto
    const remoteTree = useMemo(() => {
        const root = { id: 'root', label: 'Productos API', children: [] };
        const mapSubMarca = {};

        const search = filterRemote.toLowerCase();
        const filtered = remoteProducts.filter(prod =>
            !search ||
            (prod.ProNombreProducto || "").toLowerCase().includes(search) ||
            (prod.ProCodigoOdooProducto || "").toLowerCase().includes(search)
        );

        filtered.forEach(prod => {
            const catId = prod.SMaIdSubMarca || 0;
            const catLabel = catId === 0 ? 'General' : `SubMarca ${catId}`;

            if (!mapSubMarca[catId]) {
                mapSubMarca[catId] = {
                    id: `cat-${catId}`,
                    label: catLabel,
                    children: [],
                    data: null
                };
                root.children.push(mapSubMarca[catId]);
            }

            mapSubMarca[catId].children.push({
                id: `prod-${prod.ProIdProducto}`,
                label: prod.ProNombreProducto,
                children: [],
                data: { ...prod, id: prod.ProIdProducto, extra: `$${prod.ProPrecioActual}` }
            });
        });

        return root.children;
    }, [remoteProducts, filterRemote]);


    // --- HANDLERS ---

    const validSelection = selectedLocal?.CodArticulo && selectedRemote?.ProIdProducto;

    const handleLink = async () => {
        if (!validSelection || linking) return;
        setLinking(true);
        try {
            await api.post('/products-integration/link', {
                codArticulo: selectedLocal.CodArticulo,
                idProdReact: selectedRemote.ProIdProducto
            });
            toast.success("Vinculado!");

            // Actualizar localState
            setLocalArticles(prev => prev.map(a =>
                a.CodArticulo === selectedLocal.CodArticulo
                    ? { ...a, IDProdReact: selectedRemote.ProIdProducto }
                    : a
            ));
            setSelectedLocal(null);
            setSelectedRemote(null);

        } catch (e) {
            toast.error("Error: " + e.message);
        } finally { setLinking(false); }
    };

    const handleUnlink = async () => {
        if (!selectedLocal?.CodArticulo) return;
        if (!window.confirm("¿Desvincular?")) return;

        try {
            await api.post('/products-integration/unlink', { codArticulo: selectedLocal.CodArticulo });
            toast.success("Desvinculado");
            setLocalArticles(prev => prev.map(a =>
                a.CodArticulo === selectedLocal.CodArticulo
                    ? { ...a, IDProdReact: null }
                    : a
            ));
            setSelectedLocal(null);
        } catch (e) { toast.error("Error: " + e.message); }
    };

    // Toggle Expand
    const toggleLocal = (id) => setExpandedLocal(prev => ({ ...prev, [id]: !prev[id] }));
    const toggleRemote = (id) => setExpandedRemote(prev => ({ ...prev, [id]: !prev[id] }));

    // Expand All Helper
    const expandAll = (treeData, setter) => {
        const all = {};
        const traverse = (nodes) => {
            if (!nodes) return;
            nodes.forEach(n => {
                all[n.id] = true;
                if (n.children) traverse(n.children);
            });
        };
        traverse(treeData);
        setter(all);
    };


    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
            {/* Header */}
            <div className="p-4 bg-white border-b border-slate-200 flex justify-between items-center shadow-sm z-10">
                <div>
                    <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
                        <i className="fa-solid fa-network-wired text-indigo-600"></i>
                        Vinculación de Productos
                    </h1>
                    <p className="text-xs text-slate-500">Asocia el árbol de Artículos Local con el catálogo Remoto</p>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => { loadLocal(); loadRemote(); }} className="btn-secondary text-xs px-3 py-1.5 h-8">
                        <i className="fa-solid fa-rotate mr-1"></i> Recargar
                    </button>
                </div>
            </div>

            {/* Content 3 cols: Tree Local | Actions | Tree Remote */}
            <div className="flex-1 flex overflow-hidden p-4 gap-4">

                {/* PANEL IZQUIERDO: ARBOL LOCAL */}
                <div className="flex-1 flex flex-col bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
                    <div className="p-3 border-b border-slate-100 bg-slate-50 flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                            <h3 className="font-bold text-slate-700 text-sm">Artículos Locales</h3>
                            <button onClick={() => expandAll(localTree, setExpandedLocal)} className="text-xs text-indigo-500 hover:text-indigo-700">Expandir Todo</button>
                        </div>
                        <input
                            className="w-full text-xs p-2 border rounded"
                            placeholder="Buscar local..."
                            value={filterLocal}
                            onChange={(e) => {
                                setFilterLocal(e.target.value);
                                if (e.target.value.length > 2) expandAll(localTree, setExpandedLocal);
                            }}
                        />
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                        {loadingLocal ? <p className="text-xs text-slate-400 p-4">Cargando...</p> : (
                            localTree.map(node => (
                                <TreeNode
                                    key={node.id}
                                    node={node}
                                    expanded={expandedLocal}
                                    toggleExpand={toggleLocal}
                                    onSelect={(data) => setSelectedLocal({ CodArticulo: data.CodArticulo, ...data })}
                                    selectedId={selectedLocal?.CodArticulo}
                                    isLinkedFn={(d) => !!d.IDProdReact}
                                />
                            ))
                        )}
                        {localTree.length === 0 && !loadingLocal && <p className="text-xs text-slate-400 p-4 italic">No hay resultados</p>}
                    </div>
                    {/* Footer Info Local */}
                    <div className="p-2 border-t border-slate-100 bg-slate-50 text-xs h-10 flex items-center">
                        {selectedLocal ? (
                            <div className="flex justify-between w-full items-center">
                                <span className="font-mono text-slate-600 truncate max-w-[70%]">{selectedLocal.CodArticulo}</span>
                                {selectedLocal.IDProdReact && (
                                    <button onClick={handleUnlink} className="text-red-500 hover:bg-red-50 px-2 py-1 rounded ml-auto">
                                        <i className="fa-solid fa-unlink mr-1"></i>Desvincular
                                    </button>
                                )}
                            </div>
                        ) : <span className="text-slate-400 italic">Selecciona un ítem...</span>}
                    </div>
                </div>


                {/* PANEL CENTRAL: ACCIONES */}
                <div className="w-16 flex flex-col items-center justify-center gap-4">
                    <div className="h-full w-[1px] bg-slate-200 absolute left-1/2 -z-10"></div>
                    <button
                        onClick={handleLink}
                        disabled={!validSelection || linking}
                        className={`
                            w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-all z-10
                            ${validSelection
                                ? 'bg-indigo-600 text-white hover:scale-110 hover:bg-indigo-700 cursor-pointer'
                                : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }
                        `}
                        title="Vincular"
                    >
                        {linking ? <i className="fa-solid fa-spinner fa-spin"></i> : <i className="fa-solid fa-link"></i>}
                    </button>
                </div>


                {/* PANEL DERECHO: ARBOL REMOTO */}
                <div className="flex-1 flex flex-col bg-white rounded-lg shadow border border-slate-200 overflow-hidden">
                    <div className="p-3 border-b border-slate-100 bg-slate-50 flex flex-col gap-2">
                        <div className="flex justify-between items-center">
                            <h3 className="font-bold text-slate-700 text-sm">Productos API (User)</h3>
                            <button onClick={() => expandAll(remoteTree, setExpandedRemote)} className="text-xs text-indigo-500 hover:text-indigo-700">Expandir Todo</button>
                        </div>
                        <input
                            className="w-full text-xs p-2 border rounded"
                            placeholder="Buscar en API..."
                            value={filterRemote}
                            onChange={(e) => {
                                setFilterRemote(e.target.value);
                                if (e.target.value.length > 2) expandAll(remoteTree, setExpandedRemote);
                            }}
                        />
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                        {loadingRemote ? <p className="text-xs text-slate-400 p-4">Cargando API...</p> : (
                            remoteTree.map(node => (
                                <TreeNode
                                    key={node.id}
                                    node={node}
                                    expanded={expandedRemote}
                                    toggleExpand={toggleRemote}
                                    onSelect={(data) => setSelectedRemote({ ProIdProducto: data.ProIdProducto, ...data })}
                                    selectedId={selectedRemote?.ProIdProducto}
                                />
                            ))
                        )}
                        {remoteTree.length === 0 && !loadingRemote && <p className="text-xs text-slate-400 p-4 italic">No hay resultados. (Intento {loadingRemote ? '...' : 'OK'})</p>}
                    </div>
                    <div className="p-2 border-t border-slate-100 bg-slate-50 text-xs h-10 flex items-center">
                        {selectedRemote ? (
                            <span className="font-mono text-slate-600 truncate">
                                ID: {selectedRemote.ProIdProducto} | $ {selectedRemote.ProPrecioActual}
                            </span>
                        ) : <span className="text-slate-400 italic">Selecciona un producto...</span>}
                    </div>
                </div>

            </div>
        </div>
    );
};

export default ProductsIntegration;
