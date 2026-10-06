import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ClipboardPaste, FileSpreadsheet, Loader2, Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { solicitudesVendedorService as svc } from '../../../services/modules/solicitudesVendedorService';
import { fmtFechaHora } from '../../../utils/fechas';
import { BTN_PRIMARIO, BTN_SECUNDARIO, INPUT, SEL_CAMPO, claseSel, errorDe } from './solicitudesComunes';
import Selector from '../../ui/Selector';

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
const filaVacia = (columnas, diseno) => ({ diseno: diseno || '', ...Object.fromEntries(columnas.map(c => [c.id, ''])) });

// Qué le falta a una fila (lo mismo que revisa el servidor)
function problemaFila(f, columnas, disenos) {
    for (const c of columnas) {
        const v = String(f[c.id] ?? '').trim();
        if (c.obligatoria && !v) return `Falta ${c.label.toLowerCase()}`;
        if (v && (c.tipo === 'talle' || c.tipo === 'lista') && c.opciones.length && !c.opciones.some(o => sinTilde(o) === sinTilde(v)) && !(c.tipo === 'lista' && v.includes('+'))) return `${c.label} "${v}" no existe`;
        if (v && c.tipo === 'numero' && !(Number(v) > 0)) return `${c.label} tiene que ser un número`;
    }
    if (disenos.length > 1 && !disenos.some(d => sinTilde(d.nombre) === sinTilde(f.diseno))) return 'Falta la variante';
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
export default function TizadaProBloque({ id, p, puede, onCargado, numero = null, extra = null, modo = 'carga', puedeGenerar = false, motivoNoGenerar = null }) {
    const enDiseno = modo === 'diseno';
    const [info, setInfo] = useState(null);
    const [molde, setMolde] = useState(null);
    const [disenos, setDisenos] = useState([]);
    const [filas, setFilas] = useState([]);
    const [sucio, setSucio] = useState(false);
    const [ocupado, setOcupado] = useState('');
    const [pegando, setPegando] = useState(false);
    const [pegado, setPegado] = useState('');
    const [abiertos, setAbiertos] = useState(() => new Set());   // envíos con el detalle abierto (arrancan cerrados)
    const [verAnteriores, setVerAnteriores] = useState(false);    // los envíos viejos, ocultos detrás del último
    const alternar = (envioId) => setAbiertos(s => { const n = new Set(s); if (n.has(envioId)) n.delete(envioId); else n.add(envioId); return n; });

    const cargar = useCallback(async () => {
        try {
            const [v, m] = await Promise.all([svc.tizadaProVer(id, p.ProductoSolID), svc.moldeDelProducto(id, p.ProductoSolID).catch(() => null)]);
            setInfo(v); setMolde(m);
            setDisenos(v.datos?.disenos || []);
            setFilas(v.datos?.planilla || []);
            setSucio(!!v.sinGuardar);   // arranque propuesto (JUGADOR + su arte): falta guardarlo
            return v;
        } catch (e) { toast.error(errorDe(e)); return null; }
    }, [id, p.ProductoSolID]);
    useEffect(() => { cargar(); }, [cargar, p]);   // p cambia cuando la pantalla recarga (ej. después de "Enviar a TIZADA PRO")

    const columnas = info?.estructura?.columnas || [];
    const modelos = molde?.modelos || [];
    const nombreModelo = (clave) => modelos.find(m => m.clave === clave)?.nombre || info?.piezas?.variableNombre || clave;
    // El arte que nombra al diseño (GOES_JUGADOR.pdf → JUGADOR)
    const arteDe = (nombre) => (nombre ? (info?.artes || []).find(a => sinTilde(a.nombre).includes(sinTilde(nombre)))?.ArchivoID || null : null);
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

    const cantidadTotal = useMemo(() => filas.reduce((s, f) => {
        const col = columnas.find(c => c.rol === 'cantidad' || (c.tipo === 'numero' && /cant/i.test(c.label)));
        return s + (col && Number(f[col.id]) > 0 ? Number(f[col.id]) : 1);
    }, 0), [filas, columnas]);

    if (!info) return <div className="pt-3 mt-3 border-t border-slate-200 text-xs text-slate-500 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Leyendo el molde en TIZADA PRO…</div>;
    if (!info.aplica) return null;

    const cambiarDiseno = (i, cambios) => {
        setDisenos(ds => ds.map((d, k) => {
            if (k !== i) return d;
            const n = { ...d, ...cambios };
            if ('nombre' in cambios && !d.arteArchivoId) n.arteArchivoId = arteDe(n.nombre);
            return n;
        }));
        setSucio(true);
    };
    const cambiarFila = (i, col, v) => { setFilas(fs => fs.map((f, k) => (k === i ? { ...f, [col]: v } : f))); setSucio(true); };
    const agregarFila = () => { setFilas(fs => [...fs, filaVacia(columnas, disenos.length === 1 ? disenos[0].nombre : '')]); setSucio(true); };
    const agregarDiseno = () => {
        // modelo y telas los pone el servidor desde "Piezas y telas"; acá solo nombre y arte
        const usado = new Set(disenos.map(d => d.arteArchivoId));
        const libre = (info?.artes || []).find(a => !usado.has(a.ArchivoID));
        setDisenos(ds => [...ds, { nombre: ds.length === 1 ? 'GOLERO' : `DISEÑO ${ds.length + 1}`, arteArchivoId: libre ? libre.ArchivoID : null }]);
        setSucio(true);
    };

    const guardar = async () => {
        setOcupado('guardar');
        try {
            const v = await svc.tizadaProGuardar(id, p.ProductoSolID, { disenos: disenos.map(d => ({ ...d, variableNombre: nombreModelo(d.variable) })), planilla: filas });
            setInfo(v); setDisenos(v.datos?.disenos || []); setFilas(v.datos?.planilla || []); setSucio(false);
            toast.success(v.errores?.length ? `Guardado. Para mandar a TIZADA falta: ${v.errores.length} cosa(s).` : 'Diseños y lista de talles guardados.');
        } catch (e) { toast.error(errorDe(e)); } finally { setOcupado(''); }
    };
    const enviar = async (soloRevisar) => {
        setOcupado(soloRevisar ? 'revisar' : 'enviar');
        try {
            const r = await svc.tizadaProEnviar(id, p.ProductoSolID, soloRevisar);
            if (r.Estado === 'RECHAZADO') toast.error(`TIZADA no lo acepta: ${r.mensaje || 'mirá las alarmas abajo'}`);
            else toast.success(soloRevisar ? 'TIZADA PRO lo aceptaría. Todavía no se mandó.' : `Mandado a TIZADA PRO (${r.Referencia}). La tizada vuelve sola cuando termine.`);
            await cargar();
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
    const agregarDesdeTexto = (texto, origen) => {
        const nuevas = leerPegado(texto, columnas).map(f => ({ ...f, diseno: f.diseno || (disenos.length === 1 ? disenos[0].nombre : '') }));
        if (!nuevas.length) return toast.warning(`No se encontró ninguna fila para agregar${origen ? ` en "${origen}"` : ''}.`);
        setFilas(fs => [...fs.filter(f => columnas.some(c => String(f[c.id] || '').trim())), ...nuevas]);
        setSucio(true); setPegando(false); setPegado('');
        toast.success(`${nuevas.length} fila(s) agregadas desde ${origen ? `"${origen}"` : 'Excel'}. Revisalas y tocá "Guardar diseños y lista".`);
        return undefined;
    };
    const aplicarPegado = () => agregarDesdeTexto(pegado, null);
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
            agregarDesdeTexto(texto, file.name);
        } catch (e) { toast.error(`No se pudo leer "${file.name}": ${e.message}`); }
    };

    const errores = info.errores || [];
    const puedeMandar = puede && info.apiActiva && info.tabla && !sucio && !errores.length && !envioActivo;

    const motivoNoMandar = !info.tabla ? 'Falta correr scripts/add_tizadapro_envios.sql en la base.'
        : !info.apiActiva ? info.motivo
            : sucio ? 'Guardá los cambios antes de mandar.'
                : errores.length ? 'Completá lo que falta (abajo).'
                    : envioActivo ? `Ya hay un pedido en curso (${envioActivo.Referencia}).` : null;

    return (
        <div className="pt-3 mt-3 border-t border-slate-200 text-xs space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-[10px] font-black uppercase tracking-wide text-slate-400 flex items-center gap-1"><Wand2 size={12} /> {numero ? `${numero} · ` : ''}{enDiseno ? 'Tizada automática · TIZADA PRO' : 'Diseños y lista de jugadores · TIZADA PRO'}
                    <span className="normal-case font-normal">— molde {molde?.moldeNombre || info.moldeRef}{info.estructura?.plantilla ? ` · ${info.estructura.plantilla}` : ''}</span></div>
                <span className={`px-2 py-0.5 rounded-full border text-[10px] font-black ${info.apiActiva ? 'bg-emerald-100 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}
                    title={info.motivo || ''}>{info.apiActiva ? `Conectado · envío ${info.modoEnvio === 'AL_ENVIAR_A_DISENO' ? 'automático al enviar a Diseño' : 'con el botón'}` : 'Sin conexión con TIZADA'}</span>
            </div>
            {!info.apiActiva && <p className="text-[11px] text-amber-700">{info.motivo} Se puede cargar todo igual; se manda cuando esté prendida.</p>}
            {info.errorEstructura && <p className="text-[11px] text-rose-700">No se pudo leer la planilla del molde: {info.errorEstructura}</p>}

            {/* ── Diseños ── */}
            <div>
                <div className="flex items-center justify-between mb-1">
                    <div className="text-[11px] font-black text-slate-700">Diseños <span className="font-normal text-slate-500">· uno por variante (jugador, golero…): su nombre y su arte (un archivo con todas las piezas, subido en "1 · Arte del cliente")</span></div>
                    {puede && <button type="button" onClick={agregarDiseno} className={BTN_SECUNDARIO}><Plus size={12} /> Agregar diseño</button>}
                </div>
                {info.piezas
                    ? <div className="text-[11px] text-slate-600 mb-1.5">Modelo y telas (de <b>2 · Piezas y telas</b>, para todos los diseños): <b>{info.piezas.variableNombre || nombreModelo(info.piezas.variable)}</b> · {info.piezas.telaNombre || 'sin tela'}{info.piezas.porPieza.length ? <> · {info.piezas.porPieza.map(x => `${x.pieza} → ${x.tela}`).join(' · ')}</> : null}{!info.piezas.completo && <span className="text-amber-700 font-bold"> · faltan telas en el paso 2</span>}</div>
                    : <div className="text-[11px] text-amber-700 font-bold mb-1.5">Primero elegí el modelo y la tela de cada pieza en "2 · Piezas y telas" y tocá "Guardar piezas y telas": valen para todos los diseños.</div>}
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full min-w-[480px]">
                        <thead><tr className="bg-slate-50 text-[9px] font-black uppercase tracking-wide text-slate-500 text-left">
                            <th className="px-2 py-2 w-[30%]">Nombre</th><th className="px-2 py-2">Arte para TIZADA (.ai / .pdf)</th><th className="px-2 py-2 w-10" />
                        </tr></thead>
                        <tbody>
                            {disenos.map((d, i) => (
                                <tr key={i} className="border-t border-slate-200 align-top">
                                    <td className="px-2 py-1.5"><input value={d.nombre} disabled={!puede} onChange={e => cambiarDiseno(i, { nombre: e.target.value.toUpperCase() })} className={INPUT} placeholder="JUGADOR" /></td>
                                    <td className="px-2 py-1.5"><Selector value={d.arteArchivoId || ''} disabled={!puede} onChange={e => cambiarDiseno(i, { arteArchivoId: Number(e.target.value) || null })} claseBoton={claseSel(SEL_CAMPO)} anchoLista={280}>
                                        <option value="">— elegir el archivo —</option>{(info.artes || []).map(a => <option key={a.ArchivoID} value={a.ArchivoID}>{a.nombre}</option>)}
                                    </Selector>
                                        {!(info.artes || []).length && <div className="text-[10px] text-amber-700 mt-0.5">Subí el arte (.ai o .pdf armado sobre la base de TIZADA) en "Arte del cliente".</div>}
                                    </td>
                                    <td className="px-2 py-1.5 text-right">{puede && disenos.length > 1 && <button type="button" title="Quitar este diseño" onClick={() => { setDisenos(ds => ds.filter((_, k) => k !== i)); setSucio(true); }} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={14} /></button>}</td>
                                </tr>
                            ))}
                            {!disenos.length && <tr><td colSpan={3} className="px-3 py-3 text-slate-500">Sin diseños. {puede && <button type="button" onClick={agregarDiseno} className="font-bold text-brand-cyan hover:underline">Agregar el primero</button>}</td></tr>}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* ── Lista de talles ── */}
            <div>
                <div className="flex flex-wrap items-end justify-between gap-2 mb-1">
                    <div>
                        <div className="text-[13px] font-black text-slate-800">Lista de talles</div>
                        <div className="text-[11px] text-slate-500">Una fila por prenda. La variante (jugador, golero…) indica qué diseño la imprime.</div>
                    </div>
                    {puede && <div className="flex gap-2">
                        <label className={`${BTN_SECUNDARIO} cursor-pointer`} title="Elegí el Excel del cliente (.xlsx, .xls, .csv): se lee la primera hoja; si la primera fila tiene los títulos, cada columna se ubica sola">
                            <FileSpreadsheet size={12} /> Buscar archivo Excel
                            <input type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={leerArchivo} />
                        </label>
                        <button type="button" onClick={() => setPegando(v => !v)} className={BTN_SECUNDARIO}><ClipboardPaste size={12} /> Pegar desde Excel</button>
                        <button type="button" onClick={agregarFila} disabled={!columnas.length} className={BTN_SECUNDARIO}><Plus size={12} /> Agregar fila</button>
                    </div>}
                </div>
                {pegando && (
                    <div className="border border-slate-200 rounded-xl p-2 mb-2 space-y-1.5">
                        <div className="text-[11px] text-slate-600">Copiá las filas del Excel del cliente y pegalas acá. Si la primera fila tiene los títulos ({columnas.map(c => c.label).join(', ')}, Variante), se ubican solas; si no, en ese orden.</div>
                        <textarea rows={5} value={pegado} onChange={e => setPegado(e.target.value)} className={`${INPUT} font-mono`} placeholder={`${columnas.map(c => c.label).join('\t')}\tVariante`} />
                        <div className="flex gap-2 justify-end"><button type="button" onClick={() => setPegando(false)} className={BTN_SECUNDARIO}>Cancelar</button><button type="button" onClick={aplicarPegado} className={BTN_PRIMARIO}>Agregar a la lista</button></div>
                    </div>
                )}
                <div className="overflow-x-auto border border-slate-200 rounded-xl">
                    <table className="w-full min-w-[640px]">
                        <thead><tr className="bg-slate-50 text-[9px] font-black uppercase tracking-wide text-slate-500 text-left">
                            <th className="px-2 py-2 w-8">#</th>
                            {columnas.map(c => <th key={c.id} className="px-2 py-2">{c.label}{c.obligatoria ? ' *' : ''}</th>)}
                            <th className="px-2 py-2">Variante</th><th className="px-2 py-2">Se imprime en</th><th className="px-2 py-2 w-12" />
                        </tr></thead>
                        <tbody>
                            {filas.map((f, i) => {
                                const prob = problemaFila(f, columnas, disenos);
                                const dis = disenos.find(d => sinTilde(d.nombre) === sinTilde(f.diseno)) || (disenos.length === 1 ? disenos[0] : null);
                                return (
                                    <tr key={i} className="border-t border-slate-200">
                                        <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                                        {columnas.map(c => (
                                            <td key={c.id} className="px-2 py-1">
                                                {(c.tipo === 'talle' || c.tipo === 'lista') && c.opciones.length
                                                    ? <Selector value={f[c.id] || ''} disabled={!puede} onChange={e => cambiarFila(i, c.id, e.target.value)} claseBoton={claseSel(SEL_CAMPO)} anchoLista={200}><option value="">—</option>{c.opciones.map(o => <option key={o} value={o}>{o}</option>)}{f[c.id] && !c.opciones.includes(f[c.id]) && <option value={f[c.id]}>{f[c.id]}</option>}</Selector>
                                                    : <input value={f[c.id] || ''} disabled={!puede} type={c.tipo === 'numero' ? 'number' : 'text'} min={c.tipo === 'numero' ? 1 : undefined} onChange={e => cambiarFila(i, c.id, c.rol === 'nombre' ? e.target.value.toUpperCase() : e.target.value)} className={INPUT} />}
                                            </td>
                                        ))}
                                        <td className="px-2 py-1">{disenos.length > 1
                                            ? <Selector value={f.diseno || ''} disabled={!puede} onChange={e => cambiarFila(i, 'diseno', e.target.value)} claseBoton={claseSel(SEL_CAMPO)} anchoLista={220}><option value="">—</option>{disenos.map(d => <option key={d.nombre} value={d.nombre}>{d.nombre}</option>)}</Selector>
                                            : <span className="text-slate-700">{disenos[0]?.nombre || '—'}</span>}</td>
                                        <td className="px-2 py-1">{prob ? <span className="font-bold text-rose-600">{prob}</span> : <span className="text-emerald-700">{dis ? `${dis.nombre} · ${nombreModelo(dis.variable)}` : 'OK'}</span>}</td>
                                        <td className="px-2 py-1 text-right">{puede && <button type="button" onClick={() => { setFilas(fs => fs.filter((_, k) => k !== i)); setSucio(true); }} className="text-[11px] font-bold text-slate-400 hover:text-rose-600">Quitar</button>}</td>
                                    </tr>
                                );
                            })}
                            {!filas.length && <tr><td colSpan={columnas.length + 4} className="px-3 py-3 text-slate-500">Todavía no hay prendas en la lista.</td></tr>}
                        </tbody>
                    </table>
                </div>
                <div className="mt-1 text-slate-600"><b>{cantidadTotal}</b> prenda{cantidadTotal === 1 ? '' : 's'} en la lista{p.Cantidad ? ` · el producto pide ${p.Cantidad}` : ''}{p.Cantidad && cantidadTotal !== Number(p.Cantidad) && filas.length ? <span className="text-amber-700 font-bold"> · no coincide</span> : null}</div>
                {extra}
            </div>

            {/* ── Guardar y mandar ── */}
            {errores.length > 0 && !sucio && (
                <div className="border border-rose-200 bg-rose-50 rounded-lg p-2 text-[11px] text-rose-800">
                    <div className="font-black mb-0.5">Para mandar a TIZADA falta:</div>
                    <ul className="list-disc pl-4 space-y-0.5">{errores.slice(0, 15).map((e, k) => <li key={k}>{e.mensaje}</li>)}</ul>
                    {errores.length > 15 && <div>… y {errores.length - 15} más.</div>}
                </div>
            )}
            {(puede || (enDiseno && puedeGenerar)) && (
                <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={guardar} disabled={!sucio || !!ocupado} className={BTN_SECUNDARIO}>{ocupado === 'guardar' ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />} Guardar diseños y lista</button>
                    <button type="button" onClick={() => enviar(true)} disabled={!puedeMandar || !!ocupado} className={BTN_SECUNDARIO} title="Pregunta a TIZADA si lo aceptaría, sin generar nada">{ocupado === 'revisar' ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Revisar en TIZADA</button>
                    {(motivoNoMandar || (enDiseno && !puedeGenerar && motivoNoGenerar)) && <span className="text-[11px] text-slate-500">{motivoNoMandar || motivoNoGenerar}</span>}
                    {enDiseno && <span className="text-[11px] text-sky-300 font-bold">Para mandarla: guardá y tocá "Enviar a TIZADA PRO" en la tarjeta de la producción principal (arriba).</span>}
                    {!enDiseno && <span className="text-[11px] text-sky-300 font-bold">La tizada la genera Diseño: tocá "Enviar a Diseño" (abajo) y el diseñador la manda a TIZADA PRO desde su pantalla.</span>}
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
