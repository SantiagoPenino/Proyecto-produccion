import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import {
    Loader2, Zap, Gauge, Moon, Plug, Wind, Fan, Plus, Pencil, Trash2, ArrowRightLeft, AlertTriangle, Settings2, Scale, Search, LandPlot,
} from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { mensajeError } from './constantes';
import { chip, label, input, btnPri, btnSec, btnCancelar, campoFiltro, MiniModal } from './ui';
import Selector from '../ui/Selector';
import { resumen, BANDAS_DE, ETIQUETA_BANDA, precioDe } from './consumoLocal';
import { medidasMaquina } from './planoLocal';
import PlanoEditor, { MiniPlano } from './PlanoEditor';

// Servicio Técnico → Locales (20/10/2026). Primera parte: plantas de cada local, a qué planta va cada máquina y
// cuánta energía consume el local con todo andando ("a pleno") y cuánto cuesta. Las cuentas: consumoLocal.js. Los
// datos de cada máquina salen de su ficha técnica (medidas, consumo eléctrico, aire y extracción). Segunda parte: el
// plano de cada planta (PlanoEditor.jsx).

const capital = (s) => String(s || '').replace(/(^|\s)(\p{L})/gu, (m, esp, letra) => esp + letra.toUpperCase());
const esOtro = (l) => String(l?.Nombre || '').trim().toLowerCase() === 'otro';
const fmt = (n, dec = 1) => (n == null || !Number.isFinite(n) ? '—'
    : Number(n).toLocaleString('es-UY', { minimumFractionDigits: dec, maximumFractionDigits: dec }));
const fmtPlata = (n, moneda = 'UYU') => (n == null || !Number.isFinite(n) ? '—'
    : `${moneda === 'USD' ? 'US$' : '$'} ${Number(n).toLocaleString('es-UY', { maximumFractionDigits: 0 })}`);
const pct = (x) => (x == null ? null : Math.round(x * 100));

const Tile = ({ icono: Icono, titulo, valor, unidad, detalle, tono }) => (
    <div className={`rounded-2xl border px-4 py-3 ${tono === 'rojo' ? 'border-rose-200 bg-rose-50/50' : tono === 'ambar' ? 'border-amber-200 bg-amber-50/50' : 'border-zinc-200 bg-white'}`}>
        <div className="flex items-center gap-1.5 text-[11px] font-black text-zinc-400 uppercase tracking-wide">
            <Icono size={13} className="text-brand-cyan" /> {titulo}
        </div>
        <div className="mt-1 text-2xl font-black text-zinc-800 leading-tight">
            {valor}{unidad && <span className="ml-1 text-sm font-bold text-zinc-400">{unidad}</span>}
        </div>
        {detalle && <div className="mt-0.5 text-xs text-zinc-500">{detalle}</div>}
    </div>
);

