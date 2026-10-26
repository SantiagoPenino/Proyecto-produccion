import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
    TriangleAlert, Plus, Search, Pencil, Trash2, X, Loader2, SearchX, Star, Factory, RotateCcw, Globe, Save,
    Wrench, Printer, Monitor, HelpCircle,
} from 'lucide-react';
import api from '../../../services/api';
import Selector from '../../ui/Selector';
import useConfirmar from '../../ui/useConfirmar';

// Tipos de falla (/admin/tipos-falla, 23/10/2026). El catálogo TiposFallas, que antes solo se podía agrandar desde la
// configuración del panel de producción. Cada tipo es de un área o «General» (se ofrece en todas) y dice dónde se
// ofrece: al reportar una falla en producción y/o como razón principal de una reposición (Atención al Cliente).
// Desactivar lo saca de las listas sin perder el historial; borrar solo se puede si nunca se usó.
// Ver, cualquier usuario interno; crear, editar y borrar, solo admin (lo controla el backend).
// Pestaña «Servicio Técnico»: las sugerencias del «¿Qué pasa?» al pedir Servicio Técnico (ST_TiposFalla, otra tabla).
// Se suman solas con cada pedido; acá se corrigen, se apagan las que no van o se agregan nuevas.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const CHIP = 'text-[11px] font-bold px-2.5 py-1 rounded-full border';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const BTN_ICONO = 'w-7 h-7 inline-flex items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const CAMPO = 'w-full pl-9 pr-4 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm text-zinc-800 placeholder:text-zinc-400 focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const CAMPO_MODAL = 'w-full px-3.5 py-2.5 bg-white border border-zinc-200 rounded-xl text-sm font-bold text-zinc-800 placeholder:text-zinc-400 placeholder:font-normal focus:outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/15';
const ROTULO = 'block mb-1.5 text-[11px] font-black uppercase tracking-wide text-zinc-400';

// AreaID que significa «se ofrece en todas las áreas». En pantalla se dice «Para todas las áreas»: con el nombre
// «General» parecía una lista (y en las dos pestañas se llamaba igual, como si fuera lo mismo).
const GENERAL = 'General';
const ETIQUETA_GENERAL = 'General';
const VACIO = { titulo: '', descripcion: '', areaId: GENERAL, enProduccion: true, enReposicion: false, frecuente: false, activo: true };
// Tipos de problema de Servicio Técnico (los viejos RED / SOFTWARE / INSTALACIONES ya vienen agrupados del backend)
const GRUPOS_ST = [
    { id: 'MAQUINA', nombre: 'Máquina', Icono: Printer },
    { id: 'PC', nombre: 'PC e internet', Icono: Monitor },
    { id: 'OTRO', nombre: 'Otro', Icono: HelpCircle },
];
const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const errorDe = (e) => e?.response?.data?.error || e?.message || 'Error desconocido';

// Casilla grande con texto (dónde se ofrece / frecuente / activo)
const Opcion = ({ marcado, onChange, Icono, titulo, texto }) => (
    <label className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors
        ${marcado ? 'border-brand-cyan bg-brand-cyan/5 ring-2 ring-brand-cyan/15' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}>
        <input type="checkbox" className="mt-0.5 w-4 h-4 shrink-0 rounded accent-brand-cyan cursor-pointer" checked={marcado} onChange={(e) => onChange(e.target.checked)} />
        <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-bold text-zinc-800">
                {Icono && <Icono size={14} className="shrink-0 text-brand-cyan" />} {titulo}
            </span>
            {texto && <span className="block text-xs text-zinc-500 mt-0.5">{texto}</span>}
        </span>
    </label>
);

