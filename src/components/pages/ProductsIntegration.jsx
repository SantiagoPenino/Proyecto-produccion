import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../../services/api';
import { toast } from 'sonner';
import { Listbox, ListboxButton, ListboxOptions, ListboxOption } from '@headlessui/react';
import {
    Plus, Pencil, X, Network, Box, Check, CloudUpload, Camera, Upload, LoaderCircle,
    Layers, Info, TriangleAlert, Image as ImageIcon, Link2, EyeOff, Tag, Trash2, RotateCw,
    PackageOpen, Search, Globe, Folder, FolderOpen, ArrowUpDown, CloudDownload, Download, Ellipsis,
    FileText, Ruler, ExternalLink, ChevronDown
} from 'lucide-react';

// SupFlia 1 = servicios y 2 = productos (mismo criterio que el filtro "Tipo").
const nombreFamilia = (sup) => {
    if (sup === '1') return 'Servicios';
    if (sup === '2') return 'Productos';
    if (sup === '(Sin Familia)') return 'Sin familia';
    return `Familia ${sup}`;
};

// Mostrar llega como bit (true/false) o como 1/0 después de guardar desde el modal.
const esOculto = (a) => a.Mostrar === false || a.Mostrar === 0;

const fmt2 = (n) => Number(n).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const MONEDAS = { 1: 'UYU', 2: 'USD' };

const ORDEN_OPCIONES = [
    { value: 'price_asc',  label: 'Menor Precio' },
    { value: 'price_desc', label: 'Mayor Precio' },
    { value: 'name_asc',   label: 'Nombre A-Z' },
    { value: 'name_desc',  label: 'Nombre Z-A' },
];

// Orden de la grilla con Listbox de Headless UI: marca la opción elegida y se maneja con teclado.
const OrdenSelect = ({ value, onChange }) => {
    const sel = ORDEN_OPCIONES.find(o => o.value === value) || ORDEN_OPCIONES[0];
    return (
        <Listbox value={value} onChange={onChange}>
            <ListboxButton
                aria-label={`Ordenar: ${sel.label}`}
                className="group min-w-[12rem] py-2 pl-3 pr-2.5 inline-flex items-center justify-between gap-2 border border-slate-200 bg-slate-50 hover:bg-white rounded-lg text-sm font-semibold text-slate-600 outline-none transition-colors focus-visible:border-brand-cyan focus-visible:ring-4 focus-visible:ring-brand-cyan/10 data-[open]:border-brand-cyan data-[open]:bg-white"
            >
                <span className="truncate">{sel.label}</span>
                <ChevronDown size={15} className="shrink-0 text-slate-400 transition-transform group-data-[open]:rotate-180" aria-hidden="true" />
            </ListboxButton>
            <ListboxOptions
                anchor="bottom start"
                transition
                className="z-50 w-[var(--button-width)] min-w-[12rem] [--anchor-gap:4px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg outline-none transition duration-100 ease-out data-[closed]:scale-95 data-[closed]:opacity-0"
            >
                {ORDEN_OPCIONES.map(o => (
                    <ListboxOption
                        key={o.value}
                        value={o.value}
                        className="group flex cursor-pointer select-none items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-sm text-slate-700 data-[focus]:bg-slate-100 data-[selected]:font-semibold data-[selected]:text-brand-cyan"
                    >
                        <span className="whitespace-nowrap">{o.label}</span>
                        <Check size={14} className="invisible text-brand-cyan group-data-[selected]:visible" aria-hidden="true" />
                    </ListboxOption>
                ))}
            </ListboxOptions>
        </Listbox>
    );
};

// Precio base 0 o ausente = sin precio (antes se mostraba "UYU 0.00").
const precioDe = (art) => {
    const p = art.PrecioBase != null ? parseFloat(art.PrecioBase) : null;
    if (p == null || !Number.isFinite(p) || p === 0) return { texto: 'Sin precio', sinPrecio: true };
    return { texto: `${MONEDAS[art.MonIdMoneda] || 'S/M'} ${fmt2(p)}`, sinPrecio: false };
};

const FORM_VACIO = {
    proIdProducto: null, codArticulo: '', idProdReact: '',
    descripcion: '', codStock: '',
    grupo: '', supFlia: '', mostrar: true,
    anchoImprimible: '', largoImprimible: '', llevaPapel: false, monIdMoneda: '',
    uniIdUnidad: '',
    producto_maestro_id: ''
};

const MONEDA_OPCIONES = [{ v: '1', l: 'UYU' }, { v: '2', l: 'USD' }, { v: '', l: 'Sin definir' }];