// ── Energía del local: potencia contratada con UTE y tarifa ─────────────────────────────────────────────────
const ModalEnergia = ({ local, energia, onCerrar, onGuardado }) => {
    const e = energia || {};
    const [f, setF] = useState({
        PotenciaContratadaKW: e.PotenciaContratadaKW ?? '',
        TipoTarifa: e.TipoTarifa || 'TRIPLE',
        Moneda: e.Moneda || 'UYU',
        PrecioSimple: e.PrecioSimple ?? '', PrecioPunta: e.PrecioPunta ?? '', PrecioLlano: e.PrecioLlano ?? '', PrecioValle: e.PrecioValle ?? '',
        // Horarios típicos de UTE para arrancar: se verifican contra la factura.
        PuntaDesde: e.PuntaDesde || '18:00', PuntaHasta: e.PuntaHasta || '22:00',
        ValleDesde: e.ValleDesde || '00:00', ValleHasta: e.ValleHasta || '07:00',
        PuntaSoloHabiles: e.PuntaSoloHabiles ?? true,
        CargoPotenciaKW: e.CargoPotenciaKW ?? '',
    });
    const [guardando, setGuardando] = useState(false);
    const set = (k, v) => setF(x => ({ ...x, [k]: v }));
    const campoNum = (k, titulo, unidad, ph) => (
        <div>
            <label htmlFor={`en-${k}`} className={label}>{titulo}</label>
            <div className="relative">
                <input id={`en-${k}`} className={`${input} pr-16`} inputMode="decimal" value={f[k]} placeholder={ph}
                    onChange={(ev) => set(k, ev.target.value)} />
                {unidad && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">{unidad}</span>}
            </div>
        </div>
    );
    const campoHora = (k, titulo) => (
        <div>
            <label htmlFor={`en-${k}`} className={label}>{titulo}</label>
            <input id={`en-${k}`} type="time" className={input} value={f[k]} onChange={(ev) => set(k, ev.target.value)} />
        </div>
    );
    const signo = f.Moneda === 'USD' ? 'US$/kWh' : '$/kWh';
    const guardar = async () => {
        setGuardando(true);
        try {
            await servicioTecnicoService.guardarEnergiaLocal(local.Id, f);
            toast.success('Energía del local guardada');
            onGuardado();
        } catch (err) { toast.error(mensajeError(err, 'No se pudo guardar')); }
        finally { setGuardando(false); }
    };
    return (
        <MiniModal titulo={`Energía · ${capital(local.Nombre)}`} ancho="max-w-xl" onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={guardar} disabled={guardando} className={btnPri}>
                {guardando ? <Loader2 size={15} className="animate-spin" /> : null} Guardar
            </button>
        </>}>
            <p className="text-xs text-zinc-500">Cargá los valores de la factura de UTE de este local, sin IVA.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {campoNum('PotenciaContratadaKW', 'Potencia contratada', 'kW')}
                <div>
                    <span className={label}>Moneda</span>
                    <Selector value={f.Moneda} onChange={(ev) => set('Moneda', ev.target.value)} aria-label="Moneda">
                        <option value="UYU">Pesos</option>
                        <option value="USD">Dólares</option>
                    </Selector>
                </div>
                <div className="sm:col-span-2">
                    <span className={label}>Tarifa</span>
                    <Selector value={f.TipoTarifa} onChange={(ev) => set('TipoTarifa', ev.target.value)} aria-label="Tarifa">
                        <option value="SIMPLE" descripcion="El mismo precio todo el día">Simple</option>
                        <option value="DOBLE" descripcion="Punta y fuera de punta">Doble horario</option>
                        <option value="TRIPLE" descripcion="Punta, llano y valle">Triple horario</option>
                    </Selector>
                </div>
                {f.TipoTarifa === 'SIMPLE' ? campoNum('PrecioSimple', 'Precio del kWh', signo) : <>
                    {campoNum('PrecioPunta', 'Precio en punta', signo)}
                    {campoNum('PrecioLlano', f.TipoTarifa === 'DOBLE' ? 'Precio fuera de punta' : 'Precio en llano', signo)}
                    {f.TipoTarifa === 'TRIPLE' && campoNum('PrecioValle', 'Precio en valle', signo)}
                    <div className="sm:col-span-2 grid grid-cols-2 gap-3">
                        {campoHora('PuntaDesde', 'Punta desde')}
                        {campoHora('PuntaHasta', 'Punta hasta')}
                        {f.TipoTarifa === 'TRIPLE' && campoHora('ValleDesde', 'Valle desde')}
                        {f.TipoTarifa === 'TRIPLE' && campoHora('ValleHasta', 'Valle hasta')}
                    </div>
                    <label className="sm:col-span-2 inline-flex items-center gap-2 text-sm font-bold text-zinc-600">
                        <input type="checkbox" checked={!!f.PuntaSoloHabiles} onChange={(ev) => set('PuntaSoloHabiles', ev.target.checked)} className="w-4 h-4 accent-brand-cyan" />
                        La punta es solo de lunes a viernes
                    </label>
                </>}
                {campoNum('CargoPotenciaKW', 'Cargo por potencia', f.Moneda === 'USD' ? 'US$/kW' : '$/kW', 'por kW y por mes')}
            </div>
            {f.TipoTarifa !== 'SIMPLE' && <p className="text-xs text-zinc-400">Los horarios vienen con los típicos de UTE: verificalos con la factura.</p>}
        </MiniModal>
    );
};

