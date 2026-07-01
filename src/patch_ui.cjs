const fs = require('fs');

const path = 'c:/Integracion/User-Macrosoft/Proyecto-produccion/src/components/pages/ProductsIntegration.jsx';
let content = fs.readFileSync(path, 'utf8');

const stateBlock = `    // WMS Importer States
    const [wmsMasters, setWmsMasters] = useState([]);
    const [wmsSearchInput, setWmsSearchInput] = useState('');
    const [importingId, setImportingId] = useState(null);

    useEffect(() => {
        api.get('/products-integration/wms/masters').then(res => {
            if (res.data?.success) setWmsMasters(res.data.data);
        }).catch(err => console.error("Error fetching WMS Masters:", err));
    }, []);

    const handleImportWms = async (id) => {
        setImportingId(id);
        try {
            const res = await api.post(\`/products-integration/wms/import/\${id}\`);
            if (res.data.success) {
                import('sonner').then(m => m.toast.success('Producto importado exitosamente'));
                load(); // Reload articles
            } else {
                import('sonner').then(m => m.toast.error(res.data.message || 'Error al importar'));
            }
        } catch (error) {
            import('sonner').then(m => m.toast.error(error.response?.data?.message || 'Error en el servidor'));
        } finally {
            setImportingId(null);
        }
    };

`;

content = content.replace(
    /const load = useCallback\(\(\) => {/g,
    stateBlock + '    const load = useCallback(() => {'
);


const importerUI = `
                            {/* WMS Importer Section (Only visible for 'products') */}
                            {filterType === 'products' && (
                                <div className="mb-6 bg-slate-100 p-5 rounded-xl border border-blue-200 shadow-inner">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
                                            <i className="fa-solid fa-cloud-arrow-down"></i>
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-bold text-slate-800">Importar Producto desde WMS</h3>
                                            <p className="text-xs text-slate-500">Busca en tiempo real y sincroniza productos maestros que aún no tienes locales.</p>
                                        </div>
                                    </div>
                                    
                                    <div className="relative mb-4">
                                        <i className="fa-solid fa-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                                        <input 
                                            className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none transition-all"
                                            placeholder="Escribe el nombre del producto WMS a buscar..."
                                            value={wmsSearchInput}
                                            onChange={e => setWmsSearchInput(e.target.value)}
                                        />
                                    </div>

                                    {wmsSearchInput.trim().length > 1 && (
                                        <div className="bg-white border border-slate-200 rounded-lg shadow-sm max-h-60 overflow-y-auto custom-scrollbar">
                                            {wmsMasters.filter(m => m.nombre.toLowerCase().includes(wmsSearchInput.toLowerCase())).map(m => {
                                                const isImported = articles.some(a => 
                                                    a.producto_maestro_id == m.id || 
                                                    a.CodArticulo?.trim() === \`WMS-\${m.id}\`
                                                );
                                                return (
                                                    <div key={m.id} className="flex items-center justify-between p-3 border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                                        <div className="flex flex-col">
                                                            <span className="text-sm font-bold text-slate-700">{m.nombre}</span>
                                                            <span className="text-[10px] text-slate-400 uppercase tracking-wider">ID WMS: {m.id}</span>
                                                        </div>
                                                        <button 
                                                            disabled={isImported || importingId === m.id}
                                                            onClick={() => handleImportWms(m.id)}
                                                            className={\`px-4 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 \${
                                                                isImported 
                                                                    ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-not-allowed' 
                                                                    : 'bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-500/20'
                                                            }\`}
                                                        >
                                                            {importingId === m.id ? (
                                                                <><i className="fa-solid fa-spinner fa-spin"></i> Importando...</>
                                                            ) : isImported ? (
                                                                <><i className="fa-solid fa-check"></i> Ya Importado</>
                                                            ) : (
                                                                <><i className="fa-solid fa-download"></i> Importar</>
                                                            )}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                            {wmsMasters.filter(m => m.nombre.toLowerCase().includes(wmsSearchInput.toLowerCase())).length === 0 && (
                                                <div className="p-4 text-center text-sm text-slate-500">
                                                    No se encontraron productos en el WMS.
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
`;

content = content.replace(
    /<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">/g,
    importerUI + '                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-5">'
);

fs.writeFileSync(path, content, 'utf8');
console.log('UI Patched!');
