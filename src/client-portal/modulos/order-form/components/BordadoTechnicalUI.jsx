import React, { useEffect, useState, useRef } from 'react';
import { Scissors, Trash2, Plus, Layers, Palette, Lock } from 'lucide-react';
import { FileUploadZone } from './FileUploadZone';
import { CustomSelect } from '../../../pautas/CustomSelect';
import PrendaClienteSelector from './PrendaClienteSelector';
import PredisenoBordadoModal from './PredisenoBordadoModal';
import { analizarArteAutomatico, puntadasDePaleta } from '../utils/bordadoHilos';

// [BORDADO] Form de ingreso.
//
// Dos ejes, igual que el catálogo (ver docs/migrations/bordado_articulos_y_variantes.sql):
//   · DÓNDE va  → variante: "Bordado sobre la prenda" | "Parche adhesivo"
//                 Cambia el FLUJO: el parche se fabrica de cero, no consume
//                 prendas que el cliente haya entregado.
//   · DE QUÉ es → artículo: "con tafeta" (aplique de tela, menos puntadas) |
//                 "100% hilo". Cambia el precio.
// El relieve 3D es un tercer eje y va como CARGO por diseño, no como artículo.
//
// Cada LOGO es un diseño con lo suyo: sobre qué prendas va, medidas en cm,
// cantidad, su arte y su boceto de ubicación — mismo criterio que las tizadas
// de Corte, donde cada archivo elige su bobina.
//
// Orden de la tarjeta, de lo que condiciona a lo que depende:
//   1. sobre qué prendas va (sin esto no se puede pedir nada)
//   2. medidas, cantidad y relieve
//   3. arte y boceto, con vista previa
//
// En modo COMPLEMENTO (bordado pedido dentro de otro servicio) se mantiene el
// form viejo y simple: ahí el bordado es un extra, no el pedido en sí.