// ── Planta: nueva o editar (nombre y lo que aguanta el piso) ────────────────────────────────────────────────
const ModalPlanta = ({ local, planta, onCerrar, onGuardado }) => {
    const [nombre, setNombre] = useState(planta?.Nombre || '');
    const [carga, setCarga] = useState(planta?.CargaMaxKgM2 ?? '');
    const [guardando, setGuardando] = useState(false);
    const guardar = async () => {
        setGuardando(true);
        try {
            if (planta) await servicioTecnicoService.editarPlanta(planta.PlantaId, { nombre, cargaMaxKgM2: carga });
            else {
                const r = await servicioTecnicoService.crearPlanta(local.Id, nombre);
                if (String(carga).trim() !== '') await servicioTecnicoService.editarPlanta(r.data.PlantaId, { cargaMaxKgM2: carga });
            }
            onGuardado();
        } catch (err) { toast.error(mensajeError(err, 'No se pudo guardar la planta')); }
        finally { setGuardando(false); }
    };
    return (
        <MiniModal titulo={planta ? 'Editar planta' : `Nueva planta · ${capital(local.Nombre)}`} chico onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={guardar} disabled={guardando || !nombre.trim()} className={btnPri}>
                {guardando ? <Loader2 size={15} className="animate-spin" /> : null} Guardar
            </button>
        </>}>
            <div>
                <label htmlFor="planta-nombre" className={label}>Nombre</label>
                <input id="planta-nombre" className={input} value={nombre} maxLength={60} autoFocus placeholder="Ej: Entrepiso"
                    onChange={(e) => setNombre(e.target.value)} />
            </div>
            <div>
                <label htmlFor="planta-carga" className={label}>Lo que aguanta el piso (opcional)</label>
                <div className="relative">
                    <input id="planta-carga" className={`${input} pr-16`} inputMode="decimal" value={carga} placeholder="Ej: 250"
                        onChange={(e) => setCarga(e.target.value)} />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-zinc-400">kg/m²</span>
                </div>
                <p className="mt-1 text-xs text-zinc-400">Sirve para avisar cuando se pone arriba una máquina pesada (se usa con el plano).</p>
            </div>
        </MiniModal>
    );
};

// ── Mover una máquina: local y planta ───────────────────────────────────────────────────────────────────────
const ModalUbicacion = ({ equipo, locales, plantas, onCerrar, onGuardado }) => {
    const [localId, setLocalId] = useState(equipo.LocalId ? String(equipo.LocalId) : '');
    const [plantaId, setPlantaId] = useState(equipo.PlantaId ? String(equipo.PlantaId) : '');
    const [guardando, setGuardando] = useState(false);
    const plantasLocal = plantas.filter(p => String(p.LocalId) === localId);
    const guardar = async () => {
        setGuardando(true);
        try {
            await servicioTecnicoService.guardarUbicacion(equipo.EquipoID, localId || null, (localId && plantaId) || null);
            onGuardado();
        } catch (err) { toast.error(mensajeError(err, 'No se pudo mover la máquina')); }
        finally { setGuardando(false); }
    };
    return (
        <MiniModal titulo={`Ubicar · ${equipo.Nombre}`} chico onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={guardar} disabled={guardando} className={btnPri}>
                {guardando ? <Loader2 size={15} className="animate-spin" /> : null} Guardar
            </button>
        </>}>
            <div>
                <span className={label}>Local</span>
                <Selector value={localId} onChange={(e) => { setLocalId(e.target.value); setPlantaId(''); }} aria-label="Local">
                    <option value="">Sin local</option>
                    {locales.map(l => <option key={l.Id} value={String(l.Id)}>{capital(l.Nombre)}</option>)}
                </Selector>
            </div>
            <div>
                <span className={label}>Planta</span>
                <Selector value={plantaId} onChange={(e) => setPlantaId(e.target.value)} aria-label="Planta" disabled={!localId || !plantasLocal.length}>
                    <option value="">{localId ? 'Sin planta' : 'Primero el local'}</option>
                    {plantasLocal.map(p => <option key={p.PlantaId} value={String(p.PlantaId)}>{p.Nombre}</option>)}
                </Selector>
            </div>
        </MiniModal>
    );
};