export default function TiposFallaPage() {
    const [tipos, setTipos] = useState([]);
    const [sugerencias, setSugerencias] = useState([]);   // Servicio Técnico
    const [areas, setAreas] = useState([]);
    const [cargando, setCargando] = useState(true);
    const [busqueda, setBusqueda] = useState('');
    // Pestaña: 'produccion' (lo que se ofrece al reportar una falla), 'reposicion' (razones de reposición),
    // 'servicio' (sugerencias de Servicio Técnico) o '' (todos los tipos)
    const [filtroUso, setFiltroUso] = useState('produccion');
    const [filtroArea, setFiltroArea] = useState('');   // '' = todas
    const [verInactivos, setVerInactivos] = useState(false);
    const [editando, setEditando] = useState(null);     // null = cerrado; { id?, ...campos }
    const [guardando, setGuardando] = useState(false);
    const [confirmar, ventanaConfirmar] = useConfirmar();

    const cargar = useCallback(async () => {
        setCargando(true);
        try {
            const [{ data }, st] = await Promise.all([
                api.get('/failures/tipos'),
                api.get('/failures/st-tipos').catch(() => ({ data: { sugerencias: [] } })),
            ]);
            setTipos(data.tipos || []);
            setAreas(data.areas || []);
            setSugerencias(st.data?.sugerencias || []);
        } catch (e) {
            toast.error('No se pudieron cargar los tipos de falla: ' + errorDe(e));
        } finally {
            setCargando(false);
        }
    }, []);

    useEffect(() => { cargar(); }, [cargar]);

    const nombreArea = useMemo(() => {
        const m = Object.fromEntries(areas.map(a => [a.codigo, a.nombre]));
        return (codigo) => (codigo === GENERAL ? ETIQUETA_GENERAL : (m[codigo] || codigo));
    }, [areas]);
    // Código que se muestra: el prefijo de las órdenes del área (DTF, SUB, EUV, BOR, VEN…), que es como la gente
    // las conoce; si el área no tiene órdenes, su código interno. Lo que se guarda es siempre el código interno.
    const codigoVisible = useMemo(() => {
        const m = Object.fromEntries(areas.map(a => [a.codigo, a.prefijo || a.codigo]));
        return (codigo) => m[codigo] || codigo;
    }, [areas]);
    const opcionesArea = areas.map(a => (
        <option key={a.codigo} value={a.codigo}
            descripcion={a.sinArea ? 'Código que no es de ningún área: no se ofrece en ninguna lista' : a.prefijo ? `Órdenes ${a.prefijo}` : 'Sin órdenes todavía'}>
            {a.sinArea ? `«${a.codigo}» (no existe)` : a.nombre}
        </option>
    ));
    // Códigos que no son de ningún área (ninguna orden los usa): sus tipos no se ofrecen en ningún lado
    const sinArea = useMemo(() => new Set(areas.filter(a => a.sinArea).map(a => a.codigo)), [areas]);

    // Filtrado y agrupado por área: General primero, después las áreas por nombre
    const grupos = useMemo(() => {
        const q = normalizar(busqueda.trim());
        if (filtroUso === 'servicio') {
            const lista = sugerencias.filter(x => (verInactivos || x.activo) && (!q || normalizar(x.titulo).includes(q)));
            return GRUPOS_ST.map(gr => ({
                areaId: 'st_' + gr.id, nombre: gr.nombre, Icono: gr.Icono, st: true, huerfano: false,
                items: lista.filter(x => x.categoria === gr.id)
                    .map(x => ({ ...x, st: true, descripcion: '', frecuente: false, enProduccion: false, enReposicion: false }))
                    .sort((a, b) => (b.activo - a.activo) || (b.usos - a.usos) || a.titulo.localeCompare(b.titulo, 'es')),
            })).filter(gr => gr.items.length);
        }
        const enRepo = filtroUso === 'reposicion';
        const lista = tipos.filter(t =>
            (verInactivos || t.activo)
            && (enRepo || !filtroArea || t.areaId === filtroArea)
            && (!filtroUso || (filtroUso === 'produccion' ? t.enProduccion : t.enReposicion))
            && (!q || normalizar(t.titulo).includes(q) || normalizar(t.descripcion).includes(q)));
        const ordenar = (items) => items.sort((a, b) => (b.activo - a.activo) || (b.frecuente - a.frecuente) || a.titulo.localeCompare(b.titulo, 'es'));
        // Las razones de reposición valen para cualquier orden: van en una lista sola, sin agrupar por área
        if (enRepo) return lista.length ? [{ areaId: '__reposicion', nombre: 'Razones de reposición', plano: true, huerfano: false, items: ordenar(lista) }] : [];
        const porArea = {};
        for (const t of lista) (porArea[t.areaId] = porArea[t.areaId] || []).push(t);
        return Object.entries(porArea)
            .map(([areaId, items]) => ({
                areaId,
                nombre: nombreArea(areaId),
                huerfano: sinArea.has(areaId),
                items: ordenar(items),
            }))
            // General primero, los códigos sin área al final, el resto por nombre
            .sort((a, b) => (a.areaId === GENERAL ? -1 : b.areaId === GENERAL ? 1
                : (a.huerfano - b.huerfano) || a.nombre.localeCompare(b.nombre, 'es')));
    }, [tipos, sugerencias, busqueda, filtroArea, filtroUso, verInactivos, nombreArea, sinArea]);

    const totales = useMemo(() => ({
        activos: tipos.filter(t => t.activo).length,
        todos: tipos.filter(t => verInactivos || t.activo).length,
        produccionVista: tipos.filter(t => t.enProduccion && (verInactivos || t.activo)).length,
        reposicionVista: tipos.filter(t => t.enReposicion && (verInactivos || t.activo)).length,
        produccion: tipos.filter(t => t.activo && t.enProduccion).length,
        reposicion: tipos.filter(t => t.activo && t.enReposicion).length,
        servicioVista: sugerencias.filter(x => verInactivos || x.activo).length,
        inactivos: filtroUso === 'servicio' ? sugerencias.filter(x => !x.activo).length : tipos.filter(t => !t.activo).length,
    }), [tipos, sugerencias, verInactivos, filtroUso]);
    const mostrados = grupos.reduce((n, g) => n + g.items.length, 0);

    const abrirNuevo = () => setEditando(filtroUso === 'servicio' ? { st: true, titulo: '', categoria: 'MAQUINA', activo: true } : {
        ...VACIO,
        areaId: filtroUso === 'reposicion' ? GENERAL : (filtroArea || GENERAL),
        enProduccion: filtroUso !== 'reposicion',
        enReposicion: filtroUso === 'reposicion',
    });
    const abrirEditar = (t) => setEditando({ ...t });

    const guardar = async () => {
        const d = editando;
        if (d.st) {
            if (!d.titulo.trim()) { toast.error('Falta el texto de la sugerencia.'); return; }
            setGuardando(true);
            try {
                const cuerpo = { titulo: d.titulo.trim(), categoria: d.categoria, activo: d.activo };
                if (d.id) await api.put(`/failures/st-tipos/${d.id}`, cuerpo);
                else await api.post('/failures/st-tipos', cuerpo);
                toast.success(d.id ? 'Sugerencia guardada' : 'Sugerencia creada');
                setEditando(null);
                await cargar();
            } catch (e) {
                toast.error(errorDe(e));
            } finally {
                setGuardando(false);
            }
            return;
        }
        if (!d.titulo.trim()) { toast.error('Falta el nombre del tipo de falla.'); return; }
        if (!d.enProduccion && !d.enReposicion) { toast.error('Marcá dónde se ofrece: en producción, en reposiciones o en los dos.'); return; }
        setGuardando(true);
        try {
            const cuerpo = {
                titulo: d.titulo.trim(), descripcion: d.descripcion.trim(),
                // Solo de reposición = sin área (vale para cualquier orden); el área es de las fallas de producción
                areaId: d.enProduccion ? d.areaId : GENERAL,
                enProduccion: d.enProduccion, enReposicion: d.enReposicion, frecuente: d.frecuente, activo: d.activo,
            };
            if (d.id) await api.put(`/failures/tipos/${d.id}`, cuerpo);
            else await api.post('/failures/tipos', cuerpo);
            toast.success(d.id ? 'Tipo de falla guardado' : 'Tipo de falla creado');
            setEditando(null);
            await cargar();
        } catch (e) {
            toast.error(errorDe(e));
        } finally {
            setGuardando(false);
        }
    };

    // Activar / desactivar desde la lista (manda el tipo entero con el cambio)
    const alternarActivo = async (t) => {
        try {
            if (t.st) {
                await api.put(`/failures/st-tipos/${t.id}`, { titulo: t.titulo, categoria: t.categoria, activo: !t.activo });
                setSugerencias(lista => lista.map(x => (x.id === t.id ? { ...x, activo: !t.activo } : x)));
                toast.success(t.activo ? `«${t.titulo}» ya no se sugiere` : `«${t.titulo}» se vuelve a sugerir`);
                return;
            }
            await api.put(`/failures/tipos/${t.id}`, { ...t, activo: !t.activo });
            setTipos(lista => lista.map(x => (x.id === t.id ? { ...x, activo: !t.activo } : x)));
            toast.success(t.activo ? `«${t.titulo}» desactivado` : `«${t.titulo}» activado`);
        } catch (e) {
            toast.error(errorDe(e));
        }
    };

    const borrar = async (t) => {
        if (t.st) {
            if (!(await confirmar({
                titulo: `¿Borrar «${t.titulo}»?`,
                texto: 'Las solicitudes que ya lo usaron no cambian. Si alguien vuelve a escribir ese texto, aparece de nuevo: para que no se sugiera más, desactivalo.',
                confirmar: 'Borrar',
                peligro: true,
            }))) return;
            try {
                await api.delete(`/failures/st-tipos/${t.id}`);
                setSugerencias(lista => lista.filter(x => x.id !== t.id));
                toast.success('Sugerencia borrada');
            } catch (e) {
                toast.error(errorDe(e));
            }
            return;
        }
        if (!(await confirmar({
            titulo: `¿Borrar «${t.titulo}»?`,
            texto: 'No tiene fallas registradas, así que se borra sin perder historial.',
            confirmar: 'Borrar',
            peligro: true,
        }))) return;
        try {
            await api.delete(`/failures/tipos/${t.id}`);
            setTipos(lista => lista.filter(x => x.id !== t.id));
            toast.success('Tipo de falla borrado');
        } catch (e) {
            toast.error(errorDe(e));
        }
    };

    return (
        <div className="p-3 md:p-6 text-zinc-800">
            {/* Encabezado */}
            <div className="flex items-center justify-between gap-3 flex-wrap mb-4 md:mb-6">
                <div className="flex items-center gap-3 min-w-0">
                    <TriangleAlert size={30} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                    <div className="min-w-0">
                        <h1 className="text-2xl font-black text-zinc-800 uppercase tracking-tight leading-tight">Tipos de falla</h1>
                        <p className="text-sm text-zinc-400">Fallas de producción, razones de reposición y sugerencias de Servicio Técnico</p>
                    </div>
                </div>
                <button type="button" onClick={abrirNuevo} className={BTN_PRINCIPAL}>
                    <Plus size={16} /> {filtroUso === 'reposicion' ? 'Nueva razón' : filtroUso === 'servicio' ? 'Nueva sugerencia' : 'Nuevo tipo'}
                </button>
            </div>

            {/* Pestañas: fallas de producción / razones de reposición / todos (antes era un filtro escondido) */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-3">
                <div role="tablist" aria-label="Dónde se ofrece" className="grid grid-cols-2 sm:inline-flex p-1 rounded-xl bg-white border border-zinc-200">
                    {[
                        { id: 'produccion', Icono: Factory, texto: 'Fallas de producción', corto: 'Producción', n: totales.produccionVista },
                        { id: 'reposicion', Icono: RotateCcw, texto: 'Razones de reposición', corto: 'Reposición', n: totales.reposicionVista },
                        { id: 'servicio', Icono: Wrench, texto: 'Servicio Técnico', corto: 'Serv. Técnico', n: totales.servicioVista },
                        { id: '', Icono: null, texto: 'Todos', corto: 'Todos', n: totales.todos },
                    ].map(pes => (
                        <button
                            key={pes.id || 'todos'}
                            type="button"
                            role="tab"
                            aria-selected={filtroUso === pes.id}
                            onClick={() => setFiltroUso(pes.id)}
                            className={`inline-flex items-center justify-center gap-1.5 px-2 sm:px-3.5 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors
                                ${filtroUso === pes.id ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
                        >
                            {pes.Icono && <pes.Icono size={14} className={`shrink-0 ${filtroUso === pes.id ? '' : 'text-brand-cyan'}`} />}
                            <span className="sm:hidden">{pes.corto}</span>
                            <span className="hidden sm:inline">{pes.texto}</span>
                            <span className={`tabular-nums text-xs ${filtroUso === pes.id ? 'text-white/70' : 'text-zinc-400'}`}>{pes.n}</span>
                        </button>
                    ))}
                </div>
                <p className="text-xs text-zinc-400">
                    {filtroUso === 'servicio'
                        ? 'Las sugerencias del «¿Qué pasa?» al pedir Servicio Técnico. Se suman solas con cada pedido: acá podés corregirlas, apagar las que no van o agregar nuevas.'
                        : filtroUso === 'reposicion'
                        ? 'Se eligen en Atención al Cliente › Reposiciones, una por reposición. Valen para cualquier orden, sea del área que sea.'
                        : filtroUso === 'produccion'
                            ? 'Se ofrecen al reportar una falla en Control y en la planilla del área. Las generales salen en cualquier área.'
                            : 'Todos los tipos, de producción y de reposición.'}
                </p>
            </div>

            {/* Filtros */}
            <div className={`${CARD} p-3 md:p-4 mb-3 md:mb-4 flex flex-col lg:flex-row lg:items-center gap-2.5`}>
                <div className="relative flex-1 min-w-0">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                    <input className={CAMPO} placeholder="Buscar por nombre o descripción…" aria-label="Buscar tipo de falla"
                        value={busqueda} onChange={e => setBusqueda(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
                    {filtroUso !== 'reposicion' && filtroUso !== 'servicio' && (
                        <Selector filtro value={filtroArea} onChange={e => setFiltroArea(e.target.value)} aria-label="Área" className="w-full sm:w-auto" anchoLista={300} altoMax={520}>
                            <option value="">Cualquier área</option>
                            <option value={GENERAL} descripcion="Para todas las áreas">General</option>
                            {opcionesArea}
                        </Selector>
                    )}
                    <label className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-bold cursor-pointer whitespace-nowrap transition-colors
                        ${verInactivos ? 'border-brand-cyan/40 bg-brand-cyan/5 text-brand-cyan' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'}`}>
                        <input type="checkbox" className="w-4 h-4 rounded accent-brand-cyan" checked={verInactivos} onChange={e => setVerInactivos(e.target.checked)} />
                        Ver inactivos{totales.inactivos > 0 && ` (${totales.inactivos})`}
                    </label>
                </div>
            </div>

            {/* Resumen */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3 text-xs">
                {filtroUso === 'servicio' ? (
                    <span className="text-zinc-400">Ordenadas por cuántas veces se usaron: las de arriba son las que se sugieren primero.</span>
                ) : (
                    <>
                        <span className={`${CHIP} bg-white text-zinc-600 border-zinc-200 inline-flex items-center gap-1`}><Factory size={12} className="text-zinc-400" /> producción</span>
                        <span className={`${CHIP} bg-white text-zinc-600 border-zinc-200 inline-flex items-center gap-1`}><RotateCcw size={12} className="text-brand-cyan" /> reposición</span>
                        <span className={`${CHIP} bg-white text-zinc-600 border-zinc-200 inline-flex items-center gap-1`} title="Los frecuentes salen primero en la lista al reportar una falla">
                            <Star size={12} className="text-amber-500 fill-amber-400" /> frecuente: sale primero
                        </span>
                    </>
                )}
                {!cargando && mostrados !== (filtroUso === 'servicio' ? sugerencias.length : tipos.length) && <span className="text-zinc-400 ml-1">· mostrando {mostrados}</span>}
            </div>

            {/* Lista por área */}
            {cargando ? (
                <div className={`${CARD} py-16 flex flex-col items-center gap-3`}>
                    <Loader2 size={30} className="animate-spin text-brand-cyan" />
                    <span className="text-sm text-zinc-400">Cargando tipos de falla...</span>
                </div>
            ) : grupos.length === 0 ? (
                <div className={`${CARD} py-16 px-4 flex flex-col items-center gap-2 text-center`}>
                    <SearchX size={40} className="text-zinc-200" />
                    <p className="text-sm text-zinc-400">No hay tipos de falla con esos filtros.</p>
                </div>
            ) : (
                // Columnas que se acomodan solas: con una grilla, un grupo corto al lado de uno largo dejaba un hueco
                <div className={`columns-1 ${filtroUso === 'reposicion' ? '' : 'xl:columns-2'} gap-3 md:gap-4`}>
                    {grupos.map(g => (
                        <section key={g.areaId} className={`${CARD} overflow-hidden break-inside-avoid mb-3 md:mb-4 ${g.huerfano ? '!border-amber-200' : ''}`}>
                            <header className="px-4 py-2.5 border-b border-zinc-100 bg-zinc-50/60 flex items-center justify-between gap-2">
                                <h2 className="flex items-center gap-2 min-w-0 text-sm font-black text-zinc-800">
                                    {g.areaId === GENERAL && <Globe size={15} className="shrink-0 text-brand-cyan" />}
                                    {g.plano && <RotateCcw size={15} className="shrink-0 text-brand-cyan" />}
                                    {g.Icono && <g.Icono size={15} className="shrink-0 text-brand-cyan" />}
                                    <span className="truncate">{g.huerfano ? `Área «${g.areaId}»` : g.nombre}</span>
                                    {g.plano || g.st
                                        ? null
                                        : g.areaId === GENERAL
                                        ? <span className="text-xs font-medium text-zinc-400 whitespace-nowrap">· se ofrecen en todas las áreas</span>
                                        : g.huerfano
                                            ? <span className={`${CHIP} bg-amber-50 text-amber-700 border-amber-200 whitespace-nowrap`}>No existe</span>
                                            : <span className={`${CHIP} bg-zinc-100 text-zinc-500 border-zinc-200 font-mono`} title={`Código interno: ${g.areaId}`}>{codigoVisible(g.areaId)}</span>}
                                </h2>
                                <span className="flex items-center gap-3 shrink-0 text-[10px] font-black uppercase tracking-wide text-zinc-400">
                                    <span className="tabular-nums normal-case font-bold text-xs">{g.items.length} {filtroUso === 'reposicion' ? (g.items.length === 1 ? 'razón' : 'razones') : g.st ? (g.items.length === 1 ? 'sugerencia' : 'sugerencias') : (g.items.length === 1 ? 'tipo' : 'tipos')}</span>
                                    <span className="hidden sm:inline w-12 text-right">{g.plano || g.st ? 'Usos' : 'Fallas'}</span>
                                    <span className="hidden sm:inline w-[100px]" aria-hidden="true" />
                                </span>
                            </header>
                            {g.huerfano && (
                                <p className="px-4 py-2 bg-amber-50 border-b border-amber-100 text-xs text-amber-800">
                                    Estos tipos están cargados con el código de área «{g.areaId}», que no es de ningún área: por eso no aparecen al reportar una falla en ningún lado. Editalos para pasarlos a su área o a General, o desactivalos.
                                </p>
                            )}
                            {/* Una fila por tipo (antes cada uno era una tarjeta de ~100 px con chips abajo) */}
                            <ul className="divide-y divide-zinc-100">
                                {g.items.map(t => (
                                    <li key={t.id} className={`px-4 py-2 flex items-center gap-3 hover:bg-zinc-50 transition-colors ${t.activo ? '' : 'bg-zinc-50/70'}`}>
                                        <div className="flex-1 min-w-0">
                                            <p className="flex items-center gap-1.5 min-w-0 text-sm">
                                                {t.frecuente && <Star size={12} className="shrink-0 text-amber-500 fill-amber-400" aria-label="Frecuente" />}
                                                <span className={`font-bold break-words sm:truncate ${t.activo ? 'text-zinc-800' : 'text-zinc-400 line-through'}`} title={t.titulo}>{t.titulo}</span>
                                                {g.plano && t.areaId !== GENERAL && (
                                                    <span className={`${CHIP} shrink-0 !py-0.5 bg-zinc-100 text-zinc-500 border-zinc-200 font-mono`} title="También es falla de producción de esta área: como razón, solo se ofrece en sus órdenes">
                                                        solo {codigoVisible(t.areaId)}
                                                    </span>
                                                )}
                                            </p>
                                            {t.descripcion && <p className="text-xs text-zinc-400 line-clamp-2 sm:line-clamp-none sm:truncate" title={t.descripcion}>{t.descripcion}</p>}
                                        </div>
                                        {/* Dónde se ofrece: íconos (la leyenda está en el resumen de arriba) */}
                                        <span className="flex items-center gap-1.5 shrink-0 sm:w-9 justify-end">
                                            {t.enProduccion && <Factory size={14} className="text-zinc-400" aria-label="Producción" title="Se ofrece al reportar una falla en producción" />}
                                            {t.enReposicion && <RotateCcw size={14} className="text-brand-cyan" aria-label="Reposición" title="Se ofrece como razón de reposición" />}
                                        </span>
                                        <span className="w-7 sm:w-12 shrink-0 text-right text-xs font-bold tabular-nums text-zinc-500" title={t.usos ? (t.st ? `${t.usos} pedidos con este texto` : `${t.usos} fallas registradas`) : 'Sin usar'}>
                                            {t.usos ? t.usos.toLocaleString('es-UY') : <span className="font-normal text-zinc-300">—</span>}
                                        </span>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {/* Activo: interruptor */}
                                            <button
                                                type="button"
                                                role="switch"
                                                aria-checked={t.activo}
                                                onClick={() => alternarActivo(t)}
                                                title={t.activo ? 'Activo: se ofrece en las listas. Tocá para desactivarlo.' : 'Inactivo: no se ofrece. Tocá para activarlo.'}
                                                className={`relative w-8 h-[18px] mr-1 rounded-full transition-colors ${t.activo ? 'bg-brand-cyan' : 'bg-zinc-300'}`}
                                            >
                                                <span className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${t.activo ? 'translate-x-3.5' : ''}`} />
                                            </button>
                                            <button type="button" onClick={() => abrirEditar(t)} className={`${BTN_ICONO} hover:text-brand-cyan hover:border-brand-cyan/40`} title="Editar" aria-label={`Editar ${t.titulo}`}>
                                                <Pencil size={13} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => borrar(t)}
                                                disabled={!t.st && t.usos > 0}
                                                className={`${BTN_ICONO} hover:text-rose-600 hover:border-rose-200 hover:bg-rose-50`}
                                                title={!t.st && t.usos > 0 ? 'Tiene fallas registradas: no se puede borrar. Desactivalo.' : 'Borrar'}
                                                aria-label={`Borrar ${t.titulo}`}
                                            >
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
            )}

            {/* Alta / edición */}
            {editando && createPortal(
                <div className="fixed inset-0 z-[6000] bg-black/40 flex items-center justify-center p-3 md:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !guardando) setEditando(null); }}>
                    <div role="dialog" aria-modal="true" className="bg-white rounded-2xl border border-zinc-200 shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-5 py-4 border-b border-zinc-200 flex items-center justify-between gap-3">
                            <h2 className="text-lg font-black text-zinc-800">
                                {editando.st ? (editando.id ? 'Editar sugerencia' : 'Nueva sugerencia') : (editando.enReposicion && !editando.enProduccion)
                                    ? (editando.id ? 'Editar razón de reposición' : 'Nueva razón de reposición')
                                    : (editando.id ? 'Editar tipo de falla' : 'Nuevo tipo de falla')}
                            </h2>
                            <button type="button" onClick={() => setEditando(null)} disabled={guardando} className="w-9 h-9 rounded-xl border border-zinc-200 bg-white text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 flex items-center justify-center transition-colors" aria-label="Cerrar">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {editando.st ? (
                                <>
                                    <div>
                                        <label className={ROTULO} htmlFor="tf-st-titulo">Texto</label>
                                        <input id="tf-st-titulo" className={CAMPO_MODAL} maxLength={200} autoFocus placeholder="Ej: No enciende"
                                            value={editando.titulo} onChange={e => setEditando(d => ({ ...d, titulo: e.target.value }))}
                                            onKeyDown={e => { if (e.key === 'Enter') guardar(); }} />
                                        <p className="text-xs text-zinc-400 mt-1.5">Se sugiere al escribir «¿Qué pasa?» en el pedido a Servicio Técnico.</p>
                                    </div>
                                    <div>
                                        <span className={ROTULO}>Tipo de problema</span>
                                        <div className="grid grid-cols-3 gap-2">
                                            {GRUPOS_ST.map(gr => (
                                                <button key={gr.id} type="button" onClick={() => setEditando(d => ({ ...d, categoria: gr.id }))}
                                                    className={`inline-flex items-center justify-center gap-1.5 px-2 py-2.5 rounded-xl border text-sm font-bold transition-colors
                                                        ${editando.categoria === gr.id ? 'border-brand-cyan bg-brand-cyan/5 text-brand-cyan ring-2 ring-brand-cyan/15' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'}`}>
                                                    <gr.Icono size={15} className="shrink-0" /> {gr.nombre}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <Opcion marcado={editando.activo} onChange={v => setEditando(d => ({ ...d, activo: v }))}
                                        titulo="Activa" texto="Si no, no se sugiere (las solicitudes que la usaron no cambian)" />
                                </>
                            ) : (<>
                            <div>
                                <label className={ROTULO} htmlFor="tf-titulo">Nombre</label>
                                <input id="tf-titulo" className={CAMPO_MODAL} maxLength={100} autoFocus placeholder={(editando.enReposicion && !editando.enProduccion) ? 'Ej: Daño en envío o entrega' : 'Ej: Impresión bandeada'}
                                    value={editando.titulo} onChange={e => setEditando(d => ({ ...d, titulo: e.target.value }))}
                                    onKeyDown={e => { if (e.key === 'Enter') guardar(); }} />
                            </div>
                            <div>
                                <label className={ROTULO} htmlFor="tf-desc">Descripción <span className="normal-case font-medium tracking-normal">(opcional)</span></label>
                                <textarea id="tf-desc" className={`${CAMPO_MODAL} font-medium resize-none h-20`} maxLength={255} placeholder="Qué es, para que se elija bien"
                                    value={editando.descripcion} onChange={e => setEditando(d => ({ ...d, descripcion: e.target.value }))} />
                            </div>
                            <div>
                                <span className={ROTULO}>Dónde se ofrece</span>
                                <div className="grid gap-2">
                                    <Opcion marcado={editando.enProduccion} onChange={v => setEditando(d => ({ ...d, enProduccion: v }))}
                                        Icono={Factory} titulo="Al reportar una falla en producción" texto="Control de calidad y planilla del área" />
                                    <Opcion marcado={editando.enReposicion} onChange={v => setEditando(d => ({ ...d, enReposicion: v }))}
                                        Icono={RotateCcw} titulo="Como razón de una reposición" texto="Atención al Cliente › Reposiciones" />
                                </div>
                            </div>
                            {/* El área es de las fallas de producción; una razón de reposición sola vale para cualquier orden */}
                            {editando.enProduccion ? (
                                <div>
                                    <label className={ROTULO}>Área</label>
                                    <Selector value={editando.areaId} onChange={e => setEditando(d => ({ ...d, areaId: e.target.value }))} aria-label="Área del tipo de falla" className="w-full" altoMax={420}>
                                        <option value={GENERAL} descripcion="Para todas las áreas">General</option>
                                        {opcionesArea}
                                    </Selector>
                                </div>
                            ) : (
                                <p className="text-xs text-zinc-500 -mt-1">Las razones de reposición no tienen área: valen para cualquier orden.</p>
                            )}
                            <div className="grid sm:grid-cols-2 gap-2">
                                <Opcion marcado={editando.frecuente} onChange={v => setEditando(d => ({ ...d, frecuente: v }))}
                                    Icono={Star} titulo="Frecuente" texto="Sale primero en la lista" />
                                <Opcion marcado={editando.activo} onChange={v => setEditando(d => ({ ...d, activo: v }))}
                                    titulo="Activo" texto="Si no, no se ofrece en ninguna lista" />
                            </div>
                            </>)}
                        </div>
                        <div className="px-5 py-4 border-t border-zinc-200 bg-zinc-50 flex justify-end gap-2">
                            <button type="button" onClick={() => setEditando(null)} disabled={guardando} className={BTN_SECUNDARIO}>Cancelar</button>
                            <button type="button" onClick={guardar} disabled={guardando} className={BTN_PRINCIPAL}>
                                {guardando ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                                {editando.id ? 'Guardar' : 'Crear'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {ventanaConfirmar}
        </div>
    );
}
