import React, { useState, useEffect } from 'react';
import { Zap, Trash2, AlertTriangle, CheckCircle2, CheckCircle, FileCode, Plus, Scissors, Info } from 'lucide-react';
import { FileUploadZone } from './FileUploadZone';
import { CustomSelect } from '../../../pautas/CustomSelect';
import { MARGEN_TELA_M } from '../utils/medirTizada';

// Únicos formatos que lee la máquina de corte (regla 06/08). El .ai moderno es un
// PDF por dentro: hay que guardarlo como "Illustrator 3". La validación real la
// hace medirTizada leyendo el contenido; esto solo filtra el explorador de archivos.
const FORMATOS_TIZADA = '.dxf,.plt,.hpgl,.ai';

// Cada tizada es una PIEZA suelta o una PRENDA completa; si es prenda, hay que decir el talle.
// Producción lo necesita para saber qué está cortando: 20 piezas no es lo mismo que 20 prendas.
const TIPOS_CORTE = [
    { id: 'PIEZA', label: 'Pieza' },
    { id: 'PRENDA', label: 'Prenda' },
];
const TALLES_PRENDA = ['0', '1', '2', '3', '4', '5', '6', '8', '10', '12', '14', '16',
    'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'];

// =====================================================================
// CORTE STANDALONE (/portal/order/corte) — bloque a ancho completo.
// Cada tizada es una tarjeta (como los archivos de sublimación) donde el
// "material" es la BOBINA de tela del cliente. Debajo, el consumo EN VIVO
// de cada bobina: cuánto usa el pedido y cuánto le queda.
// El acordeón de corte complementario (dentro de sublimación) sigue con el
// layout viejo, más abajo — no se toca.
// =====================================================================
const CorteStandalone = ({ tizadaFiles, setTizadaFiles, handleMultipleSpecializedFileUpload, onReemplazarTizada, bobinasDisponibles }) => {
    // Igual que el material en sublimación: por defecto la tela del primer archivo
    // se aplica a TODO el pedido. Destildando se elige tela por tizada y el pedido
    // se parte en una orden por tela.
    const [mismaTela, setMismaTela] = useState(true);

    const bobinaDe = (id) => bobinasDisponibles.find(b => b.BobinaID === id) || null;
    // Ancho ÚTIL de la tela: el del rollo menos los 3 cm de margen (igual que sublimación)
    const anchoDe = (b) => {
        const rollo = parseFloat(b?.AnchoReal ?? b?.Ancho) || 0;
        return rollo > 0 ? Math.round((rollo - MARGEN_TELA_M) * 100) / 100 : 0;
    };
    const bobinaGlobal = tizadaFiles.find(f => f.bobinaId)?.bobinaId ?? null;

    const asignarATodas = (bobinaId) => setTizadaFiles(tizadaFiles.map(f => Object.assign(f, { bobinaId })));

    // Con "misma tela" tildado, cualquier tizada nueva hereda la bobina elegida.
    useEffect(() => {
        if (!mismaTela || !bobinaGlobal) return;
        if (tizadaFiles.some(f => f.bobinaId !== bobinaGlobal)) asignarATodas(bobinaGlobal);
    }, [mismaTela, bobinaGlobal, tizadaFiles.length]);

    // Consumo por bobina (largo de tela × veces a cortar) para el chequeo en vivo
    const consumo = [];
    tizadaFiles.forEach(f => {
        if (!f.bobinaId || !f.medicion) return;
        let fila = consumo.find(c => c.bobinaId === f.bobinaId);
        if (!fila) {
            fila = { bobinaId: f.bobinaId, bobina: bobinaDe(f.bobinaId), usa: 0, piezas: 0, corte: 0, anchoMax: 0 };
            consumo.push(fila);
        }
        const veces = f.copias || 1;
        fila.usa += f.medicion.largoTelaM * veces;
        fila.piezas += f.medicion.piezas * veces;
        fila.corte += f.medicion.metrosCorte * veces;
        fila.anchoMax = Math.max(fila.anchoMax, f.medicion.anchoTelaM);
    });

    const opcionesBobina = bobinasDisponibles.map(b => ({
        value: String(b.BobinaID),
        label: `${b.DescripcionTela || 'Tela'} · ${parseFloat(b.MetrosRestantes).toFixed(2)}m disponibles · ${b.CodigoEtiqueta}`
    }));

    const sinBobinas = bobinasDisponibles.length === 0;

    return (
        <div className="space-y-6 relative z-10">
            {/* --- ORIGEN DE LA TELA (fijo: tela del cliente) --- */}
            <div>
                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Origen de la Tela</label>
                <div className="w-full px-4 py-3 bg-zinc-900/60 border border-zinc-700/50 rounded-[10px] flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 flex-shrink-0"></span>
                    <span className="text-sm font-medium text-zinc-100">Tela del Cliente</span>
                    <span className="ml-auto text-[9px] font-black uppercase text-cyan-500/60">Se corta sobre tu tela</span>
                </div>

                {/* Aviso informativo (no bloquea nada): el descanso de la tela es
                    responsabilidad del cliente y afecta el resultado del corte. */}
                <div className="mt-3 flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2.5">
                    <Info size={14} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-200/90 leading-relaxed">
                        <b className="text-amber-300">Si tu tela necesita descanso, entregala ya descansada.</b>{' '}
                        Cortamos sobre la tela tal como la recibimos: una tela sin descansar se encoge o se
                        deforma después del corte y el resultado no es el óptimo.
                    </p>
                </div>
            </div>

            {/* --- ARCHIVOS PARA PRODUCCIÓN (mismo layout que sublimación) --- */}
            <div>
                <div className="flex justify-between items-center mb-4">
                    <p className="text-sm font-bold uppercase text-zinc-400">Archivos de Tizada ({tizadaFiles.length}/15)</p>
                </div>

                {sinBobinas && (
                    <p className="mb-4 text-[11px] font-bold text-amber-500/90">
                        No tenés telas disponibles. Entregá tu tela en recepción para poder usarla en pedidos de corte.
                    </p>
                )}

                {/* Sin tizadas todavía: zona grande para arrastrar/elegir (acepta varias) */}
                {tizadaFiles.length === 0 && (
                    <>
                        <FileUploadZone
                            id="tizada-upload-tree"
                            label="Subir Tizadas"
                            onFileSelected={(files) => handleMultipleSpecializedFileUpload(files)}
                            selectedFile={false}
                            multiple={true}
                            color="amber"
                            accept={FORMATOS_TIZADA}
                        />
                        <p className="mt-2 text-[11px] text-zinc-500">
                            Solo <b className="text-zinc-400">DXF</b>, <b className="text-zinc-400">PLT</b> o <b className="text-zinc-400">AI guardado como Illustrator 3</b> — son los archivos que lee la máquina de corte.
                        </p>
                    </>
                )}

                <div className="space-y-4">
                    {tizadaFiles.map((tf, i) => {
                        const bob = bobinaDe(tf.bobinaId);
                        const anchoBob = anchoDe(bob); // ancho ÚTIL (rollo − 3 cm)
                        const noEntraAncho = tf.medicion && anchoBob > 0 && tf.medicion.anchoTelaM > anchoBob + 1e-9;
                        return (
                            <div key={i} className={`bg-brand-dark p-4 md:rounded-2xl rounded-none border-y border-x-0 md:border-x shadow-sm -mx-4 md:mx-0 ${noEntraAncho ? 'border-red-500/60' : 'border-zinc-700/50'}`}>
                                <div className="flex justify-between items-center mb-4 pb-2 border-b border-zinc-700/30">
                                    <span className="text-[10px] font-black bg-cyan-400/10 text-cyan-400 py-1 px-3 rounded-full border border-cyan-500/20">ARCHIVO {i + 1}</span>
                                    <button type="button" onClick={() => setTizadaFiles(tizadaFiles.filter((_, idx) => idx !== i))}><Trash2 size={16} className="text-zinc-500 hover:text-red-400 transition-colors" /></button>
                                </div>

                                {/* La TELA hace de "material": mismo patrón que sublimación,
                                    con "aplicar a todo el pedido" en la primera tarjeta. */}
                                <div className="mb-4 px-1">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="block text-[9px] uppercase font-black text-zinc-400">Bobina de Tela (Específica)</span>
                                        {i === 0 && (
                                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                                <input
                                                    type="checkbox"
                                                    checked={mismaTela}
                                                    onChange={(e) => setMismaTela(e.target.checked)}
                                                    className="w-3 h-3 rounded border-zinc-600 accent-cyan-400 cursor-pointer"
                                                />
                                                <span className="text-[9px] font-bold uppercase text-zinc-500">Aplicar a todo el pedido</span>
                                            </label>
                                        )}
                                    </div>
                                    {(i === 0 || !mismaTela) ? (
                                        <CustomSelect
                                            value={tf.bobinaId != null ? String(tf.bobinaId) : ''}
                                            onChange={(v) => (i === 0 && mismaTela)
                                                ? asignarATodas(parseInt(v))
                                                : setTizadaFiles(tizadaFiles.map((f, idx) => idx === i ? Object.assign(f, { bobinaId: parseInt(v) }) : f))}
                                            options={opcionesBobina}
                                            placeholder="Selecciona la bobina de tela"
                                            variant="black"
                                            size="small"
                                        />
                                    ) : (
                                        <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/60 border border-zinc-700/50 rounded-[10px] text-xs text-zinc-400">
                                            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400/60 flex-shrink-0"></span>
                                            <span className="truncate">{bobinaDe(bobinaGlobal)?.DescripcionTela || 'Sin tela'}</span>
                                            <span className="ml-auto text-[9px] font-black uppercase text-cyan-500/60 flex-shrink-0">Global</span>
                                        </div>
                                    )}
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                                    <div className="md:col-span-6">
                                        <FileUploadZone
                                            id={`tizada-item-${i}`}
                                            label="Tizada"
                                            selectedFile={tf}
                                            onFileSelected={(f) => onReemplazarTizada(i, f)}
                                            color="amber"
                                            accept={FORMATOS_TIZADA}
                                        />
                                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                            <div className="text-[10px] font-bold text-zinc-400 bg-zinc-900/60 p-1 px-2 rounded border border-zinc-700/50 w-fit flex items-center gap-1"><FileCode size={12} className="text-cyan-400/60" /> {tf.name}</div>
                                            {tf.medicion && (
                                                <div className="text-[10px] font-black uppercase tracking-wider text-emerald-400/90 bg-emerald-500/10 p-1 px-2 rounded border border-emerald-500/30 w-fit flex items-center gap-1"><CheckCircle size={11} /> Medida</div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="md:col-span-6">
                                        <div className="bg-zinc-900/40 rounded-2xl border border-zinc-700/50 p-4 h-full">
                                            <p className="text-[10px] font-black uppercase text-zinc-400 tracking-widest mb-3 flex items-center gap-1.5">
                                                <Scissors size={12} className="text-brand-gold" /> Configuración de Corte
                                            </p>
                                            {/* En mobile va APILADO: con el input al costado, la columna de
                                                datos quedaba de ~180px y los cuatro chips caían uno por
                                                línea. Desde `sm` vuelve a la fila de siempre. */}
                                            <div className="flex flex-col sm:flex-row sm:gap-5 sm:items-start gap-3">
                                                <div className="flex items-center gap-3 sm:block">
                                                    <label className="text-[9px] uppercase font-black text-zinc-500 tracking-widest sm:block sm:mb-1 shrink-0">Veces a cortar</label>
                                                    <input
                                                        type="number" min="1"
                                                        value={tf.copias || 1}
                                                        onChange={(e) => setTizadaFiles(tizadaFiles.map((f, idx) => idx === i ? Object.assign(f, { copias: Math.max(1, parseInt(e.target.value) || 1) }) : f))}
                                                        className="w-20 bg-zinc-800 border-2 border-zinc-700/50 rounded-xl p-2.5 text-sm text-zinc-100 font-bold focus:border-brand-cyan outline-none"
                                                    />
                                                    <span className="text-[11px] font-bold text-zinc-300 sm:hidden">
                                                        {(tf.copias || 1) === 1 ? 'vez' : 'veces'}
                                                    </span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="hidden sm:block text-[11px] font-bold text-zinc-300">Se corta la misma tizada {tf.copias || 1} {(tf.copias || 1) === 1 ? 'vez' : 'veces'}</p>
                                                    {tf.medicion && (
                                                        <div className="sm:mt-2 grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5">
                                                            <span className="text-[10px] font-mono bg-zinc-800/80 border border-zinc-700/50 rounded px-2 py-1 text-zinc-300 text-center sm:text-left">{tf.medicion.piezas * (tf.copias || 1)} piezas</span>
                                                            <span className="text-[10px] font-mono bg-zinc-800/80 border border-zinc-700/50 rounded px-2 py-1 text-zinc-300 text-center sm:text-left">{(tf.medicion.metrosCorte * (tf.copias || 1)).toFixed(2)}m de corte</span>
                                                            <span className="text-[10px] font-mono bg-zinc-800/80 border border-zinc-700/50 rounded px-2 py-1 text-amber-300/90 text-center sm:text-left">{(tf.medicion.largoTelaM * (tf.copias || 1)).toFixed(2)}m de tela</span>
                                                            <span className="text-[10px] font-mono bg-zinc-800/80 border border-zinc-700/50 rounded px-2 py-1 text-zinc-400 text-center sm:text-left">ancho {tf.medicion.anchoTelaM.toFixed(2)}m</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Pieza o prenda (obligatorio). Sin default a propósito: si la
                                                tarjeta naciera en "Pieza", el cliente lo dejaría así sin mirar
                                                y producción recibiría prendas contadas como piezas sueltas. */}
                                            <div className="mt-4 pt-3 border-t border-zinc-700/40">
                                                <label className="block text-[9px] uppercase font-black text-zinc-500 mb-1.5 tracking-widest">
                                                    ¿Qué se corta? <span className="text-red-400">*</span>
                                                </label>
                                                <div className="grid grid-cols-2 sm:flex gap-2">
                                                    {TIPOS_CORTE.map(t => (
                                                        <button
                                                            key={t.id}
                                                            type="button"
                                                            onClick={() => setTizadaFiles(tizadaFiles.map((f, idx) => idx === i
                                                                ? Object.assign(f, { tipoCorte: t.id, ...(t.id === 'PIEZA' ? { talle: null } : {}) })
                                                                : f))}
                                                            className={`px-4 py-2.5 sm:py-2 rounded-xl text-[11px] font-black uppercase tracking-wide border-2 transition-colors ${tf.tipoCorte === t.id
                                                                ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan'
                                                                : 'border-zinc-700/50 bg-zinc-800 text-zinc-400 hover:border-zinc-600'}`}
                                                        >
                                                            {t.label}
                                                        </button>
                                                    ))}
                                                </div>

                                                {tf.tipoCorte === 'PRENDA' && (
                                                    <div className="mt-3">
                                                        <label className="block text-[9px] uppercase font-black text-zinc-500 mb-1.5 tracking-widest">
                                                            Talle <span className="text-red-400">*</span>
                                                        </label>
                                                        <CustomSelect
                                                            name={`talle-${i}`}
                                                            aria-label="Talle de la prenda"
                                                            value={tf.talle || ''}
                                                            onChange={(v) => setTizadaFiles(tizadaFiles.map((f, idx) => idx === i ? Object.assign(f, { talle: v }) : f))}
                                                            options={TALLES_PRENDA.map(t => ({ value: t, label: t }))}
                                                            placeholder="Elegí el talle..."
                                                            variant="black"
                                                        />
                                                    </div>
                                                )}

                                                {!tf.tipoCorte && (
                                                    <p className="mt-2 text-[10px] font-bold text-amber-400/90 flex items-center gap-1.5">
                                                        <AlertTriangle size={12} className="shrink-0" /> Elegí si esta tizada es una pieza o una prenda.
                                                    </p>
                                                )}
                                                {tf.tipoCorte === 'PRENDA' && !tf.talle && (
                                                    <p className="mt-2 text-[10px] font-bold text-amber-400/90 flex items-center gap-1.5">
                                                        <AlertTriangle size={12} className="shrink-0" /> Falta el talle de la prenda.
                                                    </p>
                                                )}
                                            </div>

                                            {noEntraAncho && (
                                                <p className="mt-3 text-[10px] font-bold text-red-400 flex items-center gap-1.5">
                                                    <AlertTriangle size={13} className="shrink-0" />
                                                    La tizada mide {tf.medicion.anchoTelaM.toFixed(2)} m de ancho y en esta tela entran {anchoBob.toFixed(2)} m (rollo de {parseFloat(bob?.AnchoReal ?? bob?.Ancho).toFixed(2)} m menos 3 cm de margen): no entra.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}

                    {/* Input oculto + botón AGREGAR ARCHIVO (igual que sublimación) */}
                    {tizadaFiles.length > 0 && (
                        <>
                            <input
                                type="file"
                                id="add-tizada-file-input"
                                className="hidden"
                                multiple
                                accept={FORMATOS_TIZADA}
                                onChange={(e) => {
                                    const files = Array.from(e.target.files || []);
                                    e.target.value = '';
                                    if (files.length) handleMultipleSpecializedFileUpload(files);
                                }}
                            />
                            <button
                                type="button"
                                onClick={() => {
                                    if (tizadaFiles.length >= 15) return;
                                    document.getElementById('add-tizada-file-input').click();
                                }}
                                disabled={tizadaFiles.length >= 15}
                                className={`w-full py-3 rounded-xl border-2 border-dashed flex items-center justify-center gap-2 transition-all ${tizadaFiles.length >= 15 ? 'border-zinc-700 text-zinc-600 cursor-not-allowed' : 'border-zinc-600 text-zinc-400 bg-brand-dark hover:border-cyan-500 hover:text-cyan-400 hover:bg-cyan-400/5'}`}
                            >
                                {tizadaFiles.length >= 15 ? (
                                    <span className="text-xs font-bold uppercase">Límite de 15 archivos alcanzado</span>
                                ) : (
                                    <>
                                        <Plus size={16} />
                                        <span className="text-xs font-bold uppercase">AGREGAR ARCHIVO</span>
                                    </>
                                )}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* --- CHEQUEO EN VIVO DE CADA TELA --- */}
            {consumo.length > 0 && (
                <div className="bg-zinc-800/30 rounded-2xl border border-zinc-700/50 p-5 space-y-4">
                    <p className="text-[10px] uppercase font-black text-zinc-500 tracking-widest">Cómo queda tu tela</p>
                    {consumo.map(c => {
                        const disp = parseFloat(c.bobina?.MetrosRestantes) || 0;
                        const restante = disp - c.usa;
                        const excede = restante < -1e-9;
                        const pct = disp > 0 ? Math.min(100, (c.usa / disp) * 100) : 100;
                        return (
                            <div key={c.bobinaId}>
                                <div className="flex flex-wrap items-baseline justify-between gap-x-3 mb-1.5">
                                    <span className="text-[11px] font-black text-zinc-200">
                                        {c.bobina?.DescripcionTela || 'Tela'} <span className="font-mono text-zinc-500">{c.bobina?.CodigoEtiqueta}</span>
                                    </span>
                                    <span className={`text-[11px] font-bold ${excede ? 'text-red-400' : 'text-emerald-400'}`}>
                                        usás {c.usa.toFixed(2)} m de {disp.toFixed(2)} m
                                    </span>
                                </div>
                                <div className="h-2 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-700/50">
                                    <div className={`h-full rounded-full transition-all ${excede ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
                                </div>
                                <p className={`mt-1.5 text-[10px] font-bold flex items-center gap-1.5 ${excede ? 'text-red-400' : 'text-zinc-400'}`}>
                                    {excede ? <AlertTriangle size={12} className="shrink-0" /> : <CheckCircle2 size={12} className="shrink-0 text-emerald-500" />}
                                    {excede
                                        ? `Te faltan ${Math.abs(restante).toFixed(2)} m de esta tela. Reducí las veces a cortar o elegí otra.`
                                        : `Te quedan ${restante.toFixed(2)} m · ${c.piezas} piezas · ${c.corte.toFixed(2)} m de corte`}
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export const CorteTechnicalUI = ({ serviceId, moldType, setMoldType, fabricOrigin, setFabricOrigin, clientFabricName, setClientFabricName, selectedSubOrderId, setSelectedSubOrderId, activeSubOrders, tizadaFiles, setTizadaFiles, handleMultipleSpecializedFileUpload, onReemplazarTizada = () => {}, compact = false, bobinasDisponibles = [], selectedBobinaId = null, setSelectedBobina = () => {} }) => (
    <div className={`animate-in slide-in-from-top duration-500 ${compact ? 'mb-4' : 'mb-12'}`}>
        <div className={`${compact ? 'bg-zinc-900/40 p-6' : 'bg-zinc-900/60 p-8'} rounded-[2rem] border border-zinc-700/50 relative`}>
            <div className="absolute top-0 right-0 p-8 opacity-5 text-brand-gold pointer-events-none">
                <Zap size={compact ? 60 : 120} />
            </div>

            <div className="flex items-center gap-3 mb-6">
                <span className="px-3 py-1 bg-brand-gold text-zinc-900 text-[10px] font-black rounded-lg">PASO 1</span>
                <h3 className="text-sm font-black text-zinc-100 uppercase tracking-widest">Especificaciones de Corte</h3>
            </div>

            {serviceId === 'corte' ? (
                <CorteStandalone
                    tizadaFiles={tizadaFiles}
                    setTizadaFiles={setTizadaFiles}
                    handleMultipleSpecializedFileUpload={handleMultipleSpecializedFileUpload}
                    onReemplazarTizada={onReemplazarTizada}
                    bobinasDisponibles={bobinasDisponibles}
                />
            ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
                <div className="space-y-4">
                    <div>
                        <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Tipo de Molde</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {['SUBLIMACION', 'MOLDES CLIENTES'].map(m => (
                                <button
                                    key={m}
                                    type="button"
                                    onClick={() => {
                                        setMoldType(m);
                                        if (m === 'MOLDES CLIENTES' && fabricOrigin === 'TELA SUBLIMADA EN USER') setFabricOrigin('TELA CLIENTE');
                                        if (m === 'SUBLIMACION') setFabricOrigin('TELA SUBLIMADA EN USER');
                                    }}
                                    className={`p-3 rounded-xl text-[9px] font-black border-2 transition-all ${moldType === m ? 'bg-brand-cyan text-zinc-100 border-brand-cyan shadow-lg shadow-brand-cyan/20' : 'bg-zinc-800/50 text-zinc-500 border-zinc-700/50 hover:border-zinc-600'}`}
                                >
                                    {m}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div>
                        <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Origen de la Tela</label>
                        <CustomSelect
                            value={fabricOrigin}
                            onChange={(val) => setFabricOrigin(val)}
                            options={[
                                ...(moldType !== 'MOLDES CLIENTES' ? [{ value: 'TELA SUBLIMADA EN USER', label: 'TELA SUBLIMADA EN USER' }] : []),
                                { value: 'TELA CLIENTE', label: 'TELA CLIENTE' },
                                { value: 'TELA STOCK USER', label: 'TELA STOCK USER' }
                            ]}
                            disabled={moldType === 'SUBLIMACION'}
                            variant="black"
                            size="small"
                        />

                        {fabricOrigin === 'TELA CLIENTE' && moldType !== 'SUBLIMACION' && (
                            <div className="mt-3 animate-fade-in bg-zinc-800/30 p-4 rounded-xl border border-zinc-700/50">
                                <label className="block text-[10px] uppercase font-black text-zinc-500 mb-2 tracking-widest">Bobina de Tela *</label>
                                {bobinasDisponibles.length === 0 ? (
                                    <p className="text-[11px] font-bold text-amber-500/90">
                                        Sin bobinas de tela disponibles. Entregá tu tela en recepción para poder usarla en pedidos.
                                    </p>
                                ) : (
                                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                        {bobinasDisponibles.map(b => (
                                            <button
                                                key={b.BobinaID}
                                                type="button"
                                                onClick={() => setSelectedBobina(selectedBobinaId === b.BobinaID ? null : b)}
                                                className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                                                    selectedBobinaId === b.BobinaID
                                                        ? 'border-brand-gold bg-brand-gold/10'
                                                        : 'border-zinc-700/50 bg-zinc-900/40 hover:border-zinc-500'
                                                }`}
                                            >
                                                <div className="font-black text-xs text-zinc-100">{b.DescripcionTela || 'Tela sin descripción'}</div>
                                                <div className="flex gap-3 mt-1 text-[10px] font-bold text-zinc-500 flex-wrap">
                                                    {b.FechaIngreso && <span>📅 {new Date(b.FechaIngreso).toLocaleDateString()}</span>}
                                                    <span className="font-mono">{b.CodigoEtiqueta}</span>
                                                    <span className="text-emerald-400">▸ {parseFloat(b.MetrosRestantes).toFixed(2)} m largo</span>
                                                    {/* Ancho REAL (confirmado); fallback al declarado */}
                                                    {(b.AnchoReal ?? b.Ancho) && <span>↔ {parseFloat(b.AnchoReal ?? b.Ancho).toFixed(2)} m ancho</span>}
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                <div className="flex flex-col justify-center">
                    {moldType === 'SUBLIMACION' ? null : (
                        <div className="bg-zinc-800/20 p-5 rounded-2xl border border-zinc-700/30">
                            <label className="block text-[10px] uppercase font-black text-brand-gold mb-3 tracking-widest text-center">Archivos de Tizada</label>
                            <FileUploadZone
                                id="tizada-upload-tree"
                                label="Subir Tizadas"
                                onFileSelected={(files) => handleMultipleSpecializedFileUpload(files)}
                                selectedFile={tizadaFiles.length > 0}
                                multiple={true}
                                color="amber"
                            />
                            {tizadaFiles.length > 0 && (
                                <div className="mt-4 flex flex-wrap gap-2">
                                    {tizadaFiles.map((tf, i) => (
                                        <div key={i} className="bg-zinc-800 border border-zinc-700 rounded-lg py-1.5 px-3 flex items-center gap-2">
                                            <span className="text-[10px] font-bold text-zinc-300 truncate max-w-[140px]">{tf.name}</span>
                                            <button type="button" onClick={() => setTizadaFiles(tizadaFiles.filter((_, idx) => idx !== i))} className="text-zinc-500 hover:text-red-500 transition-colors"><Trash2 size={12} /></button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            )}
        </div>
    </div>
);

export default CorteTechnicalUI;