// ── Agregar máquinas a una planta (varias de una vez) ───────────────────────────────────────────────────────
const ModalAgregar = ({ local, planta, equipos, locales, plantas, onCerrar, onGuardado }) => {
    const [q, setQ] = useState('');
    const [elegidas, setElegidas] = useState(() => new Set());
    const [guardando, setGuardando] = useState(false);
    const dondeEsta = (e) => {
        if (!e.LocalId) return 'Sin local';
        const l = locales.find(x => x.Id === e.LocalId);
        const p = plantas.find(x => x.PlantaId === e.PlantaId);
        return `${capital(l?.Nombre || '')}${p ? ` · ${p.Nombre}` : ''}`;
    };
    const lista = equipos
        .filter(e => !(e.LocalId === local.Id && (e.PlantaId || null) === (planta?.PlantaId || null)))
        .filter(e => !q.trim() || `${e.Nombre} ${e.AreaNombre || e.AreaID}`.toLowerCase().includes(q.trim().toLowerCase()))
        // primero las que no tienen local
        .sort((a, b) => (a.LocalId ? 1 : 0) - (b.LocalId ? 1 : 0) || String(a.Nombre).localeCompare(String(b.Nombre)));
    const alternar = (id) => setElegidas(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
    const guardar = async () => {
        setGuardando(true);
        try {
            for (const id of elegidas) await servicioTecnicoService.guardarUbicacion(id, local.Id, planta?.PlantaId || null);
            toast.success(`${elegidas.size} máquina${elegidas.size === 1 ? '' : 's'} en ${capital(local.Nombre)}${planta ? ` · ${planta.Nombre}` : ''}`);
            onGuardado();
        } catch (err) { toast.error(mensajeError(err, 'No se pudieron ubicar las máquinas')); onGuardado(); }
        finally { setGuardando(false); }
    };
    return (
        <MiniModal titulo={`Agregar a ${capital(local.Nombre)}${planta ? ` · ${planta.Nombre}` : ''}`} onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={guardar} disabled={guardando || !elegidas.size} className={btnPri}>
                {guardando ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Agregar {elegidas.size || ''}
            </button>
        </>}>
            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar máquina…" className={`${campoFiltro} w-full pl-9`} autoFocus />
            </div>
            <div className="max-h-[50vh] overflow-y-auto -mx-1 px-1 space-y-1">
                {lista.length === 0 && <div className="py-8 text-center text-sm text-zinc-400">No hay máquinas para agregar.</div>}
                {lista.map(e => (
                    <label key={e.EquipoID} className={`flex items-center gap-3 rounded-xl border px-3 py-2 cursor-pointer ${elegidas.has(e.EquipoID) ? 'border-brand-cyan bg-brand-cyan/5' : 'border-zinc-200 hover:border-zinc-300'}`}>
                        <input type="checkbox" checked={elegidas.has(e.EquipoID)} onChange={() => alternar(e.EquipoID)} className="w-4 h-4 accent-brand-cyan" />
                        <span className="min-w-0 flex-1">
                            <span className="block font-bold text-sm text-zinc-800 truncate">{e.Nombre}</span>
                            <span className="block text-xs text-zinc-400 truncate">{e.AreaNombre || e.AreaID} · {dondeEsta(e)}</span>
                        </span>
                    </label>
                ))}
            </div>
        </MiniModal>
    );
};

// ── Filas de máquinas de una planta ─────────────────────────────────────────────────────────────────────────
const FilaMaquina = ({ equipo, c, moneda, puedeEditar, onAbrir, onMover }) => (
    <div className="grid grid-cols-[1fr_auto] lg:grid-cols-[minmax(160px,1.4fr)_repeat(5,minmax(70px,0.7fr))_auto] gap-x-3 gap-y-1 items-center px-4 py-2.5 border-t border-zinc-100 text-sm">
        <button type="button" onClick={onAbrir} className="min-w-0 text-left">
            <span className="block font-bold text-zinc-800 truncate hover:text-brand-cyan">{equipo.Nombre}</span>
            <span className="block text-xs text-zinc-400 truncate">{equipo.AreaNombre || equipo.AreaID}</span>
        </button>
        {c.potNom == null ? (
            <span className="lg:col-span-5 justify-self-start"><span className={`${chip} bg-amber-50 text-amber-700 border-amber-200`}>Falta la potencia en la ficha</span></span>
        ) : <>
            <span className="hidden lg:block text-zinc-700">
                <b>{fmt(c.potNom, 2)}</b> kW
                {c.potMax !== c.potNom && <span className="block text-xs text-zinc-400">pico {fmt(c.potMax, 2)}</span>}
            </span>
            <span className="hidden lg:block text-zinc-600">
                {c.fasesCargadas ? (c.trifasica ? 'Trifásica' : 'Monofásica') : <span className="text-amber-600">¿Fases?</span>}
                <span className="block text-xs text-zinc-400">{fmt(c.tension, 0)} V</span>
            </span>
            <span className="hidden lg:block text-zinc-600" title={c.corrienteEstimada ? 'Estimada con la potencia (no está en la ficha)' : 'Según el fabricante'}>{fmt(c.corriente, 1)} A{c.corrienteEstimada ? '*' : ''}</span>
            <span className="hidden lg:block text-zinc-600">{c.sinHorario ? <span className="text-amber-600">sin horario</span> : `${fmt(c.horasSemana, 0)} h/sem`}</span>
            <span className="hidden lg:block text-zinc-700">{c.pleno ? <><b>{fmtPlata(c.pleno.costoTotal, moneda)}</b><span className="block text-xs text-zinc-400">{fmt(c.pleno.kwhTotal, 0)} kWh</span></> : '—'}</span>
            <span className="lg:hidden col-span-1 text-xs text-zinc-500">{fmt(c.potNom, 2)} kW · {c.pleno ? fmtPlata(c.pleno.costoTotal, moneda) : '—'}/mes</span>
        </>}
        {puedeEditar ? (
            <button type="button" onClick={onMover} title="Mover a otra planta o local" className="row-start-1 col-start-2 lg:row-auto lg:col-auto p-1.5 rounded-lg text-zinc-400 hover:text-brand-cyan hover:bg-zinc-100">
                <ArrowRightLeft size={16} />
            </button>
        ) : <span />}
    </div>
);

const LocalesVista = ({ meta, onAbrirMaquina }) => {
    const [datos, setDatos] = useState(null);
    const [error, setError] = useState(null);
    const [sel, setSel] = useState(null);      // LocalId o 'sin'
    const [modal, setModal] = useState(null);  // { tipo: 'energia' | 'planta' | 'ubicar' | 'agregar' | 'borrarPlanta', ... }
    const [borrando, setBorrando] = useState(false);
    const [planoAbierto, setPlanoAbierto] = useState(null); // PlantaId

    const cargar = useCallback(async () => {
        try {
            const d = await servicioTecnicoService.locales();
            setDatos(d);
            setError(null);
            setSel(s => s ?? (d.locales.find(l => !esOtro(l))?.Id ?? null));
        } catch (e) { setError(mensajeError(e, 'No se pudieron cargar los locales')); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);
    const recargar = () => { setModal(null); cargar(); };

    const vista = useMemo(() => {
        if (!datos) return null;
        const { locales, plantas, energia, equipos, horarios } = datos;
        const visibles = locales.filter(l => !esOtro(l) || equipos.some(e => e.LocalId === l.Id));
        const porLocal = Object.fromEntries(visibles.map(l => {
            const en = energia.find(x => x.LocalId === l.Id) || null;
            return [l.Id, { local: l, energia: en, r: resumen(equipos.filter(e => e.LocalId === l.Id), horarios, en) }];
        }));
        const sinLocal = equipos.filter(e => !e.LocalId);
        const medidas = Object.fromEntries(equipos.map(e => [e.EquipoID, medidasMaquina(e.ficha)]));
        return { visibles, porLocal, sinLocal, plantas, equipos, horarios, medidas };
    }, [datos]);

    if (error) return <div className="py-16 text-center text-sm text-rose-600">{error}</div>;
    if (!vista) return <div className="py-16 flex justify-center"><Loader2 className="animate-spin text-zinc-300" /></div>;
    const puedeEditar = !!datos.puedeEditar;
    // Si se ubicaron todas las que estaban "sin local", se vuelve al primer local.
    const selVista = sel === 'sin' && !vista.sinLocal.length ? vista.visibles[0]?.Id ?? null : sel;
    const actual = selVista === 'sin' ? null : vista.porLocal[selVista];

    const borrarPlanta = async (p) => {
        setBorrando(true);
        try { await servicioTecnicoService.borrarPlanta(p.PlantaId); recargar(); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo borrar la planta')); }
        finally { setBorrando(false); }
    };

    return (
        <div>
            {/* Locales */}
            <div className="flex flex-wrap gap-2 mb-4">
                {vista.visibles.map(l => {
                    const { r } = vista.porLocal[l.Id];
                    const activo = selVista === l.Id;
                    return (
                        <button key={l.Id} type="button" onClick={() => setSel(l.Id)}
                            className={`text-left rounded-2xl border px-4 py-2.5 transition-all ${activo ? 'border-brand-cyan bg-brand-cyan/5 shadow-sm' : 'border-zinc-200 bg-white hover:border-zinc-300'}`}>
                            <span className="block font-black text-zinc-800">{capital(l.Nombre)}</span>
                            <span className="block text-xs text-zinc-500">{r.cantidad} máquina{r.cantidad === 1 ? '' : 's'} · {fmt(r.potNom, 1)} kW</span>
                        </button>
                    );
                })}
                {vista.sinLocal.length > 0 && (
                    <button type="button" onClick={() => setSel('sin')}
                        className={`text-left rounded-2xl border px-4 py-2.5 transition-all ${selVista === 'sin' ? 'border-amber-400 bg-amber-50 shadow-sm' : 'border-amber-200 bg-amber-50/40 hover:border-amber-300'}`}>
                        <span className="block font-black text-amber-800">Sin local</span>
                        <span className="block text-xs text-amber-700">{vista.sinLocal.length} máquina{vista.sinLocal.length === 1 ? '' : 's'} sin ubicar</span>
                    </button>
                )}
            </div>

            {selVista === 'sin' && (
                <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
                    <div className="px-4 py-3 text-sm text-zinc-600">Estas máquinas no tienen local en su ficha: no entran en ninguna cuenta.</div>
                    {vista.sinLocal.map(e => (
                        <div key={e.EquipoID} className="flex items-center gap-3 px-4 py-2.5 border-t border-zinc-100">
                            <button type="button" onClick={() => onAbrirMaquina(e.EquipoID)} className="min-w-0 flex-1 text-left">
                                <span className="block font-bold text-sm text-zinc-800 truncate hover:text-brand-cyan">{e.Nombre}</span>
                                <span className="block text-xs text-zinc-400">{e.AreaNombre || e.AreaID}</span>
                            </button>
                            {puedeEditar && <button type="button" onClick={() => setModal({ tipo: 'ubicar', equipo: e })} className={btnSec}><ArrowRightLeft size={14} /> Ubicar</button>}
                        </div>
                    ))}
                </div>
            )}

            {actual && (() => {
                const { local, energia, r } = actual;
                const moneda = energia?.Moneda || 'UYU';
                const bandas = BANDAS_DE(energia);
                const plantasLocal = vista.plantas.filter(p => p.LocalId === local.Id);
                const sinPlanta = r.maquinas.filter(({ equipo }) => !equipo.PlantaId);
                const tonoUso = r.usoContratada == null ? null : r.usoContratada > 1 ? 'rojo' : r.usoContratada > 0.85 ? 'ambar' : null;
                const tonoPico = r.picoContratada == null ? null : r.picoContratada > 1 ? 'rojo' : null;
                const faltan = [
                    r.sinPotencia.length && { texto: `${r.sinPotencia.length} sin potencia: no suman al consumo`, lista: r.sinPotencia },
                    r.sinFases.length && { texto: `${r.sinFases.length} sin fases (monofásica o trifásica)`, lista: r.sinFases },
                    r.sinHorario.length && { texto: `${r.sinHorario.length} de un área sin horario cargado en Planificación: no suman al costo`, lista: r.sinHorario },
                    r.aireSinCaudal.length && { texto: `${r.aireSinCaudal.length} piden aire comprimido sin decir cuánto`, lista: r.aireSinCaudal },
                ].filter(Boolean);
                const sinTarifa = !energia || bandas.every(b => precioDe(b, energia) == null);
                return (
                    <div className="space-y-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-lg font-black text-zinc-800 mr-auto">{capital(local.Nombre)}</h2>
                            {puedeEditar && <button type="button" onClick={() => setModal({ tipo: 'energia', local, energia })} className={btnSec}><Settings2 size={15} /> Energía del local</button>}
                            {puedeEditar && <button type="button" onClick={() => setModal({ tipo: 'planta', local, planta: null })} className={btnSec}><Plus size={15} /> Agregar planta</button>}
                        </div>

                        <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-2">
                            <Tile icono={Zap} titulo="A pleno" valor={fmt(r.potNom, 1)} unidad="kW" tono={tonoUso}
                                detalle={r.potenciaContratada != null ? `${pct(r.usoContratada)} % de los ${fmt(r.potenciaContratada, 1)} kW contratados` : 'Todas andando a su potencia nominal'} />
                            <Tile icono={Gauge} titulo="Pico" valor={fmt(r.potMax, 1)} unidad="kW" tono={tonoPico}
                                detalle={r.picoContratada != null ? `${pct(r.picoContratada)} % de la contratada` : 'Si arrancan todas juntas'} />
                            <Tile icono={Moon} titulo="En reposo" valor={fmt(r.potReposo, 1)} unidad="kW" detalle="Prendidas sin trabajar" />
                            <Tile icono={Plug} titulo="Corriente por fase" valor={fmt(r.corrientePorFase, 0)} unidad="A"
                                detalle={`Trifásicas ${fmt(r.corrienteTri, 0)} A + monofásicas ${fmt(r.corrienteMono, 0)} A repartidas`} />
                            <Tile icono={Wind} titulo="Aire comprimido" valor={fmt(r.aire, 0)} unidad="l/min" detalle="Lo que piden las máquinas" />
                            <Tile icono={Fan} titulo="Extracción" valor={fmt(r.extraccion, 0)} unidad="m³/h" detalle="Caudal que piden" />
                        </div>

                        {/* Costo */}
                        <div className="bg-white border border-zinc-200 rounded-2xl p-4">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <h3 className="text-sm font-black text-zinc-700">Costo de la energía a pleno</h3>
                                <span className="text-xs text-zinc-400">Todas las máquinas a su potencia nominal, durante todo el horario de su área. Sin IVA.</span>
                            </div>
                            {sinTarifa ? (
                                <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-zinc-500">
                                    Falta la tarifa de UTE de este local.
                                    {puedeEditar && <button type="button" onClick={() => setModal({ tipo: 'energia', local, energia })} className={btnPri}><Settings2 size={15} /> Cargar la tarifa</button>}
                                </div>
                            ) : <>
                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                                    <div className="rounded-xl bg-zinc-50 px-3 py-2">
                                        <div className="text-[11px] font-black text-zinc-400 uppercase">Por mes</div>
                                        <div className="text-xl font-black text-zinc-800">{fmtPlata(r.costoMes, moneda)}</div>
                                        <div className="text-xs text-zinc-500">{fmt(r.kwhMes, 0)} kWh{r.cargoPotenciaMes != null && ` · + ${fmtPlata(r.cargoPotenciaMes, moneda)} de potencia`}</div>
                                    </div>
                                    {bandas.map(b => (
                                        <div key={b} className="rounded-xl bg-zinc-50 px-3 py-2">
                                            <div className="text-[11px] font-black text-zinc-400 uppercase">{ETIQUETA_BANDA[b]} · {precioDe(b, energia) != null ? `${fmt(precioDe(b, energia), 2)}/kWh` : 'sin precio'}</div>
                                            <div className="text-base font-black text-zinc-800">{fmtPlata(r.costoBanda[b] ?? (precioDe(b, energia) == null ? null : 0), moneda)}<span className="text-xs font-bold text-zinc-400"> /mes</span></div>
                                            <div className="text-xs text-zinc-500">Todo andando: {fmtPlata(r.costoHoraBanda[b], moneda)} por hora</div>
                                        </div>
                                    ))}
                                </div>
                                {r.faltaPrecio && <p className="mt-2 text-xs text-amber-700">Hay horas en una banda sin precio: el total del mes no se puede calcular.</p>}
                                {r.reposoFueraKwhMes > 0 && (
                                    <p className="mt-2 text-xs text-zinc-500">Si quedan prendidas fuera de horario, en reposo suman {fmt(r.reposoFueraKwhMes, 0)} kWh y {fmtPlata(r.reposoFueraCostoMes, moneda)} por mes.</p>
                                )}
                            </>}
                        </div>

                        {faltan.length > 0 && (
                            <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4">
                                <div className="flex items-center gap-1.5 text-sm font-black text-amber-800"><AlertTriangle size={15} /> Faltan datos en las fichas</div>
                                <ul className="mt-2 space-y-1.5">
                                    {faltan.map(f => (
                                        <li key={f.texto} className="text-sm text-amber-900">
                                            {f.texto}:{' '}
                                            {f.lista.map((e, i) => (
                                                <span key={e.EquipoID}>{i > 0 && ', '}<button type="button" onClick={() => onAbrirMaquina(e.EquipoID)} className="font-bold underline decoration-amber-300 hover:text-brand-cyan">{e.Nombre}</button></span>
                                            ))}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {/* Plantas */}
                        {[...plantasLocal.map(p => ({ p, lista: r.maquinas.filter(({ equipo }) => equipo.PlantaId === p.PlantaId) })),
                          ...(sinPlanta.length ? [{ p: null, lista: sinPlanta }] : [])].map(({ p, lista }) => {
                            const sub = resumen(lista.map(x => x.equipo), vista.horarios, energia);
                            return (
                                <div key={p ? p.PlantaId : 'sin'} className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
                                        <h3 className="font-black text-zinc-800">{p ? p.Nombre : 'Sin planta asignada'}</h3>
                                        <span className="text-xs text-zinc-500">{sub.cantidad} máquina{sub.cantidad === 1 ? '' : 's'} · {fmt(sub.potNom, 1)} kW a pleno{sub.costoMes != null && sub.cantidad ? ` · ${fmtPlata(sub.costoMes, moneda)}/mes` : ''}</span>
                                        {sub.peso > 0 && <span className="inline-flex items-center gap-1 text-xs text-zinc-500"><Scale size={12} /> {fmt(sub.peso, 0)} kg</span>}
                                        {p?.CargaMaxKgM2 != null && <span className={`${chip} bg-zinc-50 text-zinc-500 border-zinc-200`}>Piso: {fmt(p.CargaMaxKgM2, 0)} kg/m²</span>}
                                        <span className="ml-auto flex items-center gap-1">
                                            {/* Con plano: la vista chica es el botón (en celular no entra: queda «Plano»). */}
                                            {p?.Plano?.puntos?.length > 0 && (
                                                <button type="button" onClick={() => setPlanoAbierto(p.PlantaId)} title="Abrir el plano"
                                                    className="hidden sm:block mr-1 rounded-lg ring-brand-cyan/50 hover:ring-2 focus-visible:ring-2 outline-none transition-shadow">
                                                    <MiniPlano plano={p.Plano} medidas={vista.medidas} ancho={96} alto={44} />
                                                </button>
                                            )}
                                            {p && (puedeEditar || p.Plano?.puntos?.length > 0) && (
                                                <button type="button" onClick={() => setPlanoAbierto(p.PlantaId)} className={`${btnSec} ${p.Plano?.puntos?.length ? 'sm:hidden' : ''}`}>
                                                    <LandPlot size={14} /> {p.Plano?.puntos?.length ? 'Plano' : 'Dibujar plano'}
                                                </button>
                                            )}
                                            {puedeEditar && <button type="button" onClick={() => setModal({ tipo: 'agregar', local, planta: p })} className={btnSec}><Plus size={14} /> Agregar máquinas</button>}
                                            {puedeEditar && p && <button type="button" onClick={() => setModal({ tipo: 'planta', local, planta: p })} title="Editar planta" className="p-2 rounded-lg text-zinc-400 hover:text-brand-cyan hover:bg-zinc-100"><Pencil size={15} /></button>}
                                            {puedeEditar && p && <button type="button" onClick={() => setModal({ tipo: 'borrarPlanta', planta: p, cantidad: lista.length })} title="Borrar planta" className="p-2 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50"><Trash2 size={15} /></button>}
                                        </span>
                                    </div>
                                    {lista.length > 0 && (
                                        <div className="hidden lg:grid grid-cols-[minmax(160px,1.4fr)_repeat(5,minmax(70px,0.7fr))_auto] gap-x-3 px-4 pb-1.5 text-[11px] font-black text-zinc-400 uppercase tracking-wide">
                                            <span>Máquina</span><span>Potencia</span><span>Conexión</span><span>Corriente</span><span>Horario</span><span>A pleno / mes</span><span className="w-8" />
                                        </div>
                                    )}
                                    {lista.length === 0
                                        ? <div className="px-4 pb-4 text-sm text-zinc-400">Sin máquinas.</div>
                                        : lista.map(({ equipo, c }) => (
                                            <FilaMaquina key={equipo.EquipoID} equipo={equipo} c={c} moneda={moneda} puedeEditar={puedeEditar}
                                                onAbrir={() => onAbrirMaquina(equipo.EquipoID)} onMover={() => setModal({ tipo: 'ubicar', equipo })} />
                                        ))}
                                </div>
                            );
                        })}
                        <p className="text-xs text-zinc-400">* Corriente estimada con la potencia (la ficha no la dice). Las monofásicas se suponen repartidas parejas entre las tres fases: si están todas en la misma, esa fase lleva mucho más.</p>
                    </div>
                );
            })()}

            {planoAbierto && (() => {
                const pl = vista.plantas.find(x => x.PlantaId === planoAbierto);
                const loc = pl && datos.locales.find(l => l.Id === pl.LocalId);
                if (!pl || !loc) return null;
                return (
                    <PlanoEditor local={loc} planta={pl} plantasLocal={vista.plantas.filter(x => x.LocalId === pl.LocalId)}
                        equipos={vista.equipos.filter(e => e.LocalId === pl.LocalId && e.PlantaId === pl.PlantaId)} todosEquipos={vista.equipos}
                        puedeEditar={puedeEditar} meta={meta} onCerrar={() => setPlanoAbierto(null)} onGuardado={cargar} />
                );
            })()}
            {modal?.tipo === 'energia' && <ModalEnergia local={modal.local} energia={modal.energia} onCerrar={() => setModal(null)} onGuardado={recargar} />}
            {modal?.tipo === 'planta' && <ModalPlanta local={modal.local} planta={modal.planta} onCerrar={() => setModal(null)} onGuardado={recargar} />}
            {modal?.tipo === 'ubicar' && <ModalUbicacion equipo={modal.equipo} locales={vista.visibles} plantas={vista.plantas} onCerrar={() => setModal(null)} onGuardado={recargar} />}
            {modal?.tipo === 'agregar' && <ModalAgregar local={modal.local} planta={modal.planta} equipos={vista.equipos} locales={vista.visibles} plantas={vista.plantas} onCerrar={() => setModal(null)} onGuardado={recargar} />}
            {modal?.tipo === 'borrarPlanta' && (
                <MiniModal titulo={`Borrar ${modal.planta.Nombre}`} chico onCerrar={() => setModal(null)} pie={<>
                    <button onClick={() => setModal(null)} className={btnCancelar}>Cancelar</button>
                    <button onClick={() => borrarPlanta(modal.planta)} disabled={borrando || modal.cantidad > 0} className={`${btnPri} bg-rose-600 hover:bg-rose-700`}>
                        {borrando ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />} Borrar
                    </button>
                </>}>
                    <p className="text-sm text-zinc-600">
                        {modal.cantidad > 0
                            ? `Tiene ${modal.cantidad} máquina${modal.cantidad === 1 ? '' : 's'}: pasalas a otra planta antes de borrarla.`
                            : 'La planta no tiene máquinas. ¿Borrarla?'}
                    </p>
                </MiniModal>
            )}
        </div>
    );
};

export default LocalesVista;
