import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { REFRESCAR_SI_MAS_DE_MS, tomarTizadaPrecargada, verTizadaPrecargada } from './solicitudPrecarga';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, FileSpreadsheet, Loader2, Plus, RefreshCw, Send, Trash2, Wand2 } from 'lucide-react';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFechaHora } from '../../../utils/fechas';
import { BTN_PRIMARIO, BTN_SECUNDARIO, INPUT, Miniatura, PiezaConArte, SEL_CAMPO, TarjetaPieza, avisarGuardado, claseSel, errorDe, piezaDelArte, useConfirmar, usePiezasArte } from './solicitudesComunes';
import Selector from '../../ui/Selector';
import ArteExtrasTabla from './ArteExtrasTabla';   // [EXTRAS EN LA TABLA 14/10] qué lleva cada diseño, en una sola tabla
import { MedidaDiseno, PlantillaAMedida } from './TizadaProAMedida';   // [A MEDIDA] pañuelos, toallas, banderas (13/10)

/**
 * TIZADA PRO (por API) en la solicitud: los DISEÑOS del producto (jugador, golero…: nombre + arte; el modelo
 * y las telas son los de "Piezas y telas", para todos) y la LISTA DE TALLES con la planilla del molde
 * (las columnas las define el molde en TIZADA). Con eso se manda el pedido a
 * TIZADA y vuelve la tizada como diseño pronto de la producción principal ("diseño automático").
 * Estructura y validación: backend/services/solicitudesVendedorTizadaPro.js (la pantalla repite las
 * reglas solo para avisar en vivo; la que manda es la del servidor).
 */