const Switch = ({ checked, onChange, labelledBy, onClass }) => (
    <button
        type="button"
        role="switch"
        aria-checked={!!checked}
        aria-labelledby={labelledBy}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-4 focus-visible:ring-brand-cyan/20 ${checked ? onClass : 'bg-slate-300'}`}
    >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
    </button>
);

const Seccion = ({ icon: Icono, titulo, extra, children }) => (
    <section className="rounded-xl border border-slate-200 p-4">
        <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2 mb-3">
            <Icono size={16} className="text-brand-cyan" aria-hidden="true" /> {titulo} {extra}
        </h3>
        <div className="space-y-3">{children}</div>
    </section>
);

// ─── Modal de Edición con combos dependientes ─────────────────────────────────
const EditModal = ({ article, allArticles, onClose, onSaved }) => {
    const isNew = !article?.ProIdProducto;

    const [form, setForm] = useState(FORM_VACIO);
    // Foto del formulario al abrir: contra esto se detectan los cambios sin guardar.
    const inicialRef = useRef(JSON.stringify(FORM_VACIO));
    const [errores, setErrores] = useState({});
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const codigoRef = useRef(null);
    const [unidades, setUnidades] = useState([]); // Unidad de medida (1=Cantidades, 2=Metros)
    const [saving, setSaving] = useState(false);
    const [imageFile, setImageFile] = useState(null);
    const [imagePreview, setImagePreview] = useState(article?.url_imagen || null);
    const [wmsMasters, setWmsMasters] = useState([]);
    const [wmsSearch, setWmsSearch] = useState('');
    const [wmsDropdownOpen, setWmsDropdownOpen] = useState(false);
    const [wmsVariants, setWmsVariants] = useState([]);
    const fileInputRef = useRef(null);

    // [IMÁGENES POR COLOR] Fotos extra etiquetadas con un color: la ficha de la tienda muestra
    // la del color contenido en el nombre de la variante elegida ("Short 14 ROJO" ⊃ "ROJO").
    // Se suben/borran al momento, sin esperar el Guardar del form (el endpoint es el mismo
    // upload-image con el campo 'color'; convierte a 512×512 webp igual que la principal).
    const [colorImages, setColorImages] = useState([]);
    const [colorNuevo, setColorNuevo] = useState('');
    const colorFileRef = useRef(null);
    const cargarColorImages = () => {
        if (!article?.ProIdProducto) return;
        api.get(`/products-integration/article-images/${article.ProIdProducto}`)
            .then(res => setColorImages((res.data?.data || []).filter(i => i.color)))
            .catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(cargarColorImages, []);
    const subirImagenColor = async (file) => {
        const color = colorNuevo.trim().toUpperCase();
        if (!color) return toast.error('Escribí el color primero (ej: ROJO)');
        const fd = new FormData();
        fd.append('color', color);
        fd.append('image', file);
        try {
            await api.post(`/products-integration/upload-image/${article.ProIdProducto}`, fd, {
                headers: { 'Content-Type': 'multipart/form-data' }
            });
            toast.success(`Imagen de ${color} subida`);
            setColorNuevo('');
            cargarColorImages();
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        }
    };
    const borrarImagenColor = async (color) => {
        try {
            await api.delete(`/products-integration/article-image/${article.ProIdProducto}?color=${encodeURIComponent(color)}`);
            cargarColorImages();
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        }
    };

    // Producto terminado (según StockArt.TipoStock del CodStock del artículo).
    // Las terminaciones POR MATERIAL ya no se editan acá: única puerta en
    // Configuración ECOUV → Terminaciones (pedido del usuario, vista simple).
    const [termCatalogo, setTermCatalogo] = useState([]);
    const [stockTipos, setStockTipos] = useState({});      // codStock -> TipoStock
    const [ptAncho, setPtAncho] = useState('');
    const [ptAlto, setPtAlto] = useState('');
    const [ptBorde, setPtBorde] = useState('');              // demasía por lado (cm)
    const [ptMaterial, setPtMaterial] = useState('');        // CodArticulo del material de impresión
    const [ptTinta, setPtTinta] = useState('');              // Tinta predefinida (Ecosolvente/UV) — el cliente no la elige
    const [ptMateriales, setPtMateriales] = useState([]);    // materiales disponibles (grupo 1.3)
    const [ptTerms, setPtTerms] = useState({});             // TerminacionID -> { cantidad, ubicacion }
    const [ptDirty, setPtDirty] = useState(false);

    const tipoStock = stockTipos[form.codStock] || 'MATERIAL';
    const showProductoTerminado = !isNew && tipoStock === 'PRODUCTO_TERMINADO';

    useEffect(() => {
        api.get('/products-integration/wms/masters').then(res => {
            if (res.data?.success) setWmsMasters(res.data.data);
        }).catch(err => console.error("Error fetching WMS Masters:", err));
    }, []);

    useEffect(() => {
        if (form.producto_maestro_id) {
            api.get(`/products-integration/wms/variants/${form.producto_maestro_id}`)
               .then(res => setWmsVariants(res.data.data || []))
               .catch(err => console.error("Error fetching variants:", err));
            
            if (wmsMasters.length > 0) {
                const selectedMaster = wmsMasters.find(m => String(m.id) === String(form.producto_maestro_id));
                if (selectedMaster) setWmsSearch(`${selectedMaster.id} - ${selectedMaster.nombre}`);
            }
        } else {
            setWmsVariants([]);
            if (wmsMasters.length > 0) setWmsSearch('');
        }
    }, [form.producto_maestro_id, wmsMasters]);

    useEffect(() => {
        if (article) {
            const f = {
                proIdProducto:   article.ProIdProducto ?? null,
                codArticulo:     article.CodArticulo?.trim()     || '',
                idProdReact:     article.IDProdReact != null ? String(article.IDProdReact) : '',
                descripcion:     article.Descripcion?.trim()     || '',
                codStock:        article.CodStock?.trim()         || '',
                grupo:           article.Grupo?.trim()            || '',
                supFlia:         article.SupFlia?.trim()          || '',
                mostrar:         article.Mostrar == null ? true : !!article.Mostrar,
                // Ancho 0 se muestra vacío: al guardar, vacío vuelve a ser 0.
                anchoImprimible: Number(article.anchoimprimible) ? String(parseFloat(Number(article.anchoimprimible).toFixed(4))) : '',
                largoImprimible: article.largoimprimible != null ? String(parseFloat(Number(article.largoimprimible).toFixed(4))) : '',
                llevaPapel:      !!article.LLEVAPAPEL,
                monIdMoneda:     article.MonIdMoneda != null ? String(article.MonIdMoneda) : '',
                uniIdUnidad:     article.UniIdUnidad != null ? String(article.UniIdUnidad) : '',
                producto_maestro_id: article.producto_maestro_id != null ? String(article.producto_maestro_id) : '',
                precioBase:      article.PrecioBase != null ? parseFloat(article.PrecioBase) : null
            };
            setForm(f);
            inicialRef.current = JSON.stringify(f);
        }
    }, [article]);

    // Unidades de medida para el combo (1=Cantidades/piezas, 2=Metros)
    useEffect(() => {
        api.get('/nomenclators/unidades')
            .then(res => { if (res.data?.success) setUnidades(res.data.data || []); })
            .catch(err => console.error('Error cargando unidades:', err));
    }, []);

    // Tipos de cada CodStock (para saber si el artículo es material o producto terminado)
    useEffect(() => {
        if (isNew) return;
        api.get('/stockart').then(res => {
            if (res.data?.success) {
                const map = {};
                res.data.data.forEach(r => { map[r.CodStock] = r.TipoStock; });
                setStockTipos(map);
            }
        }).catch(err => console.error('Error cargando tipos de StockArt:', err));
    }, [isNew]);

    // Catálogo de terminaciones (para mostrar/editar las incluidas del producto)
    useEffect(() => {
        if (!showProductoTerminado) return;
        if (termCatalogo.length > 0) return;
        api.get('/stockart/terminaciones').then(res => {
            if (res.data?.success) setTermCatalogo(res.data.data);
        }).catch(err => console.error('Error cargando catálogo de terminaciones:', err));
    }, [showProductoTerminado]);

    // Datos de PRODUCTO TERMINADO (dimensiones + borde + material + tinta + incluidas)
    useEffect(() => {
        if (!showProductoTerminado || !form.codArticulo) return;
        api.get(`/stockart/articulos/${encodeURIComponent(form.codArticulo)}/producto-terminado`).then(res => {
            if (res.data?.success) {
                const d = res.data.data;
                setPtAncho(d?.anchoM != null ? String(d.anchoM) : '');
                setPtAlto(d?.altoM != null ? String(d.altoM) : '');
                setPtBorde(d?.bordeCm != null ? String(d.bordeCm) : '');
                setPtMaterial(d?.materialCodArticulo || '');
                setPtTinta(d?.tinta || '');
                const map = {};
                (d?.terminaciones || []).forEach(t => { map[t.TerminacionID] = { cantidad: t.Cantidad, ubicacion: t.Ubicacion || '' }; });
                setPtTerms(map);
                setPtDirty(false);
            }
        }).catch(err => console.error('Error cargando producto terminado:', err));
    }, [showProductoTerminado, form.codArticulo]);

    // Materiales de impresión disponibles (grupo 1.3) para el selector
    useEffect(() => {
        if (!showProductoTerminado || ptMateriales.length > 0) return;
        api.get('/stockart/materiales-impresion?grupo=1.3').then(res => {
            if (res.data?.success) setPtMateriales(res.data.data);
        }).catch(err => console.error('Error cargando materiales de impresión:', err));
    }, [showProductoTerminado]);

    const togglePtTerminacion = (id) => {
        setPtTerms(prev => {
            const next = { ...prev };
            if (next[id] != null) delete next[id];
            else next[id] = { cantidad: 1, ubicacion: '' };
            return next;
        });
        setPtDirty(true);
    };

    const setPtCantidad = (id, cant) => {
        setPtTerms(prev => ({ ...prev, [id]: { ...prev[id], cantidad: cant } }));
        setPtDirty(true);
    };

    const setPtUbicacion = (id, ubi) => {
        setPtTerms(prev => ({ ...prev, [id]: { ...prev[id], ubicacion: ubi } }));
        setPtDirty(true);
    };

    const UBICACIONES_PT = [
        { v: 'ARRIBA', l: 'Arriba' }, { v: 'ABAJO', l: 'Abajo' },
        { v: 'ARRIBA_ABAJO', l: 'Arriba y abajo' },
        { v: 'IZQUIERDA', l: 'Izquierda' }, { v: 'DERECHA', l: 'Derecha' },
        { v: 'COSTADOS', l: 'Ambos costados' },
        { v: 'PERIMETRO', l: 'Perímetro' },
    ];

    // Opciones para combos dependientes
    const supFlias = useMemo(() => {
        const seen = new Set();
        return allArticles
            .map(a => ({ val: a.SupFlia?.trim(), label: a.SupFlia?.trim() }))
            .filter(x => x.val && !seen.has(x.val) && seen.add(x.val))
            .sort((a, b) => a.val?.localeCompare(b.val));
    }, [allArticles]);

    const grupos = useMemo(() => {
        const seen = new Set();
        return allArticles
            .filter(a => !form.supFlia || a.SupFlia?.trim() === form.supFlia)
            .map(a => ({
                val:   a.Grupo?.trim(),
                label: a.DescripcionGrupo?.trim() ? `${a.Grupo?.trim()} · ${a.DescripcionGrupo.trim()}` : a.Grupo?.trim()
            }))
            .filter(x => x.val && !seen.has(x.val) && seen.add(x.val))
            .sort((a, b) => a.val?.localeCompare(b.val));
    }, [allArticles, form.supFlia]);

    const stocks = useMemo(() => {
        const seen = new Set();
        return allArticles
            .filter(a =>
                (!form.supFlia || a.SupFlia?.trim() === form.supFlia) &&
                (!form.grupo   || a.Grupo?.trim()   === form.grupo))
            .map(a => ({
                val:   a.CodStock?.trim(),
                label: a.DescripcionStock?.trim()
                    ? `${a.CodStock?.trim()} · ${a.DescripcionStock.trim()}`
                    : a.CodStock?.trim()
            }))
            .filter(x => x.val && !seen.has(x.val) && seen.add(x.val))
            .sort((a, b) => a.val?.localeCompare(b.val));
    }, [allArticles, form.supFlia, form.grupo]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        let newVal = type === 'checkbox' ? checked : value;
        if (name === 'idProdReact') newVal = String(newVal).replace(/\D/g, '');
        if (name === 'codArticulo' && errores.codArticulo) setErrores(prev => ({ ...prev, codArticulo: undefined }));
        setForm(prev => {
            const next = { ...prev, [name]: newVal };
            if (name === 'supFlia') { next.grupo = ''; next.codStock = ''; }
            if (name === 'grupo')   { next.codStock = ''; }
            return next;
        });
    };

    const handleImageChange = (e) => {
        const file = e.target.files[0];
        if (file) {
            setImageFile(file);
            const reader = new FileReader();
            reader.onloadend = () => setImagePreview(reader.result);
            reader.readAsDataURL(file);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.codArticulo.trim()) {
            setErrores(prev => ({ ...prev, codArticulo: 'Ingresá el código del artículo.' }));
            codigoRef.current?.focus();
            return;
        }
        setSaving(true);
        try {
            const payload = {
                codArticulo:     form.codArticulo,
                idProdReact:     form.idProdReact !== '' ? parseInt(form.idProdReact) : null,
                descripcion:     form.descripcion,
                codStock:        form.codStock,
                grupo:           form.grupo,
                supFlia:         form.supFlia,
                mostrar:         form.mostrar,
                llevaPapel:      form.llevaPapel,
                anchoImprimible: form.anchoImprimible !== '' ? parseFloat(form.anchoImprimible) : 0,
                largoImprimible: form.largoImprimible !== '' ? parseFloat(form.largoImprimible) : null,
                uniIdUnidad:     form.uniIdUnidad !== '' ? parseInt(form.uniIdUnidad) : null,
                monIdMoneda:     form.monIdMoneda !== '' ? parseInt(form.monIdMoneda) : null,
            };

            let proId = form.proIdProducto;

            if (isNew) {
                const res = await api.post('/products-integration/create', payload);
                // Si la API retorna el nuevo ID creado, lo usaríamos aquí para wms/img
            } else {
                await api.post('/products-integration/update', {
                    ...payload,
                    proIdProducto: proId,
                });

                // 2. Guardar WMS ID
                if (form.producto_maestro_id !== (article?.producto_maestro_id != null ? String(article.producto_maestro_id) : '')) {
                    await api.put(`/products-integration/wms/${proId}`, {
                        producto_maestro_id: form.producto_maestro_id !== '' ? parseInt(form.producto_maestro_id) : null
                    });
                }

                // 3. Subir Imagen
                if (imageFile) {
                    const formData = new FormData();
                    formData.append('image', imageFile);
                    await api.post(`/products-integration/upload-image/${proId}`, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' }
                    });
                }

                // 4. Guardar producto terminado (dimensiones + borde + material + tinta + incluidas)
                if (showProductoTerminado && ptDirty) {
                    await api.put(`/stockart/articulos/${encodeURIComponent(form.codArticulo)}/producto-terminado`, {
                        anchoM: ptAncho !== '' ? parseFloat(ptAncho) : null,
                        altoM: ptAlto !== '' ? parseFloat(ptAlto) : null,
                        bordeCm: ptBorde !== '' ? parseFloat(ptBorde) : null,
                        materialCodArticulo: ptMaterial || null,
                        tinta: ptTinta || null,
                        terminaciones: Object.entries(ptTerms).map(([id, v]) => ({
                            terminacionId: parseInt(id),
                            cantidad: parseFloat(v?.cantidad) || 1,
                            ubicacion: v?.ubicacion || null
                        }))
                    });
                }
            }

            toast.success(isNew ? 'Artículo creado' : 'Artículo actualizado');
            onSaved({ ...form, url_imagen: imagePreview }); // optimistically update UI
        } catch (err) {
            toast.error('Error: ' + (err.response?.data?.error || err.message));
        } finally { setSaving(false); }
    };

    // Cambios sin guardar: el formulario difiere de como se abrió, o hay foto o producto terminado pendientes.
    const dirty = useMemo(
        () => JSON.stringify(form) !== inicialRef.current || !!imageFile || ptDirty,
        [form, imageFile, ptDirty]
    );

    // Cerrar (X, Cancelar, clic afuera o Esc) sin perder cambios: si hay algo sin guardar, primero pregunta.
    const intentarCerrar = () => {
        if (saving) return;
        if (dirty) setConfirmDiscard(true);
        else onClose();
    };

    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== 'Escape') return;
            if (confirmDiscard) setConfirmDiscard(false);
            else intentarCerrar();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    });

    const inputBase = "w-full h-10 px-3 border rounded-lg text-sm bg-white outline-none focus:ring-4 transition disabled:bg-slate-50 disabled:text-slate-400";
    const inputCls = `${inputBase} border-slate-300 focus:border-brand-cyan focus:ring-brand-cyan/10`;
    const inputErrCls = `${inputBase} border-red-500 focus:border-red-500 focus:ring-red-500/10`;
    const selectCls = inputCls;
    const labelCls = "block text-xs font-semibold text-slate-600 mb-1.5";
    const helpCls = "text-[11px] text-slate-400 mt-1 leading-snug";

    const grupoSel = grupos.find(g => g.val === form.grupo);
    const titulo = isNew ? 'Nuevo artículo' : (form.descripcion.trim() || 'Editar artículo');
    const meta = isNew
        ? 'Completá los datos y guardá para crearlo'
        : [
            article?.ProIdProducto != null ? `#${article.ProIdProducto}` : null,
            form.codArticulo.trim() ? `Código ${form.codArticulo.trim()}` : null,
            form.supFlia ? [nombreFamilia(form.supFlia), grupoSel?.label?.replace(' · ', ' ')].filter(Boolean).join(' › ') : null,
        ].filter(Boolean).join(' · ');
    const precio = precioDe({ PrecioBase: form.precioBase, MonIdMoneda: form.monIdMoneda });

    return (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4" onClick={intentarCerrar}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="edit-modal-titulo"
                className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header: qué artículo es y si se ve en el catálogo */}
                <div className="flex items-start gap-3 px-6 py-4 border-b border-slate-100 shrink-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isNew ? 'bg-emerald-500/10 text-emerald-500' : 'bg-brand-cyan/10 text-brand-cyan'}`}>
                        {isNew ? <Plus size={20} aria-hidden="true" /> : <Pencil size={18} aria-hidden="true" />}
                    </div>
                    <div className="flex-1 min-w-0">
                        <h2 id="edit-modal-titulo" className="text-lg font-bold text-slate-800 truncate" title={titulo}>{titulo}</h2>
                        <p className="text-xs text-slate-500 truncate" title={meta}>{meta}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 pt-1.5">
                        <span id="lbl-visible" className="text-sm font-semibold text-slate-600">Visible</span>
                        <Switch checked={form.mostrar} onChange={v => setForm(p => ({ ...p, mostrar: v }))} labelledBy="lbl-visible" onClass="bg-emerald-500" />
                    </div>
                    <button type="button" onClick={intentarCerrar} aria-label="Cerrar"
                        className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
                        <X size={18} aria-hidden="true" />
                    </button>
                </div>

                {/* Body */}
                <form id="edit-form" onSubmit={handleSubmit} noValidate className="overflow-y-auto flex-1 p-6 text-sm">
                    <div className="flex flex-col lg:flex-row gap-6">
                        {/* Columna izquierda: datos del artículo */}
                        <div className="flex-1 min-w-0 space-y-4">
                            <Seccion icon={FileText} titulo="General">
                                <div>
                                    <label htmlFor="art-descripcion" className={labelCls}>Descripción</label>
                                    <input id="art-descripcion" name="descripcion" value={form.descripcion} onChange={handleChange}
                                        className={inputCls} placeholder="Nombre del artículo" autoFocus />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <div>
                                        <label htmlFor="art-codigo" className={labelCls}>Código de artículo <span className="text-red-500">*</span></label>
                                        <input id="art-codigo" ref={codigoRef} name="codArticulo" value={form.codArticulo} onChange={handleChange}
                                            onBlur={() => { if (!form.codArticulo.trim()) setErrores(prev => ({ ...prev, codArticulo: 'Ingresá el código del artículo.' })); }}
                                            aria-invalid={!!errores.codArticulo}
                                            aria-describedby={errores.codArticulo ? 'art-codigo-error' : undefined}
                                            className={errores.codArticulo ? inputErrCls : inputCls} placeholder="1152" />
                                        {errores.codArticulo && (
                                            <p id="art-codigo-error" className="text-xs font-medium text-red-500 mt-1">{errores.codArticulo}</p>
                                        )}
                                    </div>
                                    <div>
                                        <label htmlFor="art-idreact" className={labelCls}>IDReact</label>
                                        <input id="art-idreact" name="idProdReact" inputMode="numeric" value={form.idProdReact} onChange={handleChange}
                                            className={inputCls} placeholder="54" />
                                    </div>
                                </div>
                            </Seccion>

                            <Seccion icon={Network} titulo="Clasificación">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label htmlFor="art-familia" className={labelCls}>Familia</label>
                                        <select id="art-familia" name="supFlia" value={form.supFlia} onChange={handleChange} className={selectCls}>
                                            <option value="">Seleccionar</option>
                                            {supFlias.map(x => (
                                                <option key={x.val} value={x.val}>
                                                    {['1', '2'].includes(x.val) ? `${x.val} · ${nombreFamilia(x.val)}` : x.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="art-grupo" className={labelCls}>Grupo</label>
                                        <select id="art-grupo" name="grupo" value={form.grupo} onChange={handleChange} className={selectCls}
                                            disabled={!form.supFlia && grupos.length === 0} title={grupoSel?.label}>
                                            <option value="">Seleccionar</option>
                                            {grupos.map(x => <option key={x.val} value={x.val}>{x.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label htmlFor="art-stock" className={labelCls}>Código de stock</label>
                                        <select id="art-stock" name="codStock" value={form.codStock} onChange={handleChange} className={selectCls}
                                            disabled={!form.grupo && stocks.length === 0} title={stocks.find(s => s.val === form.codStock)?.label}>
                                            <option value="">Seleccionar</option>
                                            {stocks.map(x => <option key={x.val} value={x.val}>{x.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                            </Seccion>

                            <Seccion icon={Ruler} titulo="Precio y medidas">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <span id="lbl-moneda" className={labelCls}>Moneda</span>
                                        <div role="radiogroup" aria-labelledby="lbl-moneda" className="inline-flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-bold">
                                            {MONEDA_OPCIONES.map(o => (
                                                <button key={o.v || 'sin-definir'} type="button" role="radio" aria-checked={form.monIdMoneda === o.v}
                                                    onClick={() => setForm(p => ({ ...p, monIdMoneda: o.v }))}
                                                    className={`px-3 py-1.5 rounded-md transition-colors ${form.monIdMoneda === o.v ? 'bg-white text-brand-cyan shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                                                    {o.l}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <span className={labelCls}>Precio base</span>
                                        <div className="min-h-[2.25rem] flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                            <span className={`text-sm tabular-nums ${precio.sinPrecio ? 'text-slate-400' : 'font-bold text-slate-800'}`}>{precio.texto}</span>
                                            <a href="/admin/price-profiles" target="_blank" rel="noreferrer"
                                                className="inline-flex items-center gap-1 text-xs font-semibold text-brand-cyan hover:underline">
                                                Editar en Perfiles de precio <ExternalLink size={12} aria-hidden="true" />
                                            </a>
                                        </div>
                                    </div>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label htmlFor="art-unidad" className={labelCls}>Unidad</label>
                                        <select id="art-unidad" name="uniIdUnidad" value={form.uniIdUnidad} onChange={handleChange} className={selectCls}
                                            aria-describedby="art-unidad-ayuda">
                                            <option value="">Sin definir</option>
                                            {unidades.map(u => (
                                                <option key={u.UniIdUnidad} value={u.UniIdUnidad}>{u.Descripcion}{u.Notacion ? ` (${u.Notacion})` : ''}</option>
                                            ))}
                                        </select>
                                        <p id="art-unidad-ayuda" className={helpCls}>Cómo se cuenta en producción: por piezas o por metros.</p>
                                    </div>
                                    <div>
                                        <label htmlFor="art-ancho" className={labelCls}>Ancho imprimible (m)</label>
                                        <input id="art-ancho" type="number" step="0.01" min="0" name="anchoImprimible" value={form.anchoImprimible} onChange={handleChange}
                                            className={inputCls} placeholder="1.60" />
                                    </div>
                                    <div>
                                        <label htmlFor="art-largo" className={labelCls}>Largo fijo (m)</label>
                                        <input id="art-largo" type="number" step="0.01" min="0" name="largoImprimible" value={form.largoImprimible} onChange={handleChange}
                                            className={inputCls} placeholder="Opcional" aria-describedby="art-largo-ayuda" />
                                        <p id="art-largo-ayuda" className={helpCls}>Si se carga, el portal exige esa medida exacta (ej: banderas).</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 pt-1">
                                    <Switch checked={form.llevaPapel} onChange={v => setForm(p => ({ ...p, llevaPapel: v }))} labelledBy="lbl-papel" onClass="bg-brand-cyan" />
                                    <span id="lbl-papel" className="text-sm font-semibold text-slate-700">Lleva papel</span>
                                </div>
                            </Seccion>

                            {showProductoTerminado && (
                                <Seccion icon={Box} titulo="Producto terminado" extra={ptDirty && (
                                    <span className="ml-1 inline-flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500" aria-hidden="true" /> Sin guardar
                                    </span>
                                )}>
                                    <p className={`${helpCls} -mt-2`}>Dimensiones fijas y terminaciones que ya incluye el precio. Se guardan con Guardar cambios.</p>
                                    <div>
                                        <label htmlFor="pt-material" className={labelCls}>Material de impresión</label>
                                        <select id="pt-material" value={ptMaterial}
                                            onChange={e => { setPtMaterial(e.target.value); setPtDirty(true); }}
                                            className={selectCls} aria-describedby="pt-material-ayuda">
                                            <option value="">Sin definir</option>
                                            {ptMateriales.map(m => (
                                                <option key={m.CodArticulo} value={m.CodArticulo}>{m.Descripcion}</option>
                                            ))}
                                        </select>
                                        <p id="pt-material-ayuda" className={helpCls}>Sobre qué material se imprime (ej: cuadro canvas brillo → Canvas Brillo).</p>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                        <div>
                                            <label htmlFor="pt-ancho" className={labelCls}>Ancho (m)</label>
                                            <input id="pt-ancho" type="number" step="0.01" min="0" value={ptAncho}
                                                onChange={e => { setPtAncho(e.target.value); setPtDirty(true); }}
                                                className={inputCls} placeholder="1.00" />
                                        </div>
                                        <div>
                                            <label htmlFor="pt-alto" className={labelCls}>Alto (m)</label>
                                            <input id="pt-alto" type="number" step="0.01" min="0" value={ptAlto}
                                                onChange={e => { setPtAlto(e.target.value); setPtDirty(true); }}
                                                className={inputCls} placeholder="1.00" />
                                        </div>
                                        <div>
                                            <label htmlFor="pt-borde" className={labelCls}>Borde (cm)</label>
                                            <input id="pt-borde" type="number" step="0.5" min="0" value={ptBorde}
                                                onChange={e => { setPtBorde(e.target.value); setPtDirty(true); }}
                                                className={inputCls} placeholder="3" title="Demasía por lado (envuelve bastidor / dobladillo)" />
                                        </div>
                                        <div>
                                            <label htmlFor="pt-tinta" className={labelCls}>Tinta</label>
                                            <select id="pt-tinta" value={ptTinta}
                                                onChange={e => { setPtTinta(e.target.value); setPtDirty(true); }}
                                                className={selectCls}>
                                                <option value="">Sin definir</option>
                                                <option value="Ecosolvente">Ecosolvente</option>
                                                <option value="UV">UV</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div>
                                        <span className={labelCls}>Terminaciones incluidas</span>
                                        {termCatalogo.length === 0 ? (
                                            <p className="text-xs text-slate-400 italic">Cargando catálogo...</p>
                                        ) : (
                                            <div className="flex flex-wrap gap-2">
                                                {termCatalogo.map(t => {
                                                    const v = ptTerms[t.TerminacionID];
                                                    const active = v != null;
                                                    const ubicacionesT = (t.Ubicaciones || '').split(',').map(x => x.trim()).filter(Boolean);
                                                    return (
                                                        <div key={t.TerminacionID} className={`inline-flex items-center rounded-full border transition-colors overflow-hidden ${active
                                                            ? 'bg-brand-cyan border-brand-cyan text-white'
                                                            : 'bg-white border-slate-200 text-slate-600 hover:border-brand-cyan/40'}`}>
                                                            <button type="button" onClick={() => togglePtTerminacion(t.TerminacionID)} aria-pressed={active}
                                                                className="px-3 py-1.5 text-xs font-bold inline-flex items-center gap-1.5">
                                                                {active && <Check size={12} aria-hidden="true" />}
                                                                {t.Nombre}
                                                            </button>
                                                            {active && ubicacionesT.length > 0 && (
                                                                <select value={v.ubicacion || ''}
                                                                    onChange={e => setPtUbicacion(t.TerminacionID, e.target.value)}
                                                                    onClick={e => e.stopPropagation()}
                                                                    className="text-[11px] font-bold text-brand-cyan bg-white rounded-full px-1.5 py-1 mr-1 outline-none max-w-[110px]"
                                                                    aria-label={`Ubicación de ${t.Nombre}`} title="Ubicación">
                                                                    <option value="">Ubicación...</option>
                                                                    {UBICACIONES_PT.filter(u => ubicacionesT.includes(u.v)).map(u => (
                                                                        <option key={u.v} value={u.v}>{u.l}</option>
                                                                    ))}
                                                                </select>
                                                            )}
                                                            {active && (
                                                                <input type="number" min="0.5" step="0.5" value={v.cantidad}
                                                                    onChange={e => setPtCantidad(t.TerminacionID, e.target.value)}
                                                                    onClick={e => e.stopPropagation()}
                                                                    className="w-14 px-1.5 py-1 mr-1 text-xs font-black text-brand-cyan bg-white rounded-full outline-none text-center"
                                                                    aria-label={`Cantidad incluida de ${t.Nombre}`} title="Cantidad incluida" />
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                </Seccion>
                            )}
                        </div>

                        {/* Columna derecha: foto, fotos por color y WMS */}
                        <div className="w-full lg:w-64 shrink-0 space-y-5">
                            <div>
                                <span className={labelCls}>Foto</span>
                                {isNew ? (
                                    <div className="aspect-square rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center gap-2 text-center p-6 text-slate-400">
                                        <ImageIcon size={28} aria-hidden="true" />
                                        <p className="text-xs">Creá el artículo para poder subirle fotos.</p>
                                    </div>
                                ) : (
                                    <>
                                        <button type="button" onClick={() => fileInputRef.current?.click()}
                                            aria-label={imagePreview ? 'Cambiar foto' : 'Subir foto'}
                                            className="group relative w-full aspect-square rounded-xl border-2 border-dashed border-slate-300 hover:border-brand-cyan/60 bg-slate-50 overflow-hidden flex items-center justify-center transition-colors">
                                            {imagePreview ? (
                                                <>
                                                    <img src={imagePreview} alt="" className="absolute inset-0 w-full h-full object-cover" />
                                                    <span className="absolute inset-x-0 bottom-0 bg-slate-900/75 text-white text-xs font-semibold py-2 inline-flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity">
                                                        <Camera size={14} aria-hidden="true" /> Cambiar foto
                                                    </span>
                                                </>
                                            ) : (
                                                <span className="flex flex-col items-center gap-1.5">
                                                    <CloudUpload size={28} className="text-brand-cyan" aria-hidden="true" />
                                                    <span className="text-sm font-semibold text-slate-600">Subir foto</span>
                                                    <span className="text-[11px] text-slate-400">PNG, JPG o WEBP</span>
                                                </span>
                                            )}
                                        </button>
                                        <input type="file" ref={fileInputRef} onChange={handleImageChange} accept="image/*" className="hidden" />
                                        {imageFile && <p className={helpCls}>La foto nueva se sube al guardar.</p>}
                                    </>
                                )}
                            </div>

                            {/* Imágenes por color (solo edición: necesita el ProIdProducto) */}
                            {!isNew && (
                                <div>
                                    <span className={labelCls}>Fotos por color</span>
                                    <p className={`${helpCls} mt-0 mb-2`}>
                                        La tienda muestra la foto del color que aparezca en el nombre de la variante elegida
                                        (ej: "Short 14 ROJO" usa la foto ROJO).
                                    </p>
                                    {colorImages.length > 0 && (
                                        <div className="flex flex-wrap gap-2 mb-2">
                                            {colorImages.map(ci => (
                                                <div key={ci.color} className="flex items-center gap-2 border border-slate-200 rounded-lg p-1 pr-1.5 bg-white">
                                                    <img src={ci.url_imagen} alt={ci.color} className="w-8 h-8 rounded-md object-cover bg-slate-100" />
                                                    <span className="text-[11px] font-bold text-slate-600 uppercase">{ci.color}</span>
                                                    <button type="button" onClick={() => borrarImagenColor(ci.color)} title="Quitar" aria-label={`Quitar la foto ${ci.color}`}
                                                        className="w-6 h-6 rounded-md hover:bg-red-500/10 hover:text-red-500 text-slate-400 flex items-center justify-center transition-colors">
                                                        <X size={12} aria-hidden="true" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex gap-2">
                                        <input value={colorNuevo} onChange={e => setColorNuevo(e.target.value)} placeholder="Color (ej: ROJO)"
                                            aria-label="Color de la foto" className={inputCls} />
                                        <button type="button"
                                            onClick={() => colorNuevo.trim() ? colorFileRef.current?.click() : toast.error('Escribí el color primero (ej: ROJO)')}
                                            className="h-10 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold whitespace-nowrap transition-colors inline-flex items-center gap-1.5">
                                            <Upload size={14} aria-hidden="true" /> Subir
                                        </button>
                                        <input type="file" ref={colorFileRef} accept="image/*" className="hidden"
                                            onChange={e => { const f = e.target.files[0]; if (f) subirImagenColor(f); e.target.value = ''; }} />
                                    </div>
                                </div>
                            )}

                            {/* WMS: solo lectura */}
                            <div className="rounded-xl border border-slate-200 p-3">
                                <p className="text-xs font-semibold text-slate-600 flex items-center gap-1.5 mb-1.5">
                                    <Link2 size={14} className="text-brand-cyan" aria-hidden="true" /> WMS
                                </p>
                                {form.producto_maestro_id ? (
                                    <p className="text-sm font-semibold text-slate-800 break-words">{wmsSearch || `Producto #${form.producto_maestro_id}`}</p>
                                ) : (
                                    <p className="text-sm text-slate-400">Sin vincular</p>
                                )}
                                {wmsVariants.length > 0 && (
                                    <div className="mt-2">
                                        <p className="text-[11px] font-semibold text-slate-500 mb-1">
                                            {wmsVariants.length} {wmsVariants.length === 1 ? 'variante' : 'variantes'}
                                        </p>
                                        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto pr-1">
                                            {wmsVariants.map(v => (
                                                <span key={v.variante_id} className="px-2 py-0.5 rounded-md bg-brand-cyan/10 text-brand-cyan text-[11px] font-semibold">
                                                    {v.nombre_variante || v.codigo_variante}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <p className={helpCls}>Solo lectura. El stock se lee del WMS.</p>
                            </div>
                        </div>
                    </div>
                </form>

                {/* Footer */}
                <div className="flex items-center justify-between gap-3 px-6 py-4 bg-slate-50 border-t border-slate-100 shrink-0">
                    <p className="text-xs font-semibold text-slate-500 flex items-center gap-2" aria-live="polite">
                        {dirty && (<><span className="w-2 h-2 rounded-full bg-amber-500" aria-hidden="true" /> Cambios sin guardar</>)}
                    </p>
                    <div className="flex gap-2">
                        <button type="button" onClick={intentarCerrar} className="h-10 px-5 font-semibold text-slate-600 hover:bg-slate-200 rounded-lg transition-colors">Cancelar</button>
                        <button type="submit" form="edit-form" disabled={saving}
                            className="h-10 px-6 bg-brand-cyan hover:bg-brand-cyan/90 text-white rounded-lg font-semibold shadow-sm transition-colors disabled:opacity-60 flex items-center gap-2">
                            {saving && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
                            {isNew ? 'Crear artículo' : 'Guardar cambios'}
                        </button>
                    </div>
                </div>

                {/* Confirmación para descartar cambios */}
                {confirmDiscard && (
                    <div className="absolute inset-0 z-10 bg-slate-900/40 flex items-center justify-center p-6"
                        role="alertdialog" aria-modal="true" aria-labelledby="descartar-titulo" aria-describedby="descartar-texto">
                        <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-5">
                            <h3 id="descartar-titulo" className="text-base font-bold text-slate-800">¿Descartar los cambios?</h3>
                            <p id="descartar-texto" className="text-sm text-slate-500 mt-1">Lo que modificaste en este artículo no se va a guardar.</p>
                            <div className="flex justify-end gap-2 mt-5">
                                <button type="button" autoFocus onClick={() => setConfirmDiscard(false)}
                                    className="h-9 px-4 rounded-lg font-semibold text-slate-600 hover:bg-slate-100 transition-colors">Seguir editando</button>
                                <button type="button" onClick={onClose}
                                    className="h-9 px-4 rounded-lg font-semibold text-white bg-red-500 hover:bg-red-500/90 transition-colors">Descartar</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

// ─── Componente de Tarjeta de Artículo (Modern Card) ──────────────────────────

// ─── Modal de Precios por Variante (SOLO LECTURA) ──────────────────────────────
const VariantPriceModal = ({ art, onClose }) => {
    const [variants, setVariants] = React.useState([]);
    const [loading, setLoading]   = React.useState(true);

    React.useEffect(() => {
        api.get(`/products-integration/article-variants/${art.ProIdProducto}`)
            .then(res => {
                if (res.data.success) setVariants(res.data.data);
            })
            .catch(() => toast.error('Error al cargar variantes'))
            .finally(() => setLoading(false));
    }, [art.ProIdProducto]);

    const basePrice = art.PrecioBase != null ? parseFloat(art.PrecioBase) : null;
    const baseMoneda = art.MonIdMoneda === 2 ? 'USD' : 'UYU';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <span className="bg-brand-cyan/10 text-brand-cyan text-xs font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">Solo lectura</span>
                        </div>
                        <h2 className="text-xl font-black text-slate-800">{art.Descripcion?.trim()}</h2>
                        <p className="text-sm text-slate-500 mt-0.5">
                            Precio base:
                            <span className="font-bold text-slate-700 ml-1">
                                {basePrice != null ? `${baseMoneda === 'USD' ? 'U$S' : '$'} ${basePrice.toFixed(2)}` : 'Sin precio'}
                            </span>
                            <span className="ml-2 text-xs text-brand-cyan">— Para editar precios ir a Gestión de Precios › Precios x Variante</span>
                        </p>
                    </div>
                    <button onClick={onClose} aria-label="Cerrar" className="w-9 h-9 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 transition-colors">
                        <X size={18} aria-hidden="true" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-16 text-slate-400">
                            <LoaderCircle size={30} className="animate-spin" aria-hidden="true" />
                        </div>
                    ) : variants.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                            <Layers size={48} className="mb-3 text-slate-200" aria-hidden="true" />
                            <p className="font-bold">Este producto no tiene variantes WMS</p>
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {variants.map(v => {
                                const hasCustomPrice = v.precio_excepcion != null;
                                const moneda = v.moneda_excepcion === 2 ? 'U$S' : '$';
                                const precio = hasCustomPrice
                                    ? `${moneda} ${parseFloat(v.precio_excepcion).toFixed(2)}`
                                    : (basePrice != null ? `${baseMoneda === 'USD' ? 'U$S' : '$'} ${basePrice.toFixed(2)}` : 'Sin precio');
                                return (
                                    <div key={v.id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${
                                        hasCustomPrice ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-slate-200 bg-slate-50'
                                    }`}>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm font-bold text-slate-800 truncate" title={v.nombre_variante}>{v.nombre_variante}</p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            {hasCustomPrice && (
                                                <span className="text-[10px] bg-emerald-500/10 text-emerald-500 font-bold px-2 py-0.5 rounded-full">precio propio</span>
                                            )}
                                            <span className={`text-sm font-black tabular-nums ${ hasCustomPrice ? 'text-emerald-500' : 'text-slate-500' }`}>
                                                {precio}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 flex items-center gap-2 shrink-0 bg-slate-50">
                    <Info size={16} className="text-brand-cyan shrink-0" aria-hidden="true" />
                    <p className="text-xs text-slate-500">
                        Las variantes en <strong className="text-emerald-500">verde</strong> tienen precio propio.
                        Las demás usan el precio base del artículo.
                        Para editar, ir a <strong>Gestión de Precios › Precios x Variante</strong>.
                    </p>
                </div>
            </div>
        </div>
    );
};




// ─── Modal de Confirmación de Borrado ─────────────────────────────────────────
const DeleteConfirmModal = ({ art, onClose, onConfirm }) => {
    const [deleting, setDeleting] = React.useState(false);
    const [texto, setTexto] = React.useState('');
    // Hay que escribir la palabra para habilitar el borrado; vale "eliminar" o "ELIMINAR".
    const confirmado = texto.trim().toLowerCase() === 'eliminar';

    const handleConfirm = async () => {
        if (!confirmado || deleting) return;
        setDeleting(true);
        try {
            await onConfirm(art);
        } finally {
            setDeleting(false);
        }
    };

    const cerrar = () => { if (!deleting) onClose(); };

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') cerrar(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    });

    return (
        <div className="fixed inset-0 bg-slate-900/60 z-[60] flex items-center justify-center p-4" onClick={cerrar}>
            <div role="alertdialog" aria-modal="true" aria-labelledby="borrar-titulo" aria-describedby="borrar-texto"
                className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="p-6 flex flex-col items-center text-center">
                    <div className="w-14 h-14 rounded-full bg-red-500/10 text-red-500 flex items-center justify-center mb-4">
                        <TriangleAlert size={26} aria-hidden="true" />
                    </div>
                    <h2 id="borrar-titulo" className="text-lg font-black text-slate-800">¿Eliminar este artículo?</h2>
                    <p id="borrar-texto" className="text-sm text-slate-500 mt-2">
                        Estás por eliminar <strong className="text-slate-700">{art?.Descripcion?.trim() || art?.CodArticulo?.trim()}</strong>.
                        Esta acción no se puede deshacer.
                    </p>
                    <p className="text-[11px] text-slate-400 mt-2">
                        Si el producto ya se usó en pedidos u órdenes, el sistema lo va a impedir.
                    </p>
                    <div className="w-full mt-5 text-left">
                        <label htmlFor="borrar-confirmacion" className="block text-xs font-semibold text-slate-600 mb-1.5">
                            Para confirmar, escribí <span className="font-bold text-red-500">ELIMINAR</span>
                        </label>
                        <input
                            id="borrar-confirmacion"
                            value={texto}
                            onChange={e => setTexto(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleConfirm(); } }}
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                            disabled={deleting}
                            className="w-full h-10 px-3 border border-slate-300 rounded-lg text-sm bg-white outline-none focus:border-red-500 focus:ring-4 focus:ring-red-500/10 transition disabled:bg-slate-50"
                        />
                    </div>
                </div>
                <div className="flex gap-3 p-4 bg-slate-50 border-t border-slate-100">
                    <button type="button" onClick={cerrar} disabled={deleting}
                        className="flex-1 px-4 py-2.5 font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-xl transition disabled:opacity-60">
                        Cancelar
                    </button>
                    <button type="button" onClick={handleConfirm} disabled={!confirmado || deleting}
                        className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-500/90 text-white rounded-xl font-bold shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-red-500 flex items-center justify-center gap-2">
                        {deleting && <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />}
                        {deleting ? 'Eliminando...' : 'Sí, eliminar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

// Menú "⋯" de la tarjeta: acciones secundarias y el borrado, lejos del botón Editar.
const CardMenu = ({ art, onVariants, onDelete }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    const tieneVariantes = art.CantidadVariantes > 0;

    useEffect(() => {
        if (!open) return;
        const cerrarAfuera = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        const cerrarConEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', cerrarAfuera);
        document.addEventListener('keydown', cerrarConEsc);
        return () => {
            document.removeEventListener('mousedown', cerrarAfuera);
            document.removeEventListener('keydown', cerrarConEsc);
        };
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                aria-label="Más acciones"
                aria-haspopup="menu"
                aria-expanded={open}
                className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${open ? 'bg-slate-200 text-slate-700' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'}`}
            >
                <Ellipsis size={16} aria-hidden="true" />
            </button>
            {open && (
                <div role="menu" className="absolute right-0 top-full mt-1 z-20 w-max min-w-[8rem] bg-white border border-slate-200 rounded-lg shadow-lg p-1">
                    {tieneVariantes && (
                        <>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setOpen(false); onVariants(art); }}
                                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm font-medium whitespace-nowrap text-slate-700 hover:bg-slate-100 transition-colors"
                            >
                                <Tag size={15} className="text-emerald-500" aria-hidden="true" /> Precios por variante
                            </button>
                            <div className="my-1 border-t border-slate-100" />
                        </>
                    )}
                    <button
                        type="button"
                        role="menuitem"
                        onClick={() => { setOpen(false); onDelete(art); }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm font-medium whitespace-nowrap text-red-500 hover:bg-red-500/10 transition-colors"
                    >
                        <Trash2 size={15} aria-hidden="true" /> Eliminar
                    </button>
                </div>
            )}
        </div>
    );
};

const Chip = ({ children, className = 'bg-slate-100 text-slate-600', title }) => (
    <span title={title} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${className}`}>
        {children}
    </span>
);

// Tarjeta compacta: solo muestra los datos que tienen valor (nada de "0" ni "No").
const ArticleCard = ({ art, onEdit, onVariants, onDelete, showImages }) => {
    const nombre = art.Descripcion?.trim() || art.CodArticulo?.trim() || 'Sin nombre';
    const precio = precioDe(art);
    const oculto = esOculto(art);
    const ancho = Number(art.anchoimprimible) || 0;
    const largo = Number(art.largoimprimible) || 0;
    const variantes = Number(art.CantidadVariantes) || 0;
    const stock = Number(art.StockWMS) || 0;
    const vinculadoWms = art.producto_maestro_id != null;

    return (
        <div className="bg-white rounded-xl border border-slate-200 hover:border-brand-cyan/40 hover:shadow-sm transition flex flex-col">
            {showImages && (
                <div className="h-36 bg-slate-100 rounded-t-xl overflow-hidden shrink-0">
                    {art.url_imagen ? (
                        <img src={art.url_imagen} alt={nombre} loading="lazy" className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-300">
                            <ImageIcon size={28} aria-hidden="true" />
                            <span className="text-[11px] font-semibold">Sin foto</span>
                        </div>
                    )}
                </div>
            )}

            <div className="p-3 flex flex-col gap-2.5 flex-1">
                <div className="flex items-start justify-between gap-3">
                    <h4 className="text-sm font-semibold text-slate-800 leading-snug line-clamp-2" title={nombre}>
                        {nombre}
                    </h4>
                    <span className={`text-sm tabular-nums whitespace-nowrap ${precio.sinPrecio ? 'text-slate-400 font-medium' : 'text-slate-700 font-semibold'}`}>
                        {precio.texto}
                    </span>
                </div>

                {(ancho > 0 || variantes > 0 || vinculadoWms || art.LLEVAPAPEL || stock > 0) && (
                    <div className="flex flex-wrap gap-1.5">
                        {ancho > 0 && (
                            <Chip title={largo > 0 ? 'Medida fija' : 'Ancho imprimible'}>
                                {largo > 0 ? `${fmt2(ancho)} × ${fmt2(largo)} m` : `${fmt2(ancho)} m`}
                            </Chip>
                        )}
                        {variantes > 0 && <Chip>{variantes} {variantes === 1 ? 'variante' : 'variantes'}</Chip>}
                        {vinculadoWms && (
                            <Chip className="bg-brand-cyan/10 text-brand-cyan" title={`Vinculado al producto #${art.producto_maestro_id} del WMS`}>
                                <Link2 size={12} aria-hidden="true" /> WMS
                            </Chip>
                        )}
                        {!!art.LLEVAPAPEL && <Chip>Lleva papel</Chip>}
                        {stock > 0 && <Chip className="bg-emerald-500/10 text-emerald-500">Stock {stock}</Chip>}
                    </div>
                )}

                <div className="mt-auto pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
                    {oculto ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500">
                            <EyeOff size={13} aria-hidden="true" /> Oculto
                        </span>
                    ) : <span />}
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={() => onEdit(art)}
                            className="h-8 px-3 inline-flex items-center gap-1.5 rounded-lg text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors"
                        >
                            <Pencil size={13} aria-hidden="true" /> Editar
                        </button>
                        <CardMenu art={art} onVariants={onVariants} onDelete={onDelete} />
                    </div>
                </div>
            </div>
        </div>
    );
};

// ─── Componente Principal ─────────────────────────────────────────────────────
const ProductsIntegration = () => {
    const [articles, setArticles] = useState([]);
    const [loading, setLoading]   = useState(false);
    const [search, setSearch]     = useState('');
    const [editing, setEditing]   = useState(null);
    const [selectedNode, setSelectedNode] = useState('all'); // 'all', 'sup||X', 'grp||X||Y'
    const [expanded, setExpanded] = useState({});

    // UI States
    const [showImages, setShowImages] = useState(false);
    const [filterStatus, setFilterStatus] = useState('active'); // 'active', 'all', 'inactive'
    const [filterType, setFilterType] = useState('all'); // 'all', 'products', 'services'
    const [sortBy, setSortBy] = useState('name_asc');

    // WMS Importer states
    const [wmsMasters, setWmsMasters] = useState([]);
    const [wmsSearchInput, setWmsSearchInput] = useState('');
    const [importingId, setImportingId] = useState(null);
    const [variantArt, setVariantArt] = useState(null); // artículo para el modal de precios por variante
    const [deletingArt, setDeletingArt] = useState(null); // artículo pendiente de confirmar borrado

    useEffect(() => {
        api.get('/products-integration/wms/masters')
            .then(res => { if (res.data?.success) setWmsMasters(res.data.data); })
            .catch(err => console.error('Error fetching WMS Masters:', err));
    }, []);


    const load = useCallback(() => {
        setLoading(true);
        api.get('/products-integration/local')
            .then(res => setArticles(res.data))
            .catch(() => toast.error('Error al cargar artículos'))
            .finally(() => setLoading(false));
    }, []);

    const handleImportWms = async (id) => {
        setImportingId(id);
        try {
            const res = await api.post(`/products-integration/wms/import/${id}`);
            if (res.data.success) {
                toast.success('Producto importado exitosamente');
                load();
            } else {
                toast.error(res.data.message || 'Error al importar');
            }
        } catch (error) {
            toast.error(error.response?.data?.message || 'Error en el servidor');
        } finally {
            setImportingId(null);
        }
    };

    const handleDelete = async (art) => {
        try {
            await api.delete(`/products-integration/${art.ProIdProducto}`);
            toast.success('Artículo eliminado');
            setArticles(prev => prev.filter(a => a.ProIdProducto !== art.ProIdProducto));
            setDeletingArt(null);
        } catch (err) {
            // 409 = producto en uso; mostramos el motivo devuelto por el backend
            toast.error(err.response?.data?.error || 'Error al eliminar el artículo');
        }
    };

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (articles.length > 0) {
            const all = {};
            articles.forEach(a => {
                const sup = (a.SupFlia || '').trim() || '(Sin Familia)';
                all[`sup||${sup}`] = true;
            });
            setExpanded(all);
        }
    }, [articles]);

    const toggle = (key, e) => {
        if(e) e.stopPropagation();
        setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
    };

    // Árbol SupFlia → Grupo
    const tree = useMemo(() => {
        const supMap = {};
        articles.forEach(a => {
            const sup = (a.SupFlia  || '').trim() || '(Sin Familia)';
            const grp = (a.Grupo    || '').trim() || '(Sin Grupo)';

            if (!supMap[sup]) supMap[sup] = { count: 0, grupos: {} };
            supMap[sup].count++;
            
            if (!supMap[sup].grupos[grp]) {
                supMap[sup].grupos[grp] = { 
                    nombre: a.DescripcionGrupo || '', 
                    count: 0 
                };
            }
            supMap[sup].grupos[grp].count++;
        });
        return supMap;
    }, [articles]);

    const handleSaved = (formData) => {
        setArticles(prev => {
            const idx = prev.findIndex(a => a.CodArticulo?.trim() === formData.codArticulo.trim());
            if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = {
                    ...updated[idx],
                    Descripcion:     formData.descripcion,
                    CodStock:        formData.codStock,
                    Grupo:           formData.grupo,
                    SupFlia:         formData.supFlia,
                    Mostrar:         formData.mostrar ? 1 : 0,
                    anchoimprimible: parseFloat(formData.anchoImprimible) || 0,
                    largoimprimible: parseFloat(formData.largoImprimible) || null,
                    UniIdUnidad:     formData.uniIdUnidad !== '' ? parseInt(formData.uniIdUnidad) : null,
                    LLEVAPAPEL:      formData.llevaPapel ? 1 : 0,
                    MonIdMoneda:     formData.monIdMoneda !== '' ? parseInt(formData.monIdMoneda) : null,
                    producto_maestro_id: formData.producto_maestro_id !== '' ? parseInt(formData.producto_maestro_id) : null,
                    url_imagen:      formData.url_imagen || updated[idx].url_imagen
                };
                return updated;
            }
            load(); return prev;
        });
        setEditing(null);
    };

    const supKeys = Object.keys(tree).sort();

    // Filtros de tipo, texto y árbol. La visibilidad va aparte para poder contar los ocultos
    // del mismo alcance y mostrarlos en el botón "Ocultos".
    const scopedArticles = useMemo(() => {
        let list = articles;

        // Filtro por tipo (Productos = SupFlia 2, Servicios = SupFlia 1)
        if (filterType === 'products') {
            list = list.filter(a => (a.SupFlia || '').trim() === '2');
        } else if (filterType === 'services') {
            list = list.filter(a => (a.SupFlia || '').trim() === '1');
        }

        // Filtro por texto
        const s = search.toLowerCase().trim();
        if (s) {
            list = list.filter(a =>
                (a.CodArticulo || '').toLowerCase().includes(s) ||
                (a.Descripcion || '').toLowerCase().includes(s) ||
                String(a.ProIdProducto || '').includes(s) ||
                String(a.IDProdReact  || '').includes(s) ||
                (a.CodStock || '').toLowerCase().includes(s)
            );
        }

        // Filtro por sidebar
        if (selectedNode !== 'all') {
            const parts = selectedNode.split('||');
            if (parts[0] === 'sup') {
                list = list.filter(a => (a.SupFlia || '').trim() === parts[1]);
            } else if (parts[0] === 'grp') {
                list = list.filter(a => (a.SupFlia || '').trim() === parts[1] && (a.Grupo || '').trim() === parts[2]);
            }
        }

        return list;
    }, [articles, search, selectedNode, filterType]);

    const hiddenCount = useMemo(() => scopedArticles.filter(esOculto).length, [scopedArticles]);

    // Filtro para el Grid Principal
    const displayArticles = useMemo(() => {
        let list = scopedArticles;

        if (filterStatus === 'active') list = list.filter(a => !esOculto(a));
        else if (filterStatus === 'inactive') list = list.filter(esOculto);

        // Ordenamiento
        list = [...list].sort((a, b) => {
            if (sortBy === 'name_asc') return (a.Descripcion || '').localeCompare(b.Descripcion || '');
            if (sortBy === 'name_desc') return (b.Descripcion || '').localeCompare(a.Descripcion || '');
            if (sortBy === 'price_asc') return (parseFloat(a.PrecioBase) || 0) - (parseFloat(b.PrecioBase) || 0);
            if (sortBy === 'price_desc') return (parseFloat(b.PrecioBase) || 0) - (parseFloat(a.PrecioBase) || 0);
            return 0;
        });

        return list;
    }, [scopedArticles, filterStatus, sortBy]);

    const selectedTitle = selectedNode === 'all'
        ? 'Todos los artículos'
        : selectedNode.startsWith('sup')
            ? nombreFamilia(selectedNode.split('||')[1])
            : (() => {
                const [, sup, grp] = selectedNode.split('||');
                const nombre = tree[sup]?.grupos[grp]?.nombre;
                return nombre ? `${grp} · ${nombre}` : `Grupo ${grp}`;
            })();

    const segBtn = (activo) => `px-3 py-1.5 rounded-md transition-colors inline-flex items-center gap-1.5 ${activo ? 'bg-white text-brand-cyan shadow-sm' : 'text-slate-500 hover:text-slate-700'}`;

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
            {/* Header */}
            <div className="p-5 bg-white border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm z-10 shrink-0">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-brand-cyan rounded-2xl flex items-center justify-center text-white shadow-sm">
                        <PackageOpen size={24} aria-hidden="true" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-slate-800 tracking-tight">Catálogo y WMS</h1>
                        <p className="text-sm font-semibold text-slate-400">
                            Gestiona productos y vinculaciones desde un solo lugar.
                        </p>
                    </div>
                </div>

                <div className="flex gap-2">
                    <button onClick={load} className="px-3 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors" title="Recargar" aria-label="Recargar">
                        <RotateCw size={16} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
                    </button>
                    <button onClick={() => setEditing({})} className="flex items-center gap-2 px-5 py-2.5 bg-brand-cyan hover:bg-brand-cyan/90 text-white rounded-xl text-sm font-bold shadow-sm transition-colors">
                        <Plus size={16} aria-hidden="true" /> Nuevo
                    </button>
                </div>
            </div>

            {/* Layout a 2 columnas */}
            <div className="flex-1 flex overflow-hidden">
                
                {/* Sidebar */}
                <div className="w-80 bg-white border-r border-slate-200 flex flex-col h-full shrink-0">
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                        <h2 className="font-bold text-slate-800 text-sm">Categorías</h2>
                        <span className="bg-slate-100 text-slate-500 text-[11px] font-bold px-2 py-1 rounded-md">{supKeys.length} {supKeys.length === 1 ? 'familia' : 'familias'}</span>
                    </div>

                    <div className="p-4 border-b border-slate-100">
                        <div className="relative">
                            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                            <input className="w-full pl-8 pr-3 py-2 border border-slate-200 bg-slate-50 rounded-lg text-sm outline-none focus:border-brand-cyan focus:bg-white transition-all"
                                placeholder="Filtrar productos..."
                                aria-label="Filtrar productos"
                                value={search} onChange={e => setSearch(e.target.value)} />
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
                        {/* Boton "Todos los productos" */}
                        <div
                            className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${selectedNode === 'all' ? 'bg-brand-cyan text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                            onClick={() => setSelectedNode('all')}
                        >
                            <div className="flex items-center gap-3">
                                <Globe size={16} className="opacity-80" aria-hidden="true" />
                                <span className="text-sm font-bold">Todos los productos</span>
                            </div>
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md tabular-nums ${selectedNode === 'all' ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{articles.length}</span>
                        </div>

                        {/* Arbol */}
                        {supKeys.map(sup => {
                            const supKey = `sup||${sup}`;
                            const isSelected = selectedNode === supKey;
                            const isExpanded = !!expanded[supKey];
                            const grpKeys = Object.keys(tree[sup].grupos).sort();

                            return (
                                <div key={supKey} className="mt-2">
                                    <div
                                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${isSelected ? 'bg-brand-cyan text-white' : 'text-slate-700 hover:bg-slate-100'}`}
                                        onClick={() => setSelectedNode(supKey)}
                                    >
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <button
                                                type="button"
                                                onClick={(e) => toggle(supKey, e)}
                                                aria-label={isExpanded ? 'Contraer grupos' : 'Expandir grupos'}
                                                aria-expanded={isExpanded}
                                                className={`shrink-0 ${isSelected ? 'text-white/90' : 'text-amber-400'}`}
                                            >
                                                {isExpanded ? <FolderOpen size={16} aria-hidden="true" /> : <Folder size={16} aria-hidden="true" />}
                                            </button>
                                            <span className="text-sm font-bold truncate">{nombreFamilia(sup)}</span>
                                        </div>
                                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-md shrink-0 tabular-nums ${isSelected ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'}`}>{tree[sup].count}</span>
                                    </div>

                                    {/* Grupos */}
                                    {isExpanded && (
                                        <div className="ml-5 mt-1 border-l-2 border-slate-100 pl-2 space-y-1">
                                            {grpKeys.map(grp => {
                                                const grpKey = `grp||${sup}||${grp}`;
                                                const isGrpSelected = selectedNode === grpKey;
                                                const gInfo = tree[sup].grupos[grp];
                                                const gLabel = gInfo.nombre ? `${grp} - ${gInfo.nombre}` : grp;

                                                return (
                                                    <div 
                                                        key={grpKey} 
                                                        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${isGrpSelected ? 'bg-brand-cyan/10 text-brand-cyan font-bold' : 'text-slate-600 hover:bg-slate-100'}`}
                                                        onClick={() => setSelectedNode(grpKey)}
                                                    >
                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                            <Folder size={13} className={`shrink-0 ${isGrpSelected ? 'text-brand-cyan' : 'text-amber-400'}`} aria-hidden="true" />
                                                            <span className="text-xs truncate" title={gLabel}>{gLabel}</span>
                                                        </div>
                                                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md shrink-0 tabular-nums ${isGrpSelected ? 'bg-brand-cyan/15 text-brand-cyan' : 'bg-slate-100 text-slate-500'}`}>{gInfo.count}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Main Content (Grid) */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50 custom-scrollbar">
                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-full text-slate-400">
                            <LoaderCircle size={40} className="animate-spin mb-4 text-brand-cyan" aria-hidden="true" />
                            <p className="font-bold">Cargando catálogo...</p>
                        </div>
                    ) : (
                        <div>
                            {/* Barra de filtros SIEMPRE visible */}
                            <div className="mb-5 bg-white p-4 rounded-xl border border-slate-200 flex flex-col gap-4">
                                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                                    <h2 className="text-lg font-bold text-slate-800">{selectedTitle}</h2>
                                    <span className="bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1.5 rounded-lg tabular-nums">{displayArticles.length} {displayArticles.length === 1 ? 'resultado' : 'resultados'}</span>
                                </div>

                                <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-slate-100">
                                    <div className="relative flex-1 min-w-[250px] max-w-md">
                                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                                        <input className="w-full pl-9 pr-3 py-2 border border-slate-200 bg-slate-50 hover:bg-white rounded-lg text-sm outline-none focus:border-brand-cyan focus:bg-white transition-all"
                                            placeholder="Buscar por nombre o código"
                                            aria-label="Buscar artículo"
                                            value={search} onChange={e => setSearch(e.target.value)} />
                                    </div>

                                    <div className="flex flex-wrap items-center gap-4">
                                        <div className="flex items-center gap-2">
                                            <ArrowUpDown size={15} className="text-slate-400" aria-hidden="true" />
                                            <OrdenSelect value={sortBy} onChange={setSortBy} />
                                        </div>

                                        <div className="flex items-center gap-4 border-l border-slate-200 pl-4">
                                            <label className="flex items-center gap-2 cursor-pointer group">
                                                <div className="relative flex items-center justify-center">
                                                    <input type="checkbox" checked={showImages} onChange={e => setShowImages(e.target.checked)} className="peer sr-only" />
                                                    <div className="w-8 h-5 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-cyan"></div>
                                                </div>
                                                <span className="text-xs font-bold text-slate-600 group-hover:text-slate-800">Fotos</span>
                                            </label>

                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-slate-500">Tipo:</span>
                                                <div role="group" aria-label="Tipo" className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-bold">
                                                    <button type="button" aria-pressed={filterType === 'all'} onClick={() => setFilterType('all')} className={segBtn(filterType === 'all')}>Todos</button>
                                                    <button type="button" aria-pressed={filterType === 'services'} onClick={() => setFilterType('services')} className={segBtn(filterType === 'services')}>Servicios</button>
                                                    <button type="button" aria-pressed={filterType === 'products'} onClick={() => setFilterType('products')} className={segBtn(filterType === 'products')}>Productos</button>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <span className="text-xs font-bold text-slate-500">Estado:</span>
                                                <div role="group" aria-label="Estado" className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-bold">
                                                    <button type="button" aria-pressed={filterStatus === 'active'} onClick={() => setFilterStatus('active')} className={segBtn(filterStatus === 'active')}>Visibles</button>
                                                    <button type="button" aria-pressed={filterStatus === 'all'} onClick={() => setFilterStatus('all')} className={segBtn(filterStatus === 'all')}>Todos</button>
                                                    <button type="button" aria-pressed={filterStatus === 'inactive'} onClick={() => setFilterStatus('inactive')} className={segBtn(filterStatus === 'inactive')}>
                                                        <EyeOff size={13} aria-hidden="true" /> Ocultos
                                                        <span className={`tabular-nums px-1.5 rounded ${filterStatus === 'inactive' ? 'bg-brand-cyan/10' : 'bg-slate-200 text-slate-600'}`}>{hiddenCount}</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* WMS Importer — solo visible al filtrar Productos */}
                            {filterType === 'products' && (
                                <div className="mb-5 bg-brand-cyan/5 p-5 rounded-xl border border-brand-cyan/20">
                                    <div className="flex items-center gap-3 mb-4">
                                        <div className="w-8 h-8 bg-brand-cyan rounded-lg flex items-center justify-center text-white shrink-0">
                                            <CloudDownload size={16} aria-hidden="true" />
                                        </div>
                                        <div>
                                            <h3 className="text-sm font-bold text-slate-800">Importar Producto desde WMS</h3>
                                            <p className="text-xs text-slate-500">Busca y trae productos del WMS que aún no tienes locales.</p>
                                        </div>
                                    </div>
                                    <div className="relative mb-3">
                                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                                        <input
                                            className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15 outline-none transition-all bg-white"
                                            placeholder="Escribe el nombre del producto WMS..."
                                            aria-label="Buscar producto en el WMS"
                                            value={wmsSearchInput}
                                            onChange={e => setWmsSearchInput(e.target.value)}
                                        />
                                    </div>
                                    {wmsSearchInput.trim().length > 1 && (
                                        <div className="bg-white border border-slate-200 rounded-lg shadow-sm max-h-60 overflow-y-auto">
                                            {wmsMasters.filter(m => m.nombre.toLowerCase().includes(wmsSearchInput.toLowerCase())).map(m => {
                                                const isImported = articles.some(a => a.producto_maestro_id == m.id);
                                                return (
                                                    <div key={m.id} className="flex items-center justify-between p-3 border-b border-slate-100 last:border-0 hover:bg-slate-50">
                                                        <div className="flex flex-col">
                                                            <span className="text-sm font-bold text-slate-700">{m.nombre}</span>
                                                            <span className="text-[10px] text-slate-400 uppercase tracking-wider">ID WMS: {m.id}</span>
                                                        </div>
                                                        <button
                                                            disabled={isImported || importingId === m.id}
                                                            onClick={() => handleImportWms(m.id)}
                                                            className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-2 ${
                                                                isImported
                                                                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 cursor-not-allowed'
                                                                    : importingId === m.id
                                                                    ? 'bg-brand-cyan/10 text-brand-cyan cursor-wait'
                                                                    : 'bg-brand-cyan text-white hover:bg-brand-cyan/90'
                                                            }`}
                                                        >
                                                            {importingId === m.id
                                                                ? (<><LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> Importando...</>)
                                                                : isImported
                                                                    ? (<><Check size={14} aria-hidden="true" /> Ya existe</>)
                                                                    : (<><Download size={14} aria-hidden="true" /> Importar</>)}
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                            {wmsMasters.filter(m => m.nombre.toLowerCase().includes(wmsSearchInput.toLowerCase())).length === 0 && (
                                                <div className="p-4 text-center text-sm text-slate-500">No se encontraron productos en el WMS.</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Grid de artículos */}
                            {displayArticles.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                    <PackageOpen size={56} className="mb-4 text-slate-200" aria-hidden="true" />
                                    <p className="font-bold text-lg text-slate-500">No se encontraron artículos</p>
                                    {filterType === 'products' && <p className="text-sm text-slate-400 mt-1">Usá el importador de arriba para traer productos del WMS</p>}
                                    {filterStatus === 'active' && hiddenCount > 0 && (
                                        <button type="button" onClick={() => setFilterStatus('inactive')}
                                            className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-cyan hover:underline">
                                            <EyeOff size={15} aria-hidden="true" /> Ver {hiddenCount} {hiddenCount === 1 ? 'oculto' : 'ocultos'}
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                                    {displayArticles.map(art => (
                                        <ArticleCard
                                            key={art.ProIdProducto ?? art.CodArticulo}
                                            art={art}
                                            onEdit={setEditing}
                                            onVariants={setVariantArt}
                                            onDelete={setDeletingArt}
                                            showImages={showImages}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

            </div>

            {/* Modal */}
            {editing !== null && (
                <EditModal
                    article={Object.keys(editing).length === 0 ? null : editing}
                    allArticles={articles}
                    onClose={() => setEditing(null)}
                    onSaved={handleSaved}
                />
            )}
            {variantArt !== null && (
                <VariantPriceModal
                    art={variantArt}
                    onClose={() => setVariantArt(null)}
                />
            )}
            {deletingArt !== null && (
                <DeleteConfirmModal
                    art={deletingArt}
                    onClose={() => setDeletingArt(null)}
                    onConfirm={handleDelete}
                />
            )}
        </div>
    );
};

export default ProductsIntegration;