export const BordadoTechnicalUI = ({
    serviceId, garmentQuantity, setGarmentQuantity,
    bocetoFile, setBocetoFile,
    ponchadoFiles, setPonchadoFiles,
    globalMaterial, handleGlobalMaterialChange,
    serviceInfo, userStock,
    handleSpecializedFileUpload,
    handleMultipleSpecializedFileUpload,
    compact = false,
    // Props para modo complemento
    isComplement = false,
    compMaterial = '', setCompMaterial = null,
    compVariant = '', setCompVariant = null,
    compVariants = [], compMaterials = [],
    uniqueVariants = [], dynamicMaterials = [],
    serviceSubType = '', handleSubTypeChange = null,
    // [BORDADO] Diseños y prendas del cliente (solo standalone)
    disenosBordado = [], addDiseno = null, updateDiseno = null, removeDiseno = null,
    prendasDisponibles = [],
    // [COMBOS] Técnica FIJADA por el Configurador (ej. "Bordado sobre prenda 100% hilo") —
    // reemplaza los selectores Tipo/Variante + Prenda(Soporte) por un dato fijo, no editable.
    lockedSpec = '',
    // [COMBOS] Cantidad derivada (combo × cantidad por combo) — el input numérico con
    // flechas de +/- se veía editable aunque setGarmentQuantity fuera un no-op (el vendedor
    // podía tocarlo sin que pasara nada, sin ningún aviso de por qué). Mismo candado visual
    // que lockedSpec.
    lockedQuantity = false,
}) => {
    // Determinamos qué datos mostrar según si es standalone o complemento
    const isStandalone = serviceId === 'bordado';
    const displayVariants = isStandalone ? uniqueVariants : compVariants;
    const displayMaterials = isStandalone ? dynamicMaterials : compMaterials;

    const currentVariant = isStandalone ? serviceSubType : compVariant;
    const currentMaterial = isStandalone ? globalMaterial : compMaterial;

    const onVariantChange = isStandalone ? handleSubTypeChange : setCompVariant;
    const onMaterialChange = isStandalone ? handleGlobalMaterialChange : setCompMaterial;

    // El parche se fabrica de cero: no hay prendas del cliente que elegir.
    const esParche = /parche/i.test(currentVariant || '');
    // El bloque de diseños solo vive en el form propio de bordado.
    const usaDisenos = isStandalone && !!addDiseno;

    // Diseño con el editor de prediseño abierto
    const [disenandoId, setDisenandoId] = useState(null);
    const disenando = disenosBordado.find(d => d.id === disenandoId) || null;

    // ── Prediseño automático ──────────────────────────────────────────────
    // Apenas sube el logo se corre el mismo análisis del editor sin abrir nada:
    // fondo, colores, piezas, hilos y puntada de cada una. Así el pedido llega
    // con los datos para cotizar y para el taller aunque el cliente no toque el
    // diseñador — que es lo normal. Si después lo abre, arranca desde acá.
    const [analizando, setAnalizando] = useState([]);
    const analizadosRef = useRef(new Set());
    // "Con tafeta" sale del artículo elegido (107 / 109): la pieza más grande se
    // resuelve con tela aplicada en vez de hilo.
    const usaTafeta = /tafeta/i.test(currentMaterial || '');

    useEffect(() => {
        if (!usaDisenos) return;
        const pendientes = disenosBordado.filter(d =>
            d.file && !analizadosRef.current.has(d.id + d.file.name)
        );
        if (!pendientes.length) return;

        pendientes.forEach(async (d) => {
            const clave = d.id + d.file.name;
            analizadosRef.current.add(clave);
            setAnalizando(prev => [...prev, d.id]);
            try {
                const r = await analizarArteAutomatico(d.file, { usaTafeta });
                if (r) {
                    // La imagen analizada se guarda como prediseño: es lo que va a
                    // ver el taller y lo que el cliente puede retocar después.
                    const base = d.file.name.replace(/\.[^.]+$/, '');
                    r.canvas.toBlob((blob) => {
                        updateDiseno(d.id, {
                            paleta: r.paleta,
                            arteDisenado: blob
                                ? new File([blob], `${base} PREDISENO.png`, { type: 'image/png' })
                                : null,
                            analisisAutomatico: true,
                        });
                        setAnalizando(prev => prev.filter(x => x !== d.id));
                    }, 'image/png');
                } else {
                    // Formato que el navegador no puede abrir (PDF, AI, DST): queda
                    // sin prediseño y se avisa, en vez de fallar en silencio.
                    updateDiseno(d.id, { analisisImposible: true });
                    setAnalizando(prev => prev.filter(x => x !== d.id));
                }
            } catch {
                setAnalizando(prev => prev.filter(x => x !== d.id));
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [disenosBordado, usaDisenos, usaTafeta]);

    // Diseños donde el cliente pidió VER el arte original teniendo un prediseño
    // guardado. Es solo un cambio de vista: no borra nada.
    const [verOriginal, setVerOriginal] = useState([]);
    const mostrandoOriginal = (id) => verOriginal.includes(id);
    const alternarVista = (id) => setVerOriginal(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

    // Cuántas prendas de cada línea ya tomaron los OTROS diseños — para mostrar
    // el saldo en vivo y que no se comprometa dos veces lo mismo.
    const comprometidoPorLinea = (exceptoId) => {
        const acc = {};
        disenosBordado.forEach(d => {
            if (d.id === exceptoId || !d.prendaClienteId) return;
            acc[d.prendaClienteId] = (acc[d.prendaClienteId] || 0) + (parseInt(d.cantidad) || 0);
        });
        return acc;
    };

    const prendaDe = (id) => prendasDisponibles.find(p => p.PrendaClienteID === id) || null;

    // Las puntadas NO se guardan en el diseño: se derivan de la paleta y las
    // medidas. Así se recalculan solas cuando el cliente corrige el tamaño, sin
    // quedar pegadas a un número viejo.
    const puntadasDelDiseno = (d) => puntadasDePaleta(d.paleta, d.ancho, d.alto);

    const botonAgregar = (
        <button
            type="button"
            onClick={addDiseno}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-dashed border-zinc-700 text-[11px] font-black text-zinc-400 uppercase tracking-widest hover:border-brand-gold hover:text-brand-gold transition-all"
        >
            <Plus size={16} /> Agregar otro diseño
        </button>
    );

    return (
        <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-0' : 'mb-8'}`}>
            <div className={`${compact ? 'bg-zinc-900/40 p-6' : 'bg-zinc-900/60 p-8'} rounded-[2rem] border border-zinc-700/50 relative`}>
                {!compact && (
                    <div className="absolute top-0 right-0 p-8 opacity-5 text-brand-gold">
                        <Scissors size={120} />
                    </div>
                )}

                <div className="flex items-center gap-3 mb-6">
                    {!compact && <span className="px-3 py-1 bg-brand-gold text-zinc-900 text-[10px] font-black rounded-lg">PASO 1</span>}
                    <h3 className="text-sm font-black text-zinc-100 uppercase tracking-widest">{compact ? 'Especificaciones Técnicas' : 'Especificaciones de Bordado'}</h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 relative z-10">
                    <div className="md:col-span-12 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {lockedSpec ? (
                                <div className="md:col-span-2">
                                    <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Técnica</label>
                                    <div className="w-full h-[55px] px-4 flex items-center gap-2 bg-zinc-800/30 border border-zinc-700/50 rounded-2xl font-bold text-zinc-300">
                                        <Lock size={14} className="text-brand-gold shrink-0" />
                                        <span className="truncate">{lockedSpec}</span>
                                    </div>
                                    <p className="mt-2 text-[10px] font-bold text-zinc-500 leading-relaxed">
                                        Fijada por el combo — no se puede cambiar acá.
                                    </p>
                                </div>
                            ) : (
                            <>
                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">
                                    {usaDisenos ? 'Tipo de Bordado *' : 'Tipo / Variante *'}
                                </label>
                                <CustomSelect
                                    value={currentVariant}
                                    onChange={(val) => onVariantChange(val)}
                                    options={displayVariants.map(v => ({ value: v, label: v }))}
                                    placeholder="Seleccionar tipo..."
                                    variant="black"
                                    className="h-[55px]"
                                />
                                {usaDisenos && esParche && (
                                    <p className="mt-2 text-[10px] font-bold text-amber-500/90 leading-relaxed">
                                        El parche se fabrica aparte: no usa prendas tuyas.
                                    </p>
                                )}
                            </div>

                            <div>
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">
                                    {usaDisenos ? 'Relleno *' : 'Prenda (Soporte) *'}
                                </label>
                                <CustomSelect
                                    value={currentMaterial}
                                    onChange={(val) => onMaterialChange(val)}
                                    options={(displayVariants.length > 0 ? displayMaterials : (isStandalone ? (serviceInfo?.materials || []) : []) || userStock || []).map(mat => {
                                        const label = mat.Material || mat.name || mat;
                                        const val = mat.Material || mat.name || mat;
                                        return { value: val, label: label };
                                    })}
                                    placeholder={usaDisenos ? 'Con tafeta o 100% hilo...' : 'Seleccionar prenda...'}
                                    variant="black"
                                    className="h-[55px]"
                                />
                                {usaDisenos && (
                                    <p className="mt-2 text-[10px] font-bold text-zinc-500 leading-relaxed">
                                        La tafeta es un aplique de tela: lleva menos puntadas que el 100% hilo.
                                    </p>
                                )}
                            </div>
                            </>
                            )}

                            {/* La cantidad total deja de ser un campo suelto: sale de la suma
                                de lo que pide cada diseño. En modo complemento se mantiene. */}
                            {!usaDisenos && (
                                <div className="md:col-span-2 lg:col-span-1">
                                    <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Cantidad Total *</label>
                                    {lockedQuantity ? (
                                        <>
                                            <div className="w-full h-[55px] px-4 flex items-center gap-2 bg-zinc-800/30 border border-zinc-700/50 rounded-2xl font-black text-lg text-zinc-300">
                                                <Lock size={14} className="text-brand-gold shrink-0" />
                                                <span>{garmentQuantity}</span>
                                            </div>
                                            <p className="mt-2 text-[10px] font-bold text-zinc-500 leading-relaxed">
                                                Cantidad de combos × lo que lleva este componente — no se edita acá.
                                            </p>
                                        </>
                                    ) : (
                                        <input
                                            type="number"
                                            min="1"
                                            placeholder="Cant."
                                            className="w-full h-[55px] px-4 bg-zinc-800/50 border border-zinc-700/50 rounded-2xl font-black text-lg text-zinc-100 outline-none focus:border-brand-gold transition-all"
                                            value={garmentQuantity}
                                            onChange={(e) => setGarmentQuantity(e.target.value)}
                                        />
                                    )}
                                </div>
                            )}
                        </div>

                        {/* ============ DISEÑOS A BORDAR (uno por logo) ============ */}
                        {usaDisenos && (
                            <div className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <Layers size={14} className="text-brand-gold" />
                                    <h4 className="text-[11px] font-black text-zinc-200 uppercase tracking-widest">
                                        Diseños a bordar ({disenosBordado.length})
                                    </h4>
                                </div>

                                {disenosBordado.length === 0 ? (
                                    <div className="p-6 rounded-2xl border-2 border-dashed border-zinc-700/50 text-center">
                                        <p className="text-xs font-bold text-zinc-400">Todavía no cargaste ningún diseño.</p>
                                        <p className="text-[10px] text-zinc-500 mt-1 mb-4">
                                            Agregá uno por cada logo distinto que quieras bordar.
                                        </p>
                                        <button
                                            type="button"
                                            onClick={addDiseno}
                                            className="inline-flex items-center gap-2 px-5 py-3 bg-brand-gold text-zinc-900 text-[10px] font-black uppercase tracking-widest rounded-xl hover:brightness-110 transition-all"
                                        >
                                            <Plus size={14} /> Agregar el primer diseño
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        {disenosBordado.map((d, idx) => {
                                            const comprometido = comprometidoPorLinea(d.id);
                                            const prenda = prendaDe(d.prendaClienteId);
                                            const libre = prenda
                                                ? (parseInt(prenda.CantidadDisponible) || 0) - (comprometido[prenda.PrendaClienteID] || 0)
                                                : null;
                                            const pedido = parseInt(d.cantidad) || 0;
                                            const sePasa = libre !== null && pedido > libre;
                                            const faltaPrenda = !esParche && !d.prendaClienteId;

                                            return (
                                                <div key={d.id} className="p-5 rounded-2xl bg-zinc-900/50 border border-zinc-700/50 space-y-5">
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-[10px] font-black text-brand-gold uppercase tracking-widest">
                                                            Diseño {idx + 1}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => removeDiseno(d.id)}
                                                            className="text-zinc-500 hover:text-red-500 transition-colors"
                                                            title="Quitar este diseño del pedido"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>

                                                    {/* 1 · SOBRE QUÉ PRENDAS VA — primero, porque condiciona todo lo demás */}
                                                    {!esParche && (
                                                        <div>
                                                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">
                                                                ¿Sobre qué prendas va? *
                                                            </label>
                                                            <PrendaClienteSelector
                                                                prendasDisponibles={prendasDisponibles}
                                                                selectedPrendaId={d.prendaClienteId}
                                                                yaComprometido={comprometido}
                                                                onSelect={(p) => updateDiseno(d.id, {
                                                                    prendaClienteId: p ? p.PrendaClienteID : null
                                                                })}
                                                            />
                                                            {faltaPrenda && prendasDisponibles.length > 0 && (
                                                                <p className="mt-2 text-[10px] font-black text-amber-400">
                                                                    Elegí las prendas antes de seguir: sin eso no se puede confirmar el pedido.
                                                                </p>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* 2 · MEDIDAS, CANTIDAD Y RELIEVE — todo en la misma línea */}
                                                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-end">
                                                        <div>
                                                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Ancho (cm) *</label>
                                                            <input
                                                                type="number" min="0" step="0.1" placeholder="Ancho"
                                                                value={d.ancho}
                                                                onChange={(e) => updateDiseno(d.id, { ancho: e.target.value })}
                                                                className="w-full h-[48px] px-4 bg-zinc-800/50 border border-zinc-700/50 rounded-xl font-black text-zinc-100 outline-none focus:border-brand-gold transition-all"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Largo (cm) *</label>
                                                            <input
                                                                type="number" min="0" step="0.1" placeholder="Largo"
                                                                value={d.alto}
                                                                onChange={(e) => updateDiseno(d.id, { alto: e.target.value })}
                                                                className="w-full h-[48px] px-4 bg-zinc-800/50 border border-zinc-700/50 rounded-xl font-black text-zinc-100 outline-none focus:border-brand-gold transition-all"
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">
                                                                {esParche ? 'Parches *' : 'Prendas *'}
                                                            </label>
                                                            <input
                                                                type="number" min="1" placeholder="Cant."
                                                                value={d.cantidad}
                                                                onChange={(e) => updateDiseno(d.id, { cantidad: e.target.value })}
                                                                className={`w-full h-[48px] px-4 bg-zinc-800/50 border rounded-xl font-black text-zinc-100 outline-none transition-all ${
                                                                    sePasa ? 'border-red-500 focus:border-red-500' : 'border-zinc-700/50 focus:border-brand-gold'
                                                                }`}
                                                            />
                                                        </div>
                                                        {/* [RELIEVE] Si el cliente usó el diseñador, el relieve ya
                                                            quedó definido pieza por pieza (lo normal: una letra en
                                                            relieve y el resto plano). Ahí el tilde deja de editarse
                                                            y solo refleja lo diseñado — si no, diría una cosa y el
                                                            diseño otra. Sin diseñador, se declara acá. */}
                                                        {(d.paleta || []).length > 0 ? (
                                                            <div
                                                                className={`flex items-center gap-3 h-[48px] px-3 rounded-xl border ${
                                                                    d.relieve3D
                                                                        ? 'bg-brand-gold/10 border-brand-gold/40'
                                                                        : 'bg-zinc-800/40 border-zinc-700/50'
                                                                }`}
                                                                title="Definido en el diseñador, pieza por pieza. Abrí 'Editar los hilos' para cambiarlo."
                                                            >
                                                                <span className={`text-[10px] font-black leading-tight ${d.relieve3D ? 'text-brand-gold' : 'text-zinc-400'}`}>
                                                                    {d.relieve3D
                                                                        ? <>Lleva relieve 3D<br /><span className="font-bold text-zinc-500">según tu diseño</span></>
                                                                        : <>Todo plano<br /><span className="font-bold text-zinc-500">según tu diseño</span></>}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            <label className="flex items-center gap-3 h-[48px] px-3 rounded-xl bg-zinc-800/40 border border-zinc-700/50 cursor-pointer hover:border-zinc-500 transition-colors">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={!!d.relieve3D}
                                                                    onChange={(e) => updateDiseno(d.id, { relieve3D: e.target.checked })}
                                                                    className="h-4 w-4 accent-brand-gold shrink-0"
                                                                />
                                                                <span className="text-[10px] font-black text-zinc-200 leading-tight">
                                                                    Bordado 3D<br />
                                                                    <span className="font-bold text-zinc-500">en relieve</span>
                                                                </span>
                                                            </label>
                                                        )}
                                                    </div>

                                                    {sePasa && (
                                                        <p className="-mt-3 text-[10px] font-black text-red-400">
                                                            Te quedan {libre} prendas disponibles de esa línea y estás pidiendo {pedido}.
                                                        </p>
                                                    )}
                                                    {!sePasa && libre !== null && pedido > 0 && (
                                                        <p className="-mt-3 text-[10px] font-bold text-zinc-500">
                                                            Quedan {libre - pedido} sin usar de esa línea.
                                                        </p>
                                                    )}

                                                    {/* 3 · ARTE Y BOCETO — mismo nivel, los dos con vista previa */}
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                                        <div>
                                                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest text-center">
                                                                Logo a bordar *
                                                            </label>
                                                            {/* La miniatura la dibuja la propia zona de subida (por eso
                                                                recibe el File y no un booleano). Si hay prediseño se
                                                                muestra ESE; el link de abajo alterna al original.
                                                                Uno u otro, nunca los dos peleando. */}
                                                            <FileUploadZone
                                                                id={`bordado-logo-${d.id}`}
                                                                label={d.file ? 'CAMBIAR LOGO' : 'SUBIR LOGO'}
                                                                onFileSelected={(f) => {
                                                                    updateDiseno(d.id, {
                                                                        file: Array.isArray(f) ? f[0] : f,
                                                                        // Cambiar el arte invalida el prediseño anterior
                                                                        arteDisenado: null, paleta: []
                                                                    });
                                                                    setVerOriginal(prev => prev.filter(x => x !== d.id));
                                                                }}
                                                                selectedFile={(d.arteDisenado && !mostrandoOriginal(d.id)) ? d.arteDisenado : d.file}
                                                                color="emerald"
                                                            />

                                                            {d.file && (
                                                                <div className="mt-2 space-y-2">
                                                                    <p className="text-[10px] font-bold text-zinc-400 truncate text-center">{d.file.name}</p>

                                                                    {d.arteDisenado && (
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => alternarVista(d.id)}
                                                                            className="w-full flex items-center justify-center gap-2 text-[9px] font-black uppercase tracking-wide text-zinc-400 hover:text-zinc-100 transition-colors"
                                                                            title={mostrandoOriginal(d.id)
                                                                                ? 'Volver a ver el diseño con los hilos que elegiste'
                                                                                : 'Ver el arte original tal como lo subiste'}
                                                                        >
                                                                            <span className="px-2 py-1 rounded bg-brand-gold/15 text-brand-gold border border-brand-gold/30">
                                                                                {mostrandoOriginal(d.id) ? 'Viendo el original' : 'Viendo tu diseño'}
                                                                            </span>
                                                                            <span className="underline">
                                                                                {mostrandoOriginal(d.id) ? 'Ver mi diseño' : 'Ver el original'}
                                                                            </span>
                                                                        </button>
                                                                    )}

                                                                    <button
                                                                        type="button"
                                                                        onClick={() => setDisenandoId(d.id)}
                                                                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-brand-gold/40 text-[10px] font-black text-brand-gold uppercase tracking-widest hover:bg-brand-gold/10 transition-all"
                                                                    >
                                                                        <Palette size={13} />
                                                                        {d.arteDisenado ? 'Editar los hilos' : 'Elegir hilos y puntadas'}
                                                                    </button>
                                                                    {/* Lo que calculó el análisis automático (o el editor, si lo abrió).
                                                                        Las puntadas se recalculan solas al cambiar las medidas. */}
                                                                    {analizando.includes(d.id) ? (
                                                                        <p className="text-[10px] font-bold text-brand-gold text-center animate-pulse">
                                                                            Analizando el arte…
                                                                        </p>
                                                                    ) : d.analisisImposible ? (
                                                                        <p className="text-[10px] font-bold text-amber-500/90 text-center leading-relaxed">
                                                                            No se puede analizar este formato. El taller lo va a ver igual, pero sin
                                                                            estimación de hilos ni puntadas. Subilo en PNG o JPG si querés el detalle.
                                                                        </p>
                                                                    ) : puntadasDelDiseno(d) > 0 ? (
                                                                        <p className="text-[10px] text-zinc-400 text-center leading-relaxed">
                                                                            <span className="font-black text-white">
                                                                                ≈ {puntadasDelDiseno(d).toLocaleString('es-UY')} puntadas
                                                                            </span>
                                                                            {' · '}{(d.paleta || []).length} hilos
                                                                            <br />
                                                                            <span className="text-zinc-600">
                                                                                Estimado: el número real sale del ponchado.
                                                                            </span>
                                                                        </p>
                                                                    ) : (d.paleta || []).length > 0 ? (
                                                                        <p className="text-[10px] text-zinc-500 text-center leading-relaxed">
                                                                            {(d.paleta || []).length} hilos detectados. Cargá el ancho y el largo
                                                                            para estimar las puntadas.
                                                                        </p>
                                                                    ) : (
                                                                        <p className="text-[9px] text-zinc-600 text-center leading-relaxed">
                                                                            Es una referencia para el taller: la matriz la hace igual un diseñador.
                                                                        </p>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>

                                                        <div>
                                                            <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest text-center">
                                                                Boceto — dónde va el bordado
                                                            </label>
                                                            <FileUploadZone
                                                                id={`bordado-boceto-${d.id}`}
                                                                label={d.boceto ? 'CAMBIAR BOCETO' : 'UBICACIÓN VISUAL'}
                                                                onFileSelected={(f) => updateDiseno(d.id, { boceto: Array.isArray(f) ? f[0] : f })}
                                                                selectedFile={d.boceto}
                                                                color="blue"
                                                            />
                                                            {d.boceto && (
                                                                <div className="mt-2 flex items-center justify-center gap-2">
                                                                    <span className="text-[10px] font-bold text-zinc-400 truncate max-w-[160px]">{d.boceto.name}</span>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => updateDiseno(d.id, { boceto: null })}
                                                                        className="text-blue-500 hover:text-red-500 transition-colors"
                                                                        title="Quitar el boceto"
                                                                    >
                                                                        <Trash2 size={12} />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        {/* El botón va al FINAL: se agrega desde donde terminaste
                                            de cargar, sin tener que volver a subir. */}
                                        {botonAgregar}
                                    </>
                                )}
                            </div>
                        )}

                        {/* ============ ARCHIVOS (solo modo complemento) ============ */}
                        {!usaDisenos && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest text-center">Logos a Bordar (Uno o más)</label>
                                    <FileUploadZone
                                        id="bordado-logo"
                                        label="SUBIR LOGOS"
                                        onFileSelected={(f) => handleMultipleSpecializedFileUpload(f)}
                                        selectedFile={ponchadoFiles.length > 0}
                                        color="emerald"
                                        multiple={true}
                                    />
                                    {ponchadoFiles.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-2 justify-center">
                                            {ponchadoFiles.map((f, idx) => (
                                                <div key={idx} className="flex items-center gap-2 bg-zinc-800/50 border border-emerald-500/30 px-4 py-2 rounded-xl">
                                                    <span className="text-[10px] font-bold text-zinc-300 max-w-[100px] truncate">{f.name}</span>
                                                    <button
                                                        onClick={() => setPonchadoFiles(ponchadoFiles.filter((_, i) => i !== idx))}
                                                        className="text-emerald-500 hover:text-red-500 transition-colors"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest text-center">Boceto / Ubicación</label>
                                    <FileUploadZone
                                        id="bordado-boceto"
                                        label="UBICACIÓN VISUAL"
                                        onFileSelected={(f) => handleSpecializedFileUpload(f)}
                                        selectedFile={bocetoFile}
                                        color="blue"
                                    />
                                    {bocetoFile && (
                                        <div className="mt-3 flex justify-center">
                                            <div className="flex items-center gap-2 bg-zinc-800/50 border border-blue-500/30 px-4 py-2 rounded-xl">
                                                <span className="text-[10px] font-bold text-zinc-300 max-w-[150px] truncate">{bocetoFile.name}</span>
                                                <button
                                                    onClick={() => setBocetoFile(null)}
                                                    className="text-blue-500 hover:text-red-500 transition-colors"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Editor de prediseño (opcional) */}
            {disenando && (
                <PredisenoBordadoModal
                    file={disenando.file}
                    paletaInicial={disenando.paleta || []}
                    // Las medidas del bordado son las que permiten estimar puntadas
                    // (área × densidad): sin ellas el editor lo avisa y no inventa.
                    anchoCm={disenando.ancho}
                    altoCm={disenando.alto}
                    cantidad={parseInt(disenando.cantidad) || 0}
                    onCerrar={() => setDisenandoId(null)}
                    onGuardar={({ paleta, arteDisenado, puntadasEstimadas, relieve3D }) => {
                        // El relieve del pedido pasa a salir del diseño (qué piezas se
                        // marcaron), no de un tilde suelto.
                        updateDiseno(disenando.id, { paleta, arteDisenado, puntadasEstimadas, relieve3D });
                        setVerOriginal(prev => prev.filter(x => x !== disenando.id));
                        setDisenandoId(null);
                    }}
                />
            )}
        </div>
    );
};

export default BordadoTechnicalUI;