const ESTADO_ENVIO = {
    REVISADO: { txt: 'Revisado · TIZADA lo aceptaría', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
    EN_COLA: { txt: 'En cola en TIZADA', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    PROCESANDO: { txt: 'TIZADA la está armando', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    LISTO: { txt: 'Lista · cargando en la solicitud', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    APLICANDO: { txt: 'Cargando en la solicitud', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    APLICADO: { txt: 'Tizada cargada', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    RECHAZADO: { txt: 'Rechazado por TIZADA', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
    ERROR: { txt: 'Error en TIZADA', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
    ERROR_APLICAR: { txt: 'Volvió, pero no se pudo cargar', cls: 'bg-rose-100 text-rose-700 border-rose-200' },
    CANCELADO: { txt: 'Cancelado', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};
const sinTilde = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// Achica la imagen de un editable a una miniatura (máx. 100 px) para guardarla con lo leído y verla al volver a entrar.
const miniatura = (src, max = 100) => new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        ok(c.toDataURL('image/png'));
    };
    img.onerror = () => ok(null);
    img.src = src;
});
// [ARTE ARRIBA 12/10] De quién es un arte recién subido: lo dice el nombre del archivo, o el primero libre.
const DUENOS = ['JUGADOR', 'GOLERO', 'ALTERNATIVA', 'ARQUERO'];
// La lista manda: las variantes son las de la columna Variante de la lista de jugadores.
const variantesDeLista = (fs) => [...new Set(fs.map(f => String(f.diseno || '').trim().toUpperCase()).filter(Boolean))];
// Nunca se inventa una variante: con lista, la primera de la lista que no tiene arte (o la que nombra el archivo);
// sin lista, la que nombra el archivo, o JUGADOR si es el primer arte. Si no hay ninguna, null = el arte queda sin
// asignar y el usuario elige de quién es (o que reemplaza al arte de una variante).
const duenoSugerido = (nombreArchivo, usados, deLista) => {
    const n = sinTilde(nombreArchivo);
    if (deLista.length) {
        const libres = deLista.filter(x => !usados.includes(x));
        return libres.find(x => n.includes(sinTilde(x))) || libres[0] || null;
    }
    const porNombre = /golero|arquero|portero/.test(n) ? 'GOLERO' : /jugador/.test(n) ? 'JUGADOR' : /altern/.test(n) ? 'ALTERNATIVA' : null;
    if (porNombre && !usados.includes(porNombre)) return porNombre;
    return usados.length ? null : 'JUGADOR';
};
const filaVacia = (columnas, diseno) => ({ diseno: diseno || '', ...Object.fromEntries(columnas.map(c => [c.id, ''])) });

// Portal: piezas y telas de UN arte (su pestaña). La tela de cada pieza es la de "Piezas y telas" salvo que este arte
// tenga la suya (telasPropias); tocar la pieza deja elegirla ahí mismo y se guarda sola (onCambiar).
function PiezasArte({ id, d, molde, subl, puede, onCambiar }) {
    const vistas = usePiezasArte(id, d?.arteArchivoId);
    const [abierta, setAbierta] = useState(null);
    const modelo = (molde?.modelos || []).find(m => m.clave === subl?.modeloClave);
    if (!modelo) return null;
    const telas = molde?.telas || [];
    const base = new Map((subl?.piezas || []).map(x => [x.pieza, x]));
    const nombreTela = (tid) => telas.find(t => String(t.proIdProducto) === String(tid))?.nombre || null;
    return (
        <div className="px-3 pb-3 pt-1">
            <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1.5">Piezas y telas de {d.nombre} <span className="normal-case font-normal">tocá una pieza para cambiarle la tela</span></div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {modelo.piezas.map(z => {
                    const v = piezaDelArte(vistas, z.pieza, z.generico);
                    const telaId = z.telaFija ? z.telaFija.proIdProducto : (d.telasPropias?.[z.pieza] || base.get(z.pieza)?.telaProIdProducto || '');
                    const tocable = puede && !z.telaFija && telas.length > 0;
                    const on = tocable && abierta === z.pieza;
                    return (
                        <TarjetaPieza key={z.pieza} titulo={z.generico || z.pieza} detalle={z.generico && z.generico !== z.pieza ? z.pieza : null}
                            figura={v || z.svgPath ? <PiezaConArte svgPath={z.svgPath} vista={v?.vista} alt={z.pieza} /> : <span className="w-10 h-12 shrink-0 rounded border border-dashed border-slate-300 inline-block" />}
                            telaNombre={z.telaFija ? z.telaFija.nombre : (nombreTela(telaId) || base.get(z.pieza)?.telaNombre)} fija={!!z.telaFija}
                            tocable={tocable} abierta={on} onAbrir={() => setAbierta(on ? null : z.pieza)} telas={telas} telaId={telaId}
                            onElegir={(t) => { setAbierta(null); if (String(t) !== String(telaId)) onCambiar(z.pieza, t); }}
                            extra={d.telasPropias?.[z.pieza] ? <div className="text-[10px] text-brand-cyan font-bold">propia de {d.nombre}</div> : null} />
                    );
                })}
            </div>
        </div>
    );
}

// Vista previa de un arte: el frente y la espalda con el diseño del cliente (las dibuja el servidor desde el .ai / .pdf).
// Mientras llega, "Dibujando…"; si no se pudo, la miniatura de Drive.
function VistaArte({ id, arte, piezasModelo = [] }) {
    const piezas = usePiezasArte(id, arte.ArchivoID);
    // el contorno de cada pieza mostrada: la pieza del modelo con el mismo nombre (Frente ↔ Frente 3)
    const contornoDe = (x) => piezasModelo.find(z => piezaDelArte([x], z.pieza, z.generico))?.svgPath || null;
    const principales = (piezas || []).filter(x => /frente|espalda/i.test(x.pieza)).slice(0, 2);
    const mostrar = principales.length ? principales : (piezas || []).slice(0, 2);
    if (piezas === null) return <div className="w-[150px] h-[120px] shrink-0 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center text-[11px] text-slate-400 gap-1"><Loader2 size={12} className="animate-spin" /> Dibujando…</div>;
    if (!mostrar.length) return <Miniatura a={{ UrlDrive: arte.url, NombreOriginal: arte.nombre }} tam={120} entera />;
    return (
        <a href={arte.url} target="_blank" rel="noreferrer" title={`Abrir "${arte.nombre}"`} className="flex shrink-0 gap-1.5">
            {mostrar.map(x => (
                <span key={x.pagina} className="flex flex-col items-center gap-0.5">
                    <PiezaConArte svgPath={contornoDe(x)} vista={x.vista} alt={x.pieza} className="h-[104px] w-[72px]" />
                    <span className="text-[10px] text-slate-500">{x.pieza}</span>
                </span>
            ))}
        </a>
    );
}

// Qué le falta a una fila (lo mismo que revisa el servidor)
function problemaFila(f, columnas, disenos) {
    for (const c of columnas) {
        const v = String(f[c.id] ?? '').trim();
        if (c.obligatoria && !v) return `Falta ${c.label.toLowerCase()}`;
        if (v && (c.tipo === 'talle' || c.tipo === 'lista') && c.opciones.length && !c.opciones.some(o => sinTilde(o) === sinTilde(v)) && !(c.tipo === 'lista' && v.includes('+'))) return `${c.label} "${v}" no existe`;
        if (v && c.tipo === 'numero' && !(Number(v) > 0)) return `${c.label} tiene que ser un número`;
    }
    if (String(f.diseno || '').trim() && !disenos.some(d => sinTilde(d.nombre) === sinTilde(f.diseno))) return `${String(f.diseno).toUpperCase()} no tiene arte`;
    if (!String(f.diseno || '').trim() && disenos.length > 1) return 'Falta la variante';
    return null;
}

// Pegar desde Excel: con encabezado (se reconocen las columnas por nombre) o sin él (en el orden de la tabla)
function leerPegado(texto, columnas) {
    const lineas = String(texto || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (!lineas.length) return [];
    const partir = (l) => (l.includes('\t') ? l.split('\t') : l.split(/[;,]/)).map(x => x.trim());
    const cab = partir(lineas[0]).map(sinTilde);
    const idx = {};
    columnas.forEach(c => { const i = cab.findIndex(h => h === sinTilde(c.label) || h === sinTilde(c.id)); if (i >= 0) idx[c.id] = i; });
    const iVar = cab.findIndex(h => ['variante', 'diseno', 'diseño'].map(sinTilde).includes(h));
    const conCabecera = Object.keys(idx).length > 0 || iVar >= 0;
    const orden = columnas.map(c => c.id);
    return (conCabecera ? lineas.slice(1) : lineas).map(l => {
        const v = partir(l);
        const f = { diseno: '' };
        if (conCabecera) { columnas.forEach(c => { f[c.id] = idx[c.id] != null ? (v[idx[c.id]] || '') : ''; }); if (iVar >= 0) f.diseno = (v[iVar] || '').toUpperCase(); }
        else { orden.forEach((id, i) => { f[id] = v[i] || ''; }); if (v.length > orden.length) f.diseno = (v[orden.length] || '').toUpperCase(); }
        // talles tal cual el molde (mayúsculas/minúsculas)
        columnas.filter(c => c.opciones.length).forEach(c => { const o = c.opciones.find(x => sinTilde(x) === sinTilde(f[c.id])); if (o) f[c.id] = o; });
        return f;
    }).filter(f => columnas.some(c => String(f[c.id]).trim()));
}

// modo 'carga' (solicitud, vendedor): diseños + lista + Revisar. modo 'diseno' (pantalla de Diseño): además la letra
// de nombre y número y "Generar tizada" (puedeGenerar lo decide la pantalla: diseñador y ya enviado a Diseño).
// medio: lo que va entre el arte y la lista ("2 · Piezas y telas"). archivosArte: los otros archivos de la producción
// principal (bocetos, referencias) y el botón de subir. onQuitarArte(archivo): quitar un arte. onPlanillaArchivo(file): el
// Excel con el que se cargó la lista queda adjunto como planilla del cliente.
// cliente: el pedido que arma el cliente en la Tienda del portal (sin el aviso de cómo se genera la tizada en Diseño)
// porArte(diseño, { disenos, guardarDisenos, ocupado }): lo que el portal pone dentro de la pestaña de cada arte (sus extras).
// mandar (pantalla de Diseño, 15/10): 'enviar' | 'rehacer' | null: el botón para mandar la tizada, junto a "Revisar en TIZADA"
export default function TizadaProBloque({ id, p, puede, onCargado, numero = null, extra = null, modo = 'carga', puedeGenerar = false, motivoNoGenerar = null, mandar = null, medio = null, archivosArte = null, onQuitarArte = null, onPlanillaArchivo = null, cliente = false, porArte = null, subirArchivos = null, extrasPortal = null }) {
    const enDiseno = modo === 'diseno';
    // [COMO LA TIENDA 14/10] La solicitud del vendedor se ve como el pedido de la Tienda: una pestaña por arte con su
    // vista y sus piezas y telas, la plantilla para bajar, la lista compacta y todo se guarda solo. Lo propio del
    // vendedor (de quién es cada arte, Pegar desde Excel, Revisar en TIZADA, lo que falta) sigue. Diseño no cambia.
    const tienda = cliente || !enDiseno;
    // Lo que la lista de solicitudes adelantó al pasar el mouse (solicitudPrecarga.js): si ya llegó, el bloque
    // se arma completo desde el primer cuadro, sin "Leyendo el molde…" (ni spinner) y sin aparecer después.
    // Acá solo se LEE (el render de montaje puede repetirse); se consume en el efecto.
    const pre0 = verTizadaPrecargada(id, p.ProductoSolID)?.data || null;
    const [info, setInfo] = useState(pre0?.[0] ?? null);
    const [molde, setMolde] = useState(pre0?.[1] ?? null);
    const [disenos, setDisenos] = useState(pre0?.[0]?.datos?.disenos || []);
    const [filas, setFilas] = useState(pre0?.[0]?.datos?.planilla || []);
    const [sucio, setSucio] = useState(!!pre0?.[0]?.sinGuardar);
    const [ocupado, setOcupado] = useState('');
    const [abiertos, setAbiertos] = useState(() => new Set());   // envíos con el detalle abierto (arrancan cerrados)
    const [verAnteriores, setVerAnteriores] = useState(false);    // los envíos viejos, ocultos detrás del último
    const alternar = (envioId) => setAbiertos(s => { const n = new Set(s); if (n.has(envioId)) n.delete(envioId); else n.add(envioId); return n; });
    const [leyendo, setLeyendo] = useState(() => new Set());   // artes cuyos editables se están leyendo (ArchivoID)
    const [sincronizando, setSincronizando] = useState(false);
    const fallidos = useRef(new Set());              // artes que no se pudieron leer (no se reintenta solo)
    const [errorArte, setErrorArte] = useState({});   // por qué no se pudo leer cada arte (se muestra en su tarjeta)
    const [arteSel, setArteSel] = useState(null);     // portal: la pestaña de arte abierta (ArchivoID)
    const [bajandoPlantilla, setBajandoPlantilla] = useState(false);   // portal: la plantilla del producto para armar el arte
    const [disenoSel, setDisenoSel] = useState(null); // portal a medida: la pestaña de diseño abierta (nombre)
    const [calcs, setCalcs] = useState({});           // portal a medida: las cuentas de TIZADA de cada diseño (para dibujarlo)
    const [dialogo, preguntar] = useConfirmar();

    // respetar: la recarga que sigue a un guardado solo (Tienda / vendedor) no pisa lo que se siguió escribiendo mientras
    // tanto; eso se guarda solo en un momento y ahí recarga de nuevo
    const aplicar = useCallback((v, m, respetar = false) => {
        setInfo(v); setMolde(m);
        if (respetar && ultimas.current?.sucio) return;
        setDisenos(v.datos?.disenos || []);
        setFilas(v.datos?.planilla || []);
        // Arranque propuesto (JUGADOR + su arte): falta guardarlo. Donde se guarda solo (Tienda / vendedor), un JUGADOR
        // sin arte no cuenta como cambio: guardarlo solo al abrir no sirve de nada y, con la puesta al día de los artes
        // (que saca los diseños sin arte), se guardaba en círculo: JUGADOR → nada → JUGADOR… (14/10)
        setSucio(!!v.sinGuardar && (!tienda || (v.datos?.disenos || []).some(d => d.arteArchivoId)));
    }, []);   // eslint-disable-line react-hooks/exhaustive-deps
    const cargar = useCallback(async (respetar = false) => {
        try {
            const [v, m] = await Promise.all([svc.tizadaProVer(id, p.ProductoSolID), svc.moldeDelProducto(id, p.ProductoSolID).catch(() => null)]);
            aplicar(v, m, respetar === true);
            return v;
        } catch (e) { toast.error(errorDe(e)); return null; }
    }, [id, p.ProductoSolID, aplicar]);
    const ultimoP = useRef(null);
    useEffect(() => {   // p cambia cuando la pantalla recarga (ej. después de "Enviar a TIZADA PRO")
        if (ultimoP.current === p) return;   // StrictMode repite el efecto con el mismo p
        const primera = ultimoP.current === null;
        ultimoP.current = p;
        if (primera) {
            const pre = tomarTizadaPrecargada(id, p.ProductoSolID);
            if (pre?.data) { if (Date.now() - pre.at > REFRESCAR_SI_MAS_DE_MS) cargar(); return; }   // ya en pantalla
            // Adelantado por la lista y todavía en camino: se espera eso mismo, sin pedirlo dos veces.
            if (pre) { pre.p.then(([v, m]) => aplicar(v, m)).catch(() => cargar()); return; }
        }
        cargar(tienda);
    }, [id, p, cargar, aplicar]);   // eslint-disable-line react-hooks/exhaustive-deps

    const columnas = info?.estructura?.columnas || [];
    // Columnas que se ven en la tabla. En el portal (cliente) no va la manga, salvo que el molde la pida obligatoria;
    // el Excel y las validaciones siguen usando todas.
    const colsTabla = cliente ? columnas.filter(c => c.obligatoria || !/manga/i.test(`${c.label} ${c.id}`)) : columnas;
    const modelos = molde?.modelos || [];
    const nombreModelo = (clave) => modelos.find(m => m.clave === clave)?.nombre || info?.piezas?.variableNombre || clave;
    const envioActivo = (info?.envios || []).find(e => ['EN_COLA', 'PROCESANDO', 'LISTO', 'APLICANDO'].includes(e.Estado));

    // Mientras TIZADA trabaja, la pantalla pregunta sola cada 15 s
    useEffect(() => {
        if (!envioActivo) return undefined;
        const t = setInterval(async () => {
            try {
                const r = await svc.tizadaProActualizar(id, envioActivo.EnvioID);
                if (r?.estado === 'APLICADO') { toast.success('TIZADA PRO terminó: la tizada quedó cargada como diseño pronto.'); onCargado?.(); }
                cargar();
            } catch (_) { /* el próximo intento */ }
        }, 15000);
        return () => clearInterval(t);
    }, [envioActivo, id, cargar, onCargado]);

    // [TIPO DEL EXTRA 14/10] Vendedor y Diseño: cómo se puede hacer cada bordado / DTF / TPU (la misma lista que el cliente
    // ve en la Tienda), para elegirlo en la tabla del arte, y (15/10) qué extras admite el producto, para agregarlos desde la
    // tabla. En el portal lo trae extrasPortal.
    const [cfgExtras, setCfgExtras] = useState({ formas: {}, extras: [] });
    const formas = cfgExtras.formas || {};
    useEffect(() => {
        if (extrasPortal) return undefined;
        let vivo = true;
        svc.formasDeExtras(id, p.ProductoSolID).then(r => { if (vivo) setCfgExtras({ formas: r?.formas || {}, extras: r?.extras || [] }); }).catch(() => { });
        return () => { vivo = false; };
    }, [id, p.ProductoSolID, !!extrasPortal]);   // eslint-disable-line react-hooks/exhaustive-deps

    const cantidadTotal = useMemo(() => filas.reduce((s, f) => {
        const col = columnas.find(c => c.rol === 'cantidad' || (c.tipo === 'numero' && /cant/i.test(c.label)));
        return s + (col && Number(f[col.id]) > 0 ? Number(f[col.id]) : 1);
    }, 0), [filas, columnas]);

    // [A MEDIDA · PORTAL] El cliente arma una toalla, bandera…: mandan los DISEÑOS (medida + cantidad + su arte o su
    // imagen), en el orden de TIZADA: primero la medida y después el arte. Un diseño existe antes que su arte.
    const porDisenos = cliente && !!info?.aMedida;
    // Lo que el producto define y el diseño guardado todavía no tiene (la medida única, la forma por defecto…) llega
    // completo del servidor: se guarda solo una vez, para que el pedido (y el resumen de la derecha) lo tengan.
    const completado = useRef(false);
    useEffect(() => {
        if (!porDisenos || completado.current || sucio) return;
        completado.current = true;
        const guardadas = p.Datos?.tizadaPro?.disenos || [];
        if (disenos.some((d, i) => JSON.stringify(d.medida || null) !== JSON.stringify(guardadas[i]?.medida || null))) setSucio(true);
    }, [porDisenos]);   // eslint-disable-line react-hooks/exhaustive-deps
    // [ARTE ARRIBA] Cuando hay un arte sin diseño, un diseño sin arte o editables sin leer, se pone al día solo.
    const firmaArte = info?.aplica ? JSON.stringify([
        (info.artes || []).filter(a => a.rol === 'ARTE_CLIENTE').map(a => a.ArchivoID),
        disenos.map(d => [d.nombre, d.arteArchivoId, d.editablesLeidoDe === d.arteArchivoId]),
        variantesDeLista(filas),
    ]) : '';
    const sincronizarRef = useRef(null);
    useEffect(() => {
        if (!firmaArte || !puede || sincronizando) return;
        const principal = (p.Partes || []).find(x => x.Tipo === 'PRINCIPAL')?.ParteID;
        const cards = (info.artes || []).filter(a => a.rol === 'ARTE_CLIENTE' && /\.(ai|pdf)$/i.test(a.nombre || '') && (!a.parteId || a.parteId === principal)
            && (porDisenos || !disenos.some(d => d.archivoCliente === a.ArchivoID)));   // [A MEDIDA] el original del cliente no es otro diseño
        const vig = new Set(cards.map(a => a.ArchivoID));
        const falta = porDisenos
            // a medida en el portal: solo un arte que ya no está, o editables sin leer del arte de un diseño
            ? disenos.some(d => (d.archivoCliente && !vig.has(d.archivoCliente)) || (d.arteArchivoId && (!vig.has(d.arteArchivoId) || (d.editablesLeidoDe !== d.arteArchivoId && !fallidos.current.has(d.arteArchivoId)))))
            : cards.some(a => !disenos.some(d => d.arteArchivoId === a.ArchivoID))
            // un diseño sin arte sobra solo si hay artes (sin ninguno, es el JUGADOR de arranque: no hay nada que poner al día)
            || disenos.some(d => (d.arteArchivoId ? !vig.has(d.arteArchivoId) : cards.length > 0))
            || (!cliente && !info?.aMedida && variantesDeLista(filas).length > 0 && disenos.some(d => d.arteArchivoId && !variantesDeLista(filas).includes(String(d.nombre || '').toUpperCase())))
            || disenos.some(d => d.arteArchivoId && vig.has(d.arteArchivoId) && d.editablesLeidoDe !== d.arteArchivoId && !fallidos.current.has(d.arteArchivoId));
        if (!falta || sincronizarRef.current === firmaArte) return;
        sincronizarRef.current = firmaArte;
        setSincronizando(true);
        sincronizar(disenos, filas).then(ds => asegurarExtras(ds)).catch(e => toast.error(errorDe(e))).finally(() => setSincronizando(false));
    }, [firmaArte, puede]);   // eslint-disable-line react-hooks/exhaustive-deps

    // Portal y vendedor (como la Tienda): la lista se guarda sola un momento después del último cambio (sin botón). No
    // mientras haya una fila en blanco recién agregada: el servidor descarta las vacías y desaparecería antes de que la escriba.
    const guardarRef = useRef(null);
    const ultimas = useRef({ filas, disenos, sucio });
    ultimas.current = { filas, disenos, sucio };
    // "Confirmar pedido" (PedidoTiendaView) y "Enviar a Diseño" (vendedor) piden guardar YA lo que quede pendiente y
    // esperan a que termine
    useEffect(() => {
        if (!tienda) return undefined;
        const alConfirmar = (e) => { if (ultimas.current.sucio && guardarRef.current) e.detail?.pendientes?.push(guardarRef.current(true)); };
        window.addEventListener('pedido-tienda:guardar', alConfirmar);
        return () => window.removeEventListener('pedido-tienda:guardar', alConfirmar);
    }, [tienda]);
    useEffect(() => {
        if (!tienda || !sucio || !puede || !info?.aplica) return undefined;
        const cols = info?.estructura?.columnas || [];
        if (!info.aMedida && filas.some(f => !cols.some(c => String(f[c.id] || '').trim()))) return undefined;   // a medida la lista la arma el servidor
        const t = setTimeout(() => guardarRef.current?.(true), 1200);
        return () => clearTimeout(t);
    }, [tienda, sucio, puede, filas, disenos, info]);

    // Mientras llega, nada (antes: "Leyendo el molde en TIZADA PRO…" con spinner, que se veía girar al abrir).
    if (!info || !info.aplica) return null;
    const am = info.aMedida || null;   // [A MEDIDA] { config, telas, nombres, lados, plantilla… } o null
    // [PLANTILLA 14/10] Portal, prenda con talles: la plantilla de TIZADA del producto (molde + modelo), la misma de la
    // foto de la Tienda, para que el cliente arme su arte sobre ella. La primera vez TIZADA la arma en unos segundos.
    const bajarPlantillaProducto = async () => {
        if (bajandoPlantilla || !p.ProIdProducto) return;
        setBajandoPlantilla(true);
        try {
            const r = await svc.plantillaDelProducto(p.ProIdProducto);
            const blob = await svc.plantillaDelProductoArchivo(p.ProIdProducto);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = r?.nombre || 'Plantilla.ai'; document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
            toast.success(`Plantilla descargada: abrila en Illustrator, armá ${cliente ? 'tu' : 'el'} diseño sobre cada pieza y subí ese archivo acá.`);
        } catch (e) { toast.error(errorDe(e)); } finally { setBajandoPlantilla(false); }
    };

    // ── [ARTE ARRIBA 12/10] Un arte (.ai/.pdf de la producción principal) = un diseño. Al subirlo se le pone dueño
    // (JUGADOR, GOLERO…) y se leen sus editables solos; todo se guarda solo. Sin botones ni pasos aparte.
    const serviciosDelProducto = (p.Partes || []).map(x => x.Tipo);
    const principalId = (p.Partes || []).find(x => x.Tipo === 'PRINCIPAL')?.ParteID;
    // [EXTRAS EN LA TABLA 14/10] Los extras que puede llevar cada diseño: en el portal, los del producto (extrasPortal, con
    // su cobro, si es obligatorio y sus opciones); para el vendedor (15/10, como la Tienda), los que admite el producto y los
    // que ya tiene la solicitud: uno que todavía no está se agrega al usarlo (parteDeExtra).
    const NOMBRE_EXTRA = { BORDADO: 'Bordado', DTF: 'Estampado DTF', TPU: 'Estampado TPU' };
    const PROC_T = { BORDADO: 'bordado', DTF: 'dtf', TPU: 'tpu' };
    const serviciosExtra = extrasPortal
        ? (extrasPortal.lista || []).map(e => ({ tipo: e.tipo, nombre: e.nombre, cobro: e.cobro || null, obligatorio: !!e.obligatorio, opciones: e.opciones || [], opcionId: e.opcionId || null, parteId: e.parteId || null }))
        : ['BORDADO', 'DTF', 'TPU'].map(T => {
            const x = (p.Partes || []).find(pa => pa.Tipo === T) || null;
            const cfg = (cfgExtras.extras || []).find(e => e.tipo === T) || null;
            if (!x && !cfg) return null;
            // el tipo que tiene el servicio: el elegido acá, o el que coincide con lo cargado en el formulario (variante + material)
            const ops = formas[T] || [];
            const dd = x?.Datos || {};
            const op = ops.find(o => o.id === dd.opcionId) || (dd.material ? ops.find(o => o.material === dd.material && (!dd.variante || !o.variante || o.variante === dd.variante)) : null) || null;
            return { tipo: T, nombre: x?.Nombre || cfg?.nombre || NOMBRE_EXTRA[T], cobro: cfg?.cobro || (x?.IncluidoEnProducto ? 'INCLUIDA' : null), obligatorio: !!cfg?.obligatorio,
                opciones: ops.map(o => ({ id: o.id, nombre: o.nombre })), opcionId: op?.id || null, parteId: x?.ParteID || null,
                actual: dd.material ? [T === 'DTF' ? null : dd.variante, dd.material].filter(Boolean).join(' · ') : null };
        }).filter(Boolean);
    // Las piezas del modelo (para ubicar lo que va aparte del arte); sin modelo, las del molde
    const modeloSel = (molde?.modelos || []).find(m => m.clave === p.Datos?.sublimacion?.modeloClave) || null;
    const piezasMolde = [...new Set(((modeloSel?.piezas || []).map(z => z.generico || z.pieza)).concat(modeloSel ? [] : (info?.estructura?.piezas || [])).filter(Boolean))];
    // Lo subido aparte para un diseño: los archivos de sus filas (o subidos con el prefijo "<DISEÑO>__", como antes)
    const deDisenoArch = (a, d) => String(a.nombre || '').toUpperCase().startsWith(`${String(d.nombre || '').toUpperCase()}__`);
    const filasArchivoDe = (d) => (info?.artesExtras || [])
        .filter(a => (d.extrasArchivos || []).some(x => x.archivoId === a.ArchivoID) || deDisenoArch(a, d))
        .map(a => { const x = (d.extrasArchivos || []).find(y => y.archivoId === a.ArchivoID) || {}; return { archivo: { ArchivoID: a.ArchivoID, NombreOriginal: a.nombre, UrlDrive: a.url }, tipo: x.tipo || a.tipo, pieza: x.pieza || null, detalle: x.detalle || null, opcionId: x.opcionId || null }; });
    const conFilas = (ds) => ds.map(x => ({ ...x, extrasArchivos: filasArchivoDe(x).map(f => ({ archivoId: f.archivo.ArchivoID, tipo: f.tipo, pieza: f.pieza, detalle: f.detalle, opcionId: f.opcionId })) }));
    // [A MEDIDA] Fuera del portal, el .ai/.pdf que subió el cliente para un diseño no es otro diseño: ese diseño ya tiene
    // su arte armado para TIZADA (arteArchivoId). En el portal sí cuenta (es el arte que el cliente ve y cambia).
    const artesCards = (info?.artes || []).filter(a => a.rol === 'ARTE_CLIENTE' && /\.(ai|pdf)$/i.test(a.nombre || '') && (!a.parteId || a.parteId === principalId)
        && (porDisenos || !disenos.some(d => d.archivoCliente === a.ArchivoID)))
        .sort((a, b) => a.ArchivoID - b.ArchivoID);
    // Portal y vendedor: se ve un arte por vez (su pestaña); si la elegida ya no está, el primero
    const arteActivo = artesCards.some(x => x.ArchivoID === arteSel) ? arteSel : artesCards[0]?.ArchivoID;
    const artesVisibles = tienda ? artesCards.filter(a => a.ArchivoID === arteActivo) : artesCards;
    // La vista del arte (frente y espalda) y sus piezas y telas: prendas con talles (a medida va su medida)
    const vistaTienda = tienda && !am;
    const guardarCon = async (ds, fs) => {
        const v = await svc.tizadaProGuardar(id, p.ProductoSolID, { disenos: ds.map(d => ({ ...d, variableNombre: nombreModelo(d.variable) })), planilla: fs });
        setInfo(v); setDisenos(v.datos?.disenos || []); setFilas(v.datos?.planilla || []); setSucio(false);
        if (v.avisoEditables) toast.error(v.avisoEditables);
        onCargado?.();   // los editables en DTF / TPU / Bordado quedan como arte del cliente de cada servicio: refresca los archivos
        return v;
    };
    // Lee los editables de un arte (miniaturas chicas para guardarlas con lo leído)
    const leerDe = async (d) => {
        setLeyendo(x => new Set(x).add(d.arteArchivoId));
        try {
            const r = await svc.tizadaProEditables(id, p.ProductoSolID, d.arteArchivoId);
            const minis = await Promise.all(r.objetos.map(o => (o.vista ? miniatura(o.vista) : null)));
            return { ...d, editablesLeidoDe: d.arteArchivoId,
                editablesDetalle: r.objetos.map(({ vista, ...o }, k) => ({ ...o, vista: minis[k] })),
                editables: Object.fromEntries(r.objetos.map(o => [o.objeto, (d.editables || {})[o.objeto] || o.sugerido])) };
        } finally { setLeyendo(x => { const n = new Set(x); n.delete(d.arteArchivoId); return n; }); }
    };
    // Pone los diseños al día con los artes: uno por arte (dueño propuesto), sin los de artes quitados, y con los
    // editables leídos. Si algo cambió, guarda.
    const sincronizar = async (base, baseFilas, forzar = false) => {
        const vigentes = new Set(artesCards.map(a => a.ArchivoID));
        if (porDisenos) {
            // [A MEDIDA · PORTAL] ningún diseño se crea ni se borra por los artes: el que perdió su arte queda sin arte
            // (y con su medida); el arte de cada diseño lo asigna la pantalla al subirlo. Solo se leen sus editables.
            let ds = base.map(d => (d.archivoCliente && !vigentes.has(d.archivoCliente) ? { ...d, archivoCliente: null } : d))
                .map(d => (d.arteArchivoId && !vigentes.has(d.arteArchivoId) ? { ...d, arteArchivoId: null, arteAuto: null, editablesLeidoDe: null, editablesDetalle: [], editables: {} } : d));
            let cambio = forzar || ds.some((d, i) => d !== base[i]);
            for (const d of ds.filter(x => x.arteArchivoId && x.editablesLeidoDe !== x.arteArchivoId && !fallidos.current.has(x.arteArchivoId))) {
                try { const leido = await leerDe(d); ds = ds.map(x => (x === d ? leido : x)); cambio = true; }
                catch (e) { fallidos.current.add(d.arteArchivoId); setErrorArte(m => ({ ...m, [d.arteArchivoId]: errorDe(e) })); }
            }
            if (cambio) await guardarCon(ds, baseFilas);
            return;
        }
        // Portal: mandan los artes (cada arte es una referencia: JUGADOR, GOLERO…; la lista solo puede usar esas).
        // Vendedor: manda la lista (un diseño de una variante que la lista no tiene, sale).
        const deLista = (cliente || info?.aMedida) ? [] : variantesDeLista(baseFilas);
        // fuera: diseños sin arte vigente, o (con lista) de una variante que la lista no tiene
        let ds = base.filter(d => d.arteArchivoId && vigentes.has(d.arteArchivoId) && (!deLista.length || deLista.includes(String(d.nombre || '').toUpperCase())));
        const fs = baseFilas;   // la lista no se toca: manda ella
        let cambio = forzar || ds.length !== base.length;
        for (const a of artesCards) {
            if (ds.some(d => d.arteArchivoId === a.ArchivoID)) continue;
            // [A MEDIDA] cada arte es un diseño con su medida: DISEÑO 1, DISEÑO 2… (se puede renombrar)
            const libre = () => { let k = ds.length + 1; while (ds.some(d => d.nombre === `DISEÑO ${k}`)) k++; return `DISEÑO ${k}`; };
            const nombre = info?.aMedida ? libre() : duenoSugerido(a.nombre, ds.map(d => d.nombre), deLista)
                || (cliente ? DUENOS.find(x => !ds.some(d => d.nombre === x)) || `DISEÑO ${ds.length + 1}` : null);
            if (!nombre) continue;   // sin variante libre: que el usuario diga de quién es
            ds = [...ds, { nombre, arteArchivoId: a.ArchivoID }];
            cambio = true;
        }
        const pendientes = ds.filter(d => d.editablesLeidoDe !== d.arteArchivoId && !fallidos.current.has(d.arteArchivoId));
        for (const d of pendientes) {
            try { const leido = await leerDe(d); ds = ds.map(x => (x === d ? leido : x)); cambio = true; }
            catch (e) { fallidos.current.add(d.arteArchivoId); setErrorArte(m => ({ ...m, [d.arteArchivoId]: errorDe(e) })); }
        }
        if (cambio) await guardarCon(ds, fs);
        return ds;
    };
    // [FASE 1 15/10] Vendedor: los objetos del arte que (por su capa) van en un extra que la solicitud todavía no tiene lo
    // agregan solos (si el producto lo admite) y se vuelve a guardar para que su arte quede adjunto a ese servicio.
    const asegurarExtras = async (ds) => {
        if (extrasPortal || enDiseno || !ds) return;
        const faltan = serviciosExtra.filter(s => !s.parteId && ds.some(d => (d.editablesDetalle || []).some(o => ((d.editables || {})[o.objeto] || o.sugerido) === PROC_T[s.tipo])));
        if (!faltan.length) return;
        let agregue = false;
        for (const s of faltan) {
            try { await svc.cambiarExtra(id, p.ProductoSolID, s.tipo, true); agregue = true; toast.info(`${s.nombre} se agregó a la solicitud: lo usa el arte.`); }
            catch (e) { toast.error(errorDe(e)); }
        }
        if (agregue) await guardarCon(ds, ultimas.current.filas);
    };
    const correr = async (fn) => {
        setSincronizando(true);
        try { await fn(); } catch (e) { toast.error(errorDe(e)); } finally { setSincronizando(false); }
    };
    // Cambiar el "De": qué variante de la lista imprime este arte. La lista no cambia.
    const cambiarDueno = (arteId, nombre) => correr(async () => {
        const d = disenos.find(x => x.arteArchivoId === arteId);
        if (!nombre || (d && nombre === d.nombre)) return;
        // si esa variante ya tenía otro arte, este lo reemplaza (el otro queda sin asignar)
        let ds = disenos.filter(x => x === d || x.nombre !== nombre);
        ds = d ? ds.map(x => (x === d ? { ...x, nombre } : x)) : [...ds, { nombre, arteArchivoId: arteId }];
        await sincronizar(ds, filas, true);   // lee los editables si hace falta y guarda
        toast.success(`"${artesCards.find(a => a.ArchivoID === arteId)?.nombre}" es el arte de ${nombre}.`);
    });
    // Portal: renombrar la referencia de un arte (JUGADOR → TITULAR). Las filas de la lista con ese nombre pasan al nuevo.
    const renombrar = (arteId, texto) => correr(async () => {
        const nuevo = String(texto || '').trim().toUpperCase().slice(0, 40);
        const d = disenos.find(x => x.arteArchivoId === arteId);
        if (!nuevo || (d && nuevo === d.nombre)) return;
        if (disenos.some(x => x !== d && x.nombre === nuevo)) { toast.error(`Ya hay un arte con la referencia ${nuevo}.`); return; }
        const fs = d ? filas.map(f => (String(f.diseno || '').toUpperCase() === d.nombre ? { ...f, diseno: nuevo } : f)) : filas;
        const ds = d ? disenos.map(x => (x === d ? { ...x, nombre: nuevo } : x)) : [...disenos, { nombre: nuevo, arteArchivoId: arteId }];
        await sincronizar(ds, fs, true);
    });
    // Portal: la tela de una pieza en ESTE arte. Igual a la de "Piezas y telas" = sin tela propia.
    const cambiarTelaArte = (arteId, pieza, telaId) => correr(async () => {
        const base = (p.Datos?.sublimacion?.piezas || []).find(x => x.pieza === pieza)?.telaProIdProducto;
        await guardarCon(disenos.map(x => {
            if (x.arteArchivoId !== arteId) return x;
            const tp = { ...(x.telasPropias || {}) };
            if (String(base) === String(telaId)) delete tp[pieza]; else tp[pieza] = String(telaId);
            return { ...x, telasPropias: tp };
        }), filas);
    });
    const cambiarProceso = (arteId, objeto, valor) => correr(async () => {
        await guardarCon(disenos.map(x => {
            if (x.arteArchivoId !== arteId) return x;
            const n = { ...x, editables: { ...(x.editables || {}), [objeto]: valor } };
            // Portal: marcar un editable en DTF / TPU / Bordado = este arte lleva ese extra
            if (cliente && valor !== 'sublimado') { const T = valor.toUpperCase(); n.extras = { ...(x.extras || {}), [T]: { ...(x.extras?.[T] || {}), activo: true } }; }
            return n;
        }), filas);
    });
    // [EXTRAS EN LA TABLA] La parte del servicio donde va el archivo; en el portal, si el extra todavía no está en el
    // pedido, se prende (extrasPortal.activar devuelve su parte).
    const parteDeExtra = async (T) => {
        const s = serviciosExtra.find(x => x.tipo === T);
        if (s?.parteId) return s.parteId;
        if (extrasPortal?.activar) return extrasPortal.activar(T);
        if (enDiseno) return null;
        // [FASE 1 15/10] Vendedor: se agrega a la solicitud (sin "Servicios y extras" en el formulario)
        const r = await svc.cambiarExtra(id, p.ProductoSolID, T, true);
        onCargado?.();
        return r?.ParteID || null;
    };
    // [FASE 1 15/10] Vendedor: un extra opcional que ya no usa ningún objeto ni fila sale de la solicitud (si no, al convertir
    // saldría una orden vacía). El servidor no lo quita si va incluido, ya está en Diseño o tiene archivos subidos.
    const quitarSinUso = async (ds) => {
        if (extrasPortal || enDiseno) return;
        const usa = (T) => ds.some(d => (d.editablesDetalle || []).some(o => ((d.editables || {})[o.objeto] || o.sugerido) === PROC_T[T]) || (d.extrasArchivos || []).some(x => x.tipo === T));
        let quito = false;
        for (const s of serviciosExtra) {
            if (!s.parteId || s.obligatorio || usa(s.tipo)) continue;
            const r = await svc.cambiarExtra(id, p.ProductoSolID, s.tipo, false).catch(() => null);
            if (r?.quitado) { quito = true; toast.info(`${s.nombre} salió de la solicitud: ningún objeto lo usa.`); }
        }
        if (quito) onCargado?.();
    };
    // [TIPO POR OBJETO 15/10] El tipo de UN objeto del arte (DTF común en el frente, dorado en la espalda…): queda en el
    // diseño (formas, por "<objeto>|<pieza>"); al guardar, el servidor lo pasa al archivo de ese objeto, el DTF arma un
    // pliego por film y al convertir cada orden toma el suyo. Portal y vendedor igual.
    const cambiarForma = (d, clave, opcionId) => correr(() => guardarCon(conFilas(disenos).map(x => (x.nombre !== d.nombre ? x
        : { ...x, formas: { ...(x.formas || {}), [clave]: opcionId } })), filas));
    const procesoTabla = (arteId, objeto, valor) => correr(async () => {
        const T = { dtf: 'DTF', tpu: 'TPU', bordado: 'BORDADO' }[valor];
        if (T) await parteDeExtra(T);   // portal y vendedor: si el extra no está, se agrega
        const v = await guardarCon(conFilas(disenos).map(x => (x.arteArchivoId !== arteId ? x : { ...x, editables: { ...(x.editables || {}), [objeto]: valor } })), filas);
        await quitarSinUso(v?.datos?.disenos || []);
    });
    const agregarExtra = (d, T, file) => correr(async () => {
        const parteId = await parteDeExtra(T);
        if (!parteId) throw new Error(`Esta solicitud no tiene ${T === 'BORDADO' ? 'Bordado' : T}: agregalo como servicio y volvé a intentar.`);
        const [hecho] = await subirArchivos([new File([file], `${d.nombre}__${file.name}`, { type: file.type })], { Rol: 'ARTE_CLIENTE', ParteID: parteId }, T);
        if (!hecho?.ArchivoID) return;
        await guardarCon(conFilas(disenos).map(x => (x.nombre !== d.nombre ? x : {
            ...x, extrasArchivos: [...x.extrasArchivos.filter(y => y.archivoId !== hecho.ArchivoID), { archivoId: hecho.ArchivoID, tipo: T, pieza: piezasMolde[0] || null, detalle: null }],
        })), filas);
        toast.success('Agregado. Elegí en qué pieza va y, si querés, el detalle (ej. pecho izquierdo, 8 cm).');
    });
    const cambiarFilaExtra = (d, aid, cambio) => correr(() => guardarCon(conFilas(disenos).map(x => (x.nombre !== d.nombre ? x
        : { ...x, extrasArchivos: x.extrasArchivos.map(y => (y.archivoId === aid ? { ...y, ...cambio } : y)) })), filas));
    const quitarFilaExtra = (d, aid) => correr(async () => {
        if (!(await preguntar({ Icono: Trash2, titulo: 'Quitar el extra', texto: 'Se quita este extra y su archivo de la solicitud.', boton: 'Quitar', peligro: true }))) return;
        await svc.quitarArchivo(id, aid);
        const v = await guardarCon(conFilas(disenos).map(x => (x.nombre !== d.nombre ? x : { ...x, extrasArchivos: x.extrasArchivos.filter(y => y.archivoId !== aid) })), filas);
        await quitarSinUso(v?.datos?.disenos || []);
    });
    // Portal: lo que pone la pantalla dentro de la pestaña de cada arte (sus extras) guarda con esto: fn(diseño) → diseño
    const guardarDisenos = (fn) => correr(() => guardarCon(disenos.map(fn), filas));
    const volverALeer = (arteId) => correr(async () => {
        fallidos.current.delete(arteId);
        setErrorArte(m => { const n = { ...m }; delete n[arteId]; return n; });
        await sincronizar(disenos.map(x => (x.arteArchivoId === arteId ? { ...x, editablesLeidoDe: null } : x)), filas);
    });
    // [A MEDIDA] la medida, la tela o la cantidad de un diseño (queda sin guardar hasta "Guardar medidas")
    const cambiarDiseno = (arteId, patch) => { setDisenos(ds => ds.map(x => (x.arteArchivoId === arteId ? { ...x, ...patch } : x))); setSucio(true); };
    const cambiarFila = (i, col, v) => { setFilas(fs => fs.map((f, k) => (k === i ? { ...f, [col]: v } : f))); setSucio(true); };
    const agregarFila = () => { setFilas(fs => [...fs, filaVacia(columnas, disenos.length === 1 ? disenos[0].nombre : '')]); setSucio(true); };

    // solo = guardado automático del portal: sin aviso, y si la lista cambió mientras se guardaba, no se pisa lo nuevo
    const guardar = async (solo = false) => {
        const enviadas = { filas, disenos };
        setOcupado('guardar');
        if (solo) avisarGuardado('guardando');   // el indicador "Guardado" del encabezado de la solicitud
        try {
            const v = await svc.tizadaProGuardar(id, p.ProductoSolID, { disenos: disenos.map(d => ({ ...d, variableNombre: nombreModelo(d.variable) })), planilla: filas });
            setInfo(v);
            const cambio = solo && (ultimas.current.filas !== enviadas.filas || ultimas.current.disenos !== enviadas.disenos);
            if (!cambio) { setDisenos(v.datos?.disenos || []); setFilas(v.datos?.planilla || []); setSucio(false); }
            if (!solo) toast.success(v.errores?.length ? `Guardado. Para mandar a TIZADA falta: ${v.errores.length} cosa(s).` : (v.aMedida ? 'Medidas guardadas.' : 'Diseños y lista de talles guardados.'));
            if (v.avisoEditables) toast.error(v.avisoEditables);
            onCargado?.();   // los editables en DTF / TPU / Bordado quedaron como arte del cliente de cada servicio: refresca los archivos
            if (solo) avisarGuardado('ok');
        } catch (e) { toast.error(errorDe(e)); if (solo) avisarGuardado('error', errorDe(e)); } finally { setOcupado(''); }
    };
    guardarRef.current = guardar;
    const enviar = async (soloRevisar) => {
        setOcupado(soloRevisar ? 'revisar' : 'enviar');
        try {
            const r = await svc.tizadaProEnviar(id, p.ProductoSolID, soloRevisar);
            if (r.Estado === 'RECHAZADO') toast.error(`TIZADA no lo acepta: ${r.mensaje || 'mirá las alarmas abajo'}`);
            else toast.success(soloRevisar ? 'TIZADA PRO lo aceptaría. Todavía no se mandó.' : `Mandado a TIZADA PRO (${r.Referencia}). La tizada vuelve sola cuando termine.`);
            await cargar();
            if (!soloRevisar) onCargado?.();   // la pantalla de Diseño recarga el estado de la producción principal
        } catch (e) { toast.error(errorDe(e)); } finally { setOcupado(''); }
    };
    const actualizar = async (envio, reintentar) => {
        setOcupado(`act-${envio.EnvioID}`);
        try {
            const r = await svc.tizadaProActualizar(id, envio.EnvioID, reintentar);
            if (r?.estado === 'APLICADO') { toast.success('La tizada quedó cargada como diseño pronto.'); onCargado?.(); }
            else if (r?.mensaje) toast.error(r.mensaje);
            await cargar();
        } catch (e) { toast.error(errorDe(e)); } finally { setOcupado(''); }
    };
    // Lo que se agrega desde Excel se guarda en el momento; si vino de un archivo, el archivo queda adjunto como
    // planilla del cliente (12/10: ya no hace falta la sección "Planilla original del cliente").
    const agregarDesdeTexto = (texto, origen, archivo = null) => {
        const nuevas = leerPegado(texto, columnas).map(f => ({ ...f, diseno: f.diseno || (disenos.length === 1 ? disenos[0].nombre : '') }));
        if (!nuevas.length) return toast.warning(`No se encontró ninguna fila para agregar${origen ? ` en "${origen}"` : ''}.`);
        const todas = [...filas.filter(f => columnas.some(c => String(f[c.id] || '').trim())), ...nuevas];
        setFilas(todas);
        return correr(async () => {
            await guardarCon(disenos, todas);
            toast.success(`${nuevas.length} fila(s) agregadas desde ${origen ? `"${origen}"` : 'Excel'} y guardadas.`);
            if (archivo && onPlanillaArchivo) await onPlanillaArchivo(archivo);
        });
    };
    // Buscar el archivo: Excel (.xlsx/.xls, primera hoja) o texto (.csv/.txt); se lee igual que lo pegado
    const leerArchivo = async (ev) => {
        const file = ev.target.files?.[0];
        ev.target.value = '';
        if (!file) return;
        try {
            let texto;
            if (/\.(txt|csv|tsv)$/i.test(file.name)) texto = await file.text();
            else {
                const XLSX = await import('xlsx');
                const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
                texto = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]], { FS: '\t', blankrows: false });
            }
            agregarDesdeTexto(texto, file.name, file);
        } catch (e) { toast.error(`No se pudo leer "${file.name}": ${e.message}`); }
    };

    const errores = info.errores || [];
    const puedeMandar = puede && info.apiActiva && info.tabla && !sucio && !errores.length && !envioActivo;

    const conexion = (
        <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black ${info.apiActiva ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
            title={info.motivo || ''}>{info.apiActiva ? `Conectado · envío ${info.modoEnvio === 'AL_ENVIAR_A_DISENO' ? 'automático al enviar a Diseño' : 'con el botón'}` : 'Sin conexión con TIZADA'}</span>
    );
    const motivoNoMandar = !info.tabla ? 'Falta correr scripts/add_tizadapro_envios.sql en la base.'
        : !info.apiActiva ? info.motivo
            : sucio ? (tienda ? 'Guardando los cambios…' : 'Guardá los cambios antes de mandar.')
                : errores.length ? 'Completá lo que falta (abajo).'
                    : envioActivo ? `Ya hay un pedido en curso (${envioActivo.Referencia}).` : null;

    // ── [A MEDIDA · PORTAL] Una pestaña por diseño (cada uno con SU medida y SU cantidad: 10 de 70 × 140 y 5 de 50 × 100 son
    // dos diseños) y "+ Otro diseño". Adentro: la medida (MedidaDiseno, lo mismo que el vendedor, solo con lo que el producto
    // ofrece) y lo que pone el portal (porArte: su arte o su imagen, y sus extras). Todo se guarda solo.
    if (porDisenos) {
        const activo = disenos.find(d => d.nombre === disenoSel) || disenos[0] || null;
        const unidades = disenos.reduce((t, d) => t + (Number(d.cantidad) > 0 ? Number(d.cantidad) : 0), 0);
        const libre = () => { let k = disenos.length + 1; while (disenos.some(d => d.nombre === `DISEÑO ${k}`)) k++; return `DISEÑO ${k}`; };
        // el nuevo arranca con la medida y la tela del último (lo más común: otra imagen u otra cantidad de lo mismo)
        const agregarDiseno = () => correr(async () => {
            const ult = disenos[disenos.length - 1];
            const nombre = libre();
            await guardarCon([...disenos, { nombre, cantidad: 1, medida: ult?.medida || {}, tela: ult?.tela || null }], filas);
            setDisenoSel(nombre);
        });
        const quitarDiseno = async (d) => {
            if (!(await preguntar({ Icono: Trash2, titulo: 'Quitar el diseño', texto: `Se quita ${d.nombre} del pedido (su medida, su cantidad y su arte).`, boton: 'Quitar', peligro: true }))) return;
            correr(async () => { await guardarCon(disenos.filter(x => x !== d), filas); setDisenoSel(null); });
        };
        const renombrarDiseno = (d, texto) => correr(async () => {
            const nuevo = String(texto || '').trim().toUpperCase().slice(0, 40);
            if (!nuevo || nuevo === d.nombre) return;
            if (disenos.some(x => x !== d && x.nombre === nuevo)) { toast.error(`Ya hay un diseño ${nuevo}.`); return; }
            await guardarCon(disenos.map(x => (x === d ? { ...x, nombre: nuevo } : x)), filas);
            setDisenoSel(nuevo);
        });
        const cambiarMedida = (d, patch) => { setDisenos(ds => ds.map(x => (x.nombre === d.nombre ? { ...x, ...patch } : x))); setSucio(true); };
        return (
            <div className="text-xs space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                    {disenos.map(d => (
                        <button key={d.nombre} type="button" onClick={() => setDisenoSel(d.nombre)}
                            className={`px-3 py-1.5 rounded-lg border text-xs font-black transition-colors ${activo?.nombre === d.nombre ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : 'border-slate-200 text-slate-500 hover:text-slate-700'}`}>
                            {d.nombre} <span className="font-bold opacity-70">× {Number(d.cantidad) > 0 ? d.cantidad : 0}</span>
                        </button>
                    ))}
                    {puede && <button type="button" disabled={sincronizando} onClick={agregarDiseno} className="px-2.5 py-1.5 rounded-lg border border-dashed border-slate-300 text-xs font-bold text-slate-500 hover:text-brand-cyan hover:border-brand-cyan inline-flex items-center gap-1"><Plus size={12} /> Otro diseño</button>}
                    <span className="ml-auto text-[11px] text-slate-600"><b>{unidades}</b> unidad{unidades === 1 ? '' : 'es'}
                        {(sincronizando || ocupado === 'guardar') && <span className="ml-1.5 text-slate-400 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> guardando…</span>}</span>
                </div>
                {activo && (
                    <div className="border border-slate-200 rounded-xl overflow-hidden">
                        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100">
                            <span className="text-[11px] font-bold text-slate-500">Diseño</span>
                            <input key={activo.nombre} defaultValue={activo.nombre} placeholder="DISEÑO 1, ESCUDO…" disabled={!puede || sincronizando}
                                onBlur={e => renombrarDiseno(activo, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                className={`${INPUT} !w-44 !py-1 font-black uppercase`} title="El nombre de este diseño (para reconocerlo en el pedido)" />
                            {puede && disenos.length > 1 && <button type="button" disabled={sincronizando} onClick={() => quitarDiseno(activo)} title="Quitar este diseño" className="ml-auto text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>}
                        </div>
                        {/* primero el arte (y cómo queda: la forma con el arte y las tiras), después la medida, la tela y la cantidad */}
                        {porArte && <div className="px-3 pt-3">{porArte(activo, { disenos, guardarDisenos, ocupado: sincronizando, aMedida: am, seccion: 'arte', calc: calcs[activo.nombre] || null })}</div>}
                        <MedidaDiseno key={activo.nombre} id={id} p={p} d={activo} am={am} cliente puede={puede && !sincronizando} onCambiar={patch => cambiarMedida(activo, patch)}
                            onCalc={c => setCalcs(m => ({ ...m, [activo.nombre]: c?.ok ? c : null }))} />
                        {errorArte[activo.arteArchivoId] && <div className="px-3 py-2 text-[11px] text-rose-800 bg-rose-50 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span>{errorArte[activo.arteArchivoId]}</span></div>}
                        {/* [EXTRAS EN LA TABLA 14/10] los extras de este diseño en la misma tabla que las prendas con talles */}
                        {extrasPortal ? (serviciosExtra.length > 0 && <div className="px-3 pb-3"><ArteExtrasTabla d={activo} objetos={activo.editablesDetalle || []} servicios={serviciosExtra} filasArchivo={filasArchivoDe(activo)} piezas={piezasMolde}
                            puede={puede} ocupado={sincronizando} onProceso={(objeto, valor) => procesoTabla(activo.arteArchivoId, objeto, valor)}
                            onAgregar={subirArchivos ? (T, file) => agregarExtra(activo, T, file) : null} onCambiarFila={(aid, cambio) => cambiarFilaExtra(activo, aid, cambio)}
                            onQuitarFila={(aid) => quitarFilaExtra(activo, aid)} onForma={(clave, id) => cambiarForma(activo, clave, id)} /></div>)
                            : porArte && <div className="px-3 pb-3">{porArte(activo, { disenos, guardarDisenos, ocupado: sincronizando, aMedida: am, seccion: 'extras' })}</div>}
                    </div>
                )}
                {dialogo}
            </div>
        );
    }

    return (
        <div className="pt-3 mt-3 border-t border-slate-200 text-xs space-y-4">
            {/* ── [ARTE ARRIBA 12/10] 1 · Arte del cliente: un .ai/.pdf por diseño. Arriba dice de quién es; los
                editables se leen solos al subirlo y se elige el proceso de cada uno. Todo se guarda solo. ── */}
            <div>
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 mb-1.5 flex items-center gap-2">1 · Arte del cliente
                    <span className="normal-case font-normal">un archivo .ai o .pdf por diseño, con todas las piezas</span>
                    {sincronizando && <span className="normal-case font-bold text-brand-cyan inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> guardando…</span>}
                    {tienda && !am && p.ProIdProducto && (
                        <button type="button" onClick={bajarPlantillaProducto} disabled={bajandoPlantilla} title={`La base del molde para armar ${cliente ? 'tu' : 'el'} arte en Illustrator: una mesa por pieza, a tamaño real`}
                            className={`${BTN_SECUNDARIO} ml-auto normal-case tracking-normal`}>
                            {bajandoPlantilla ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />} {bajandoPlantilla ? 'Preparando la plantilla…' : cliente ? 'Bajar la plantilla para tu arte' : 'Bajar la plantilla para el arte'}
                        </button>
                    )}</div>
                {/* Portal y vendedor: una pestaña por arte (su referencia: JUGADOR, GOLERO…) y se ve uno por vez, con sus piezas y telas */}
                {tienda && artesCards.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                        {artesCards.map(a => {
                            const d = disenos.find(x => x.arteArchivoId === a.ArchivoID);
                            const on = artesVisibles[0]?.ArchivoID === a.ArchivoID;
                            return (
                                <button key={a.ArchivoID} type="button" onClick={() => setArteSel(a.ArchivoID)}
                                    className={`px-3 py-1.5 rounded-lg border text-xs font-black transition-colors ${on ? 'border-brand-cyan bg-brand-cyan/10 text-brand-cyan' : !d && !cliente ? 'border-amber-300 text-amber-700' : 'border-slate-200 text-slate-500 hover:text-slate-700'}`}>
                                    {d?.nombre || (cliente ? 'Sin referencia' : 'Sin asignar')}
                                </button>
                            );
                        })}
                    </div>
                )}
                <div className="space-y-2">
                    {artesVisibles.map(a => {
                        const d = disenos.find(x => x.arteArchivoId === a.ArchivoID);
                        const deLista = variantesDeLista(filas);
                        const opciones = [...new Set([...(d ? [d.nombre] : []), ...(deLista.length ? deLista : DUENOS)])];
                        const arteDeOtro = (n) => disenos.find(x => x !== d && x.nombre === n);
                        const lee = leyendo.has(a.ArchivoID);
                        const objetos = d?.editablesDetalle || [];
                        return (
                            <div key={a.ArchivoID} className="border border-slate-200 rounded-xl overflow-hidden">
                                <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100">
                                    {(cliente || am) ? <>
                                        {/* Portal: la referencia se escribe (JUGADOR, GOLERO, TITULAR…); la lista solo puede usar estas.
                                            [A MEDIDA] el nombre del diseño (DISEÑO 1, ESCUDO, BANDERÍN…): cada uno lleva su medida */}
                                        <span className="text-[11px] font-bold text-slate-500">{am ? 'Diseño' : 'Referencia'}</span>
                                        <input key={d?.nombre || 'sin'} defaultValue={d?.nombre || ''} placeholder={am ? 'DISEÑO 1, ESCUDO…' : 'JUGADOR, GOLERO…'} disabled={!puede || sincronizando}
                                            onBlur={e => renombrar(a.ArchivoID, e.target.value)} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                            className={`${INPUT} !w-40 !py-1 font-black uppercase`} title="El nombre de esta variante. Las filas de la lista con este nombre usan este arte." />
                                    </> : <>
                                    <span className="text-[11px] font-bold text-slate-500">De</span>
                                    <Selector value={d ? d.nombre : ''} disabled={!puede || sincronizando} onChange={e => cambiarDueno(a.ArchivoID, e.target.value)} claseBoton={claseSel(`border rounded-lg px-2.5 py-1 text-xs font-black bg-white min-w-[130px] ${d ? 'border-slate-300 text-slate-800' : 'border-amber-400 text-amber-700'}`)} anchoLista={280}>
                                        {!d && <option value="">— elegí de quién es —</option>}
                                        {opciones.map(n => <option key={n} value={n}>{arteDeOtro(n) ? `${n} (reemplaza al otro arte)` : n}</option>)}
                                    </Selector>
                                    </>}
                                    <a href={a.url} target="_blank" rel="noreferrer" className="text-[12px] font-bold text-slate-700 hover:text-brand-cyan hover:underline truncate max-w-[340px]" title={a.nombre}>{a.nombre}</a>
                                    <span className="ml-auto flex items-center gap-2">
                                        {lee && <span className="text-[11px] font-bold text-brand-cyan inline-flex items-center gap-1"><Loader2 size={12} className="animate-spin" /> Leyendo los editables…</span>}
                                        {puede && d && !lee && <button type="button" disabled={sincronizando} onClick={() => volverALeer(a.ArchivoID)} className="text-[11px] font-bold text-slate-400 hover:text-brand-cyan" title="Volver a leer los editables de este arte"><RefreshCw size={12} /></button>}
                                        {puede && onQuitarArte && <button type="button" disabled={sincronizando} title="Quitar este arte" className="text-slate-400 hover:text-rose-600"
                                            onClick={async () => { if (await preguntar({ Icono: Trash2, titulo: 'Quitar el arte', texto: `Se quita "${a.nombre}"${d ? ` (el arte de ${d.nombre})` : ''} de la solicitud.`, boton: 'Quitar', peligro: true })) onQuitarArte(a); }}><Trash2 size={14} /></button>}
                                    </span>
                                </div>
                                {/* Portal y vendedor: la vista previa del arte (frente y espalda) a la izquierda de sus editables */}
                                <div className={vistaTienda ? 'flex items-start gap-3 p-2' : ''}>
                                {vistaTienda && <VistaArte id={id} arte={a} piezasModelo={(molde?.modelos || []).find(m => m.clave === p.Datos?.sublimacion?.modeloClave)?.piezas || []} />}
                                <div className={vistaTienda ? 'flex-1 min-w-0' : ''}>
                                {/* [EXTRAS EN LA TABLA 14/10] Qué lleva este diseño: los objetos del arte (medida debajo de la imagen,
                                    cómo se hace y el cobro en la misma fila) y lo que va en bordado / DTF / TPU aparte del arte */}
                                {d && (objetos.length > 0 || serviciosExtra.length > 0 || filasArchivoDe(d).length > 0) && (
                                    <ArteExtrasTabla d={d} objetos={objetos} servicios={serviciosExtra} filasArchivo={filasArchivoDe(d)} piezas={piezasMolde}
                                        puede={puede} ocupado={sincronizando} todosLosProcesos={!cliente}
                                        onProceso={(objeto, valor) => procesoTabla(a.ArchivoID, objeto, valor)}
                                        onAgregar={subirArchivos ? (T, file) => agregarExtra(d, T, file) : null}
                                        onCambiarFila={(aid, cambio) => cambiarFilaExtra(d, aid, cambio)}
                                        onQuitarFila={(aid) => quitarFilaExtra(d, aid)}
                                        onForma={enDiseno ? null : (clave, id) => cambiarForma(d, clave, id)} />
                                )}
                                {d && !lee && d.editablesLeidoDe === a.ArchivoID && !objetos.length && <div className="px-3 py-1.5 text-[11px] text-slate-400">Sin editables: todo va sublimado.</div>}
                                {errorArte[a.ArchivoID] && !lee && <div className="px-3 py-2 text-[11px] text-rose-800 bg-rose-50 flex items-start gap-1.5"><AlertTriangle size={12} className="mt-0.5 shrink-0" /><span>{errorArte[a.ArchivoID]}</span></div>}
                                {/* [A MEDIDA] forma → punta → medida → terminación → tela → tiras, con las cuentas de TIZADA en vivo */}
                                {am && d && <MedidaDiseno id={id} p={p} d={d} am={am} arteId={a.ArchivoID} sucio={sucio} puede={puede && !sincronizando} onCambiar={patch => cambiarDiseno(a.ArchivoID, patch)} />}
                                {!d && am && <div className="px-3 py-2 text-[11px] text-amber-800 bg-amber-50">Escribí el nombre de este diseño: después se carga su medida.</div>}
                                {!d && !cliente && !am && <div className="px-3 py-2 text-[11px] text-amber-800 bg-amber-50">Este arte no es de ninguna variante de la lista{deLista.length ? ` (${deLista.join(', ')}${deLista.every(n => arteDeOtro(n)) ? ': todas ya tienen arte' : ''})` : ''}. Elegí de quién es; si es una versión nueva, elegí esa variante y reemplaza al arte anterior. Si no va, quitalo.</div>}
                                {!d && cliente && <div className="px-3 py-2 text-[11px] text-amber-800 bg-amber-50">Escribí la referencia de este arte (JUGADOR, GOLERO…).</div>}
                                </div>
                                </div>
                                {/* Portal: los extras de ESTE arte (cada camiseta puede llevar distintos), los arma la pantalla */}
                                {cliente && d && porArte && <div className="px-3 pb-3">{porArte(d, { disenos, guardarDisenos, ocupado: sincronizando })}</div>}
                                {vistaTienda && d && <PiezasArte id={id} d={d} molde={molde} subl={p.Datos?.sublimacion} puede={puede && !sincronizando}
                                    onCambiar={(pieza, telaId) => cambiarTelaArte(a.ArchivoID, pieza, telaId)} />}
                            </div>
                        );
                    })}
                    {!artesCards.length && <div className="text-slate-400">{am ? 'Todavía no hay arte. Subí un .ai o .pdf por diseño (cada uno con su medida), armado sobre la plantilla de TIZADA de ESA medida.' : 'Todavía no hay arte. Subí un .ai o .pdf por diseño (jugador, golero…) armado sobre la base de TIZADA.'}</div>}
                </div>
                {archivosArte}
            </div>

            {medio}

            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 flex items-center gap-1"><Wand2 size={12} /> {numero ? `${numero} · ` : ''}{enDiseno ? 'Tizada automática · TIZADA PRO' : am ? 'A medida · TIZADA PRO' : tienda ? 'Lista de jugadores' : 'Lista de jugadores · TIZADA PRO'}
                    {!cliente && (!tienda || am) && <span className="normal-case font-normal">— {am ? `${am.config.variableNombre || am.config.variable}${am.config.pieza ? ` (${am.config.pieza})` : ''}` : `molde ${molde?.moldeNombre || info.moldeRef}${info.estructura?.plantilla ? ` · ${info.estructura.plantilla}` : ''}`}</span>}</div>
                {/* Vendedor con la lista de jugadores (como la Tienda): sin la conexión con TIZADA. En Diseño va abajo, con los
                    botones de TIZADA (15/10) */}
                {!cliente && (!tienda || am) && !(enDiseno && (puede || puedeGenerar)) && conexion}
            </div>
            {!info.apiActiva && <p className="text-[11px] text-amber-700">{info.motivo} Se puede cargar todo igual; se manda cuando esté prendida.</p>}
            {info.errorEstructura && <p className="text-[11px] text-rose-700">No se pudo leer la planilla del molde: {info.errorEstructura}</p>}
            {am && (am.avisos || []).length > 0 && <p className="text-[11px] text-amber-700">{am.avisos.join(' ')}</p>}

            {/* [A MEDIDA] sin lista de jugadores: una fila por diseño con su cantidad, armada sola al guardar */}
            {am && (
                <div className="space-y-2">
                    <div className="text-slate-600">
                        <b>{disenos.reduce((t, d) => t + (Number(d.cantidad) > 0 ? Number(d.cantidad) : 0), 0)}</b> unidad(es) en {disenos.length} diseño{disenos.length === 1 ? '' : 's'}
                        {p.Cantidad ? <> · el producto pide {p.Cantidad}</> : null}
                        <span className="text-slate-400"> — la lista para TIZADA se arma sola: una fila por diseño con su cantidad (sin talles).</span>
                    </div>
                    {!cliente && <PlantillaAMedida id={id} p={p} am={am} puede={puede || (enDiseno && puedeGenerar)} sucio={sucio} onPedida={cargar} />}
                    {!cliente && extra}
                </div>
            )}

            {/* ── Lista de talles ── */}
            {!am && <div>
                <div className="flex flex-wrap items-end justify-between gap-2 mb-1">
                    {!tienda && <div>
                        <div className="text-[13px] font-black text-slate-800">Lista de talles</div>
                        <div className="text-[11px] text-slate-500">Una fila por prenda. La variante (jugador, golero…) indica qué diseño la imprime.</div>
                    </div>}
                    {(puede || tienda) && <div className="flex flex-wrap items-center gap-2">
                        {puede && <label className={`${BTN_SECUNDARIO} cursor-pointer`} title="Elegí el Excel del cliente (.xlsx, .xls, .csv): se lee la primera hoja; si la primera fila tiene los títulos, cada columna se ubica sola">
                            <FileSpreadsheet size={12} /> Buscar archivo Excel
                            <input type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={leerArchivo} />
                        </label>}
                        {/* Portal y vendedor: la planilla adjunta y cuántas prendas suma la lista, al lado del botón (no abajo de la tabla) */}
                        {tienda && extra}
                        {/* 15/10: sin "Pegar desde Excel" (tampoco en Diseño): se busca el archivo o se agregan filas */}
                        {puede && <button type="button" onClick={agregarFila} disabled={!columnas.length} className={BTN_SECUNDARIO}><Plus size={12} /> Agregar fila</button>}
                        {tienda && <span className="text-[11px] text-slate-600" title="Cada fila es un jugador; las prendas suman la columna Cantidad (vacía = 1)"><b>{filas.length}</b> jugador{filas.length === 1 ? '' : 'es'} · <b>{cantidadTotal}</b> prenda{cantidadTotal === 1 ? '' : 's'}
                            {/* Vendedor: si no da lo que pide el producto, se avisa acá mismo */}
                            {!cliente && p.Cantidad ? <> · el producto pide {p.Cantidad}{cantidadTotal !== Number(p.Cantidad) && filas.length ? <span className="text-amber-700 font-bold"> · no coincide</span> : null}</> : null}
                            {ocupado === 'guardar' && <span className="ml-1.5 text-slate-400 inline-flex items-center gap-1"><Loader2 size={11} className="animate-spin" /> guardando…</span>}</span>}
                    </div>}
                </div>
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full min-w-[640px]">
                        <thead><tr className="bg-slate-50 text-[9px] font-black uppercase tracking-wide text-slate-500 text-left">
                            <th className="px-2 py-2 w-8">#</th>
                            {colsTabla.map(c => <th key={c.id} className="px-2 py-2">{c.label}{c.obligatoria ? ' *' : ''}</th>)}
                            <th className="px-2 py-2">Variante</th>{!tienda && <th className="px-2 py-2">Se imprime en</th>}<th className="px-2 py-2 w-12" />
                        </tr></thead>
                        <tbody>
                            {filas.map((f, i) => {
                                const prob = problemaFila(f, columnas, disenos);
                                const dis = disenos.find(d => sinTilde(d.nombre) === sinTilde(f.diseno)) || (disenos.length === 1 ? disenos[0] : null);
                                return (
                                    <tr key={i} className="border-t border-slate-200">
                                        {/* Portal: sin la columna "Se imprime en"; lo que falta se valida al confirmar el pedido.
                                            Vendedor: tampoco, pero lo que le falta a la fila se marca en su número */}
                                        <td className="px-2 py-1 text-slate-400">{tienda && !cliente && prob
                                            ? <span className="inline-flex items-center gap-0.5 font-bold text-rose-600" title={prob}><AlertTriangle size={11} />{i + 1}</span>
                                            : i + 1}</td>
                                        {colsTabla.map(c => (
                                            <td key={c.id} className="px-2 py-1">
                                                {(c.tipo === 'talle' || c.tipo === 'lista') && c.opciones.length
                                                    ? <Selector value={f[c.id] || ''} disabled={!puede} onChange={e => cambiarFila(i, c.id, e.target.value)} claseBoton={claseSel(SEL_CAMPO)} anchoLista={200}><option value="">—</option>{c.opciones.map(o => <option key={o} value={o}>{o}</option>)}{f[c.id] && !c.opciones.includes(f[c.id]) && <option value={f[c.id]}>{f[c.id]}</option>}</Selector>
                                                    : <input value={f[c.id] || ''} disabled={!puede} type={c.tipo === 'numero' ? 'number' : 'text'} min={c.tipo === 'numero' ? 1 : undefined} placeholder={tienda && c.rol === 'cantidad' ? '1' : undefined} onChange={e => cambiarFila(i, c.id, c.rol === 'nombre' ? e.target.value.toUpperCase() : e.target.value)} className={INPUT} />}
                                            </td>
                                        ))}
                                        <td className="px-2 py-1"><Selector value={(f.diseno || '').toUpperCase()} disabled={!puede} onChange={e => cambiarFila(i, 'diseno', e.target.value)} claseBoton={claseSel(SEL_CAMPO)} anchoLista={220}>
                                            {/* Portal: solo las referencias de los artes cargados (+ la de la fila si vino de otro lado, para no perderla) */}
                                            <option value="">—</option>{(cliente
                                                ? [...new Set([...disenos.map(d => d.nombre), ...(f.diseno ? [String(f.diseno).toUpperCase()] : [])])]
                                                : [...new Set([...variantesDeLista(filas), ...disenos.map(d => d.nombre), ...DUENOS])]).map(n => <option key={n} value={n}>{n}</option>)}
                                        </Selector></td>
                                        {!tienda && <td className="px-2 py-1">{prob ? <span className="font-bold text-rose-600">{prob}</span> : <span className="text-emerald-700">{dis ? `${dis.nombre} · ${nombreModelo(dis.variable)}` : 'OK'}</span>}</td>}
                                        <td className="px-2 py-1 text-right">{puede && <button type="button" onClick={() => { setFilas(fs => fs.filter((_, k) => k !== i)); setSucio(true); }} className="text-[11px] font-bold text-slate-400 hover:text-rose-600">Quitar</button>}</td>
                                    </tr>
                                );
                            })}
                            {!filas.length && <tr><td colSpan={colsTabla.length + (tienda ? 3 : 4)} className="px-3 py-3 text-slate-500">Todavía no hay prendas en la lista.</td></tr>}
                        </tbody>
                    </table>
                </div>
                {!tienda && <div className="mt-1 text-slate-600"><b>{cantidadTotal}</b> prenda{cantidadTotal === 1 ? '' : 's'} en la lista{p.Cantidad ? ` · el producto pide ${p.Cantidad}` : ''}{p.Cantidad && cantidadTotal !== Number(p.Cantidad) && filas.length ? <span className="text-amber-700 font-bold"> · no coincide</span> : null}</div>}
                {!tienda && extra}
            </div>}

            {dialogo}
            {/* ── Guardar y mandar ── */}
            {/* Portal: lo que falta se valida al final, en "Confirmar pedido" */}
            {errores.length > 0 && !sucio && !cliente && (
                <div className="border border-rose-200 bg-rose-50 rounded-lg p-2 text-[11px] text-rose-800">
                    <div className="font-black mb-0.5">Para mandar a TIZADA falta:</div>
                    <ul className="list-disc pl-4 space-y-0.5">{errores.slice(0, 15).map((e, k) => <li key={k}>{e.mensaje}</li>)}</ul>
                    {errores.length > 15 && <div>… y {errores.length - 15} más.</div>}
                </div>
            )}
            {/* Solo en la pantalla de Diseño: Guardar, Revisar en TIZADA y cómo se manda. Portal y vendedor (como la Tienda,
                14/10) sin esta fila: se guarda solo, y lo que falta lo dicen el recuadro de arriba y "Estado para producción" */}
            {enDiseno && (puede || puedeGenerar) && (
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => guardar()} disabled={!sucio || !!ocupado} className={BTN_SECUNDARIO}>{ocupado === 'guardar' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} {am ? 'Guardar medidas' : 'Guardar diseños y lista'}</button>
                    <button type="button" onClick={() => enviar(true)} disabled={!puedeMandar || !!ocupado} className={BTN_SECUNDARIO} title="Pregunta a TIZADA si lo aceptaría, sin generar nada">{ocupado === 'revisar' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Revisar en TIZADA</button>
                    {/* [15/10] Mandar / rehacer la tizada, acá con los otros (antes, en la tarjeta de la producción principal) */}
                    {mandar && (
                        <button type="button" disabled={!puedeMandar || !!ocupado} className={mandar === 'enviar' ? BTN_PRIMARIO : BTN_SECUNDARIO}
                            title={mandar === 'enviar' ? 'Revisa arte y datos, y lo manda a TIZADA PRO; la tizada vuelve sola como diseño pronto' : 'Vuelve a mandar diseños, arte y lista a TIZADA PRO; cuando vuelve, la tizada nueva reemplaza a la actual'}
                            onClick={async () => {
                                if (mandar === 'rehacer' && !(await preguntar({ Icono: RefreshCw, titulo: 'Rehacer la tizada', texto: 'Se manda de nuevo a TIZADA PRO con los diseños, el arte y la lista de talles que estén guardados ahora.', nota: 'Cuando vuelva, la tizada nueva reemplaza a los archivos de diseño pronto actuales.', boton: 'Mandarla' }))) return;
                                enviar(false);
                            }}>
                            {ocupado === 'enviar' ? <Loader2 size={12} className="animate-spin" /> : mandar === 'enviar' ? <Send size={12} /> : <RefreshCw size={12} />} {mandar === 'enviar' ? 'Enviar a TIZADA PRO' : 'Rehacer la tizada en TIZADA PRO'}
                        </button>
                    )}
                    {(motivoNoMandar || (!puedeGenerar && motivoNoGenerar)) && <span className="text-[11px] text-slate-500">{motivoNoMandar || motivoNoGenerar}</span>}
                    <span className="ml-auto">{conexion}</span>
                </div>
            )}

            {/* ── Envíos ── */}
            {(info.envios || []).length > 0 && (
                <div className="space-y-1.5">
                    <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">Pedidos a TIZADA PRO ({info.envios.length})</div>
                    {/* Arriba el último; los anteriores se ven con "Ver los anteriores". Cada uno abre y cierra su detalle. */}
                    {(verAnteriores ? info.envios : info.envios.slice(0, 1)).map(e => {
                        const est = ESTADO_ENVIO[e.Estado] || { txt: e.Estado, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
                        const frenan = (e.Alarmas || []).filter(a => a.frena).length;
                        const avisos = (e.Alarmas || []).length - frenan;
                        const hayDetalle = !!e.ErrorTexto || (e.Alarmas || []).length > 0 || (e.Archivos || []).length > 0;
                        const abierto = abiertos.has(e.EnvioID);
                        return (
                            <div key={e.EnvioID} className="border border-slate-200 rounded-lg p-2 space-y-1">
                                <div className={`flex flex-wrap items-center gap-2 ${hayDetalle ? 'cursor-pointer select-none' : ''}`} onClick={() => hayDetalle && alternar(e.EnvioID)}
                                    role={hayDetalle ? 'button' : undefined} tabIndex={hayDetalle ? 0 : undefined} aria-expanded={hayDetalle ? abierto : undefined}
                                    onKeyDown={(ev) => { if (hayDetalle && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); alternar(e.EnvioID); } }}
                                    title={hayDetalle ? (abierto ? 'Cerrar el detalle' : 'Ver el detalle') : undefined}>
                                    {hayDetalle ? (abierto ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />) : <span className="w-[14px]" />}
                                    <b className="font-mono text-slate-800">{e.Referencia}</b>
                                    <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black ${est.cls}`}>{est.txt}</span>
                                    {e.Etapa && <span className="text-slate-500">{e.Etapa}</span>}
                                    {!abierto && frenan > 0 && <span className="text-[10px] font-black text-rose-700">{frenan} frena{frenan === 1 ? '' : 'n'}</span>}
                                    {!abierto && avisos > 0 && <span className="text-[10px] font-bold text-amber-700">{avisos} aviso{avisos === 1 ? '' : 's'}</span>}
                                    {!abierto && (e.Archivos || []).length > 0 && <span className="text-[10px] font-bold text-emerald-700">{e.Archivos.length} archivo{e.Archivos.length === 1 ? '' : 's'}</span>}
                                    <span className="text-slate-400 ml-auto">{fmtFechaHora(e.FechaEnvio)}</span>
                                    {['EN_COLA', 'PROCESANDO', 'LISTO'].includes(e.Estado) && <button type="button" disabled={!!ocupado} onClick={(ev) => { ev.stopPropagation(); actualizar(e, false); }} className={BTN_SECUNDARIO}>{ocupado === `act-${e.EnvioID}` ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Preguntar ahora</button>}
                                    {e.Estado === 'ERROR_APLICAR' && <button type="button" disabled={!!ocupado} onClick={(ev) => { ev.stopPropagation(); actualizar(e, true); }} className={BTN_SECUNDARIO}><RefreshCw size={12} /> Reintentar cargar</button>}
                                </div>
                                {abierto && (
                                    <div className="pl-6 space-y-1">
                                        {e.ErrorTexto && <div className="text-rose-700">{e.ErrorTexto}</div>}
                                        {e.Alarmas?.length > 0 && <ul className="text-[11px] space-y-0.5">{e.Alarmas.map((a, k) => (
                                            <li key={k} className={a.frena ? 'text-rose-700' : 'text-amber-700'}><AlertTriangle size={10} className="inline -mt-0.5" /> {a.mensaje || a.codigo}{a.donde?.campo ? <span className="text-slate-500"> · {a.donde.campo}{a.donde.fila != null ? ` (fila ${a.donde.fila})` : ''}</span> : null}</li>
                                        ))}</ul>}
                                        {e.Archivos?.length > 0 && <div className="flex flex-wrap gap-2">{e.Archivos.map(a => <a key={a.ArchivoID} href={a.url} target="_blank" rel="noreferrer" className="font-bold text-brand-cyan hover:underline">{a.nombre}</a>)}</div>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {info.envios.length > 1 && (
                        <button type="button" onClick={() => setVerAnteriores(v => !v)} className="text-[11px] font-bold text-brand-cyan hover:underline inline-flex items-center gap-1">
                            {verAnteriores ? <><ChevronDown size={12} /> Ocultar los anteriores</> : <><ChevronRight size={12} /> Ver los {info.envios.length - 1} anteriores</>}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
