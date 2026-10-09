import { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { Search, Loader2, AlertTriangle, Wrench, Plus } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { socket } from '../../services/socketService';
import useRecargaConFreno from '../../hooks/useRecargaConFreno';
import { estadoEquipo, fmtDia, fmtDuracion, haceCuanto, mensajeError } from './constantes';
import { chip, campoFiltro, label, input, btnPri, btnCancelar, MiniModal } from './ui';
import { TIPOS, sugerirTipo, alertasMaquina, TONO_ALERTA } from './fichaTecnicaCampos';
import Selector from '../ui/Selector';

// Alta de una máquina (08/10), con los mismos valores que Configuración → Equipos: activa, disponible y sin
// capacidad (se carga en su ficha). "Pasa por otra máquina antes de Control" (SeparacionImpresion, antes "Es
// impresora") se elige solo acá, al crearla: después se cambia en Configuración, porque de eso dependen las
// áreas. El tipo arranca con el sugerido por el área y el nombre.
const ModalNuevaMaquina = ({ areas, areaInicial = '', onCerrar, onCreada }) => {
    const [nombre, setNombre] = useState('');
    const [areaId, setAreaId] = useState(areaInicial);
    const [tipoElegido, setTipoElegido] = useState(''); // vacío = el sugerido
    const [esImpresora, setEsImpresora] = useState(false);
    const [guardando, setGuardando] = useState(false);
    const tipo = tipoElegido || (areaId ? sugerirTipo(areaId, nombre) : '');
    const valido = !!(nombre.trim() && areaId && tipo);
    // La máquina que sigue (como la nombra MachineControl): en TPU el samurai, en el resto la calandra.
    const sigue = !areaId ? 'a la calandra del área (en TPU, al samurai)'
        : areaId.toUpperCase() === 'TPU' ? 'al samurai del área' : 'a la calandra del área';
    const crear = async () => {
        setGuardando(true);
        try {
            const r = await servicioTecnicoService.crearEquipo({ nombre: nombre.trim(), areaId, tipo, esImpresora });
            toast.success(`Máquina «${nombre.trim()}» creada`);
            onCreada(r.data.EquipoID);
        } catch (e) { toast.error(mensajeError(e)); setGuardando(false); }
    };
    return (
        <MiniModal titulo="Nueva máquina" onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={crear} disabled={!valido || guardando} className={btnPri}>
                {guardando ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Crear máquina
            </button>
        </>}>
            {/* Nombre y Área en la primera fila: con el Área más abajo, a su lista (12 opciones, ~493 px) no le
                alcanzaba el lugar debajo del campo y quedaba con scroll. */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label htmlFor="nueva-maquina-nombre" className={label}>Nombre</label>
                    <input id="nueva-maquina-nombre" className={input} value={nombre} maxLength={100} autoFocus
                        onChange={(e) => setNombre(e.target.value)} placeholder="Ej: DTF-5" />
                </div>
                <div>
                    <span className={label}>Área</span>
                    {/* altoMax: las 11 áreas entran sin scroll */}
                    <Selector value={areaId} onChange={(e) => setAreaId(e.target.value)} aria-label="Área" altoMax={500}>
                        <option value="">Elegir…</option>
                        {areas.map(a => <option key={a.AreaID} value={a.AreaID}>{a.Nombre}</option>)}
                    </Selector>
                </div>
                <div>
                    <span className={label}>Tipo de máquina</span>
                    <Selector value={tipo} onChange={(e) => setTipoElegido(e.target.value)} aria-label="Tipo de máquina" disabled={!areaId}>
                        {!tipo && <option value="">Primero el área</option>}
                        {TIPOS.map(t => (
                            <option key={t.value} value={t.value} descripcion={!tipoElegido && t.value === tipo ? 'Sugerido por el área' : undefined}>{t.label}</option>
                        ))}
                    </Selector>
                </div>
            </div>
            <label className="flex items-start gap-2.5 rounded-xl border border-zinc-200 px-3 py-2.5 cursor-pointer hover:border-zinc-300">
                <input type="checkbox" checked={esImpresora} onChange={(e) => setEsImpresora(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0 accent-brand-cyan" />
                <span className="text-sm">
                    <span className="font-bold text-zinc-800">Pasa por otra máquina antes de Control</span>
                    <span className="block mt-0.5 text-zinc-500">Al finalizar, el lote no va a Control de Calidad: pasa {sigue}.</span>
                    <span className="block mt-0.5 text-xs text-zinc-400">Se elige ahora, al crearla. Después se cambia solo en Configuración → Equipos, porque de eso dependen las áreas.</span>
                </span>
            </label>
            <p className="text-xs text-zinc-500">Queda disponible y sin capacidad: la velocidad y los cabezales se cargan en su ficha técnica. Hasta entonces, Planificación no la cuenta.</p>
        </MiniModal>
    );
};

// Máquinas de producción (ConfigEquipos) con su resumen de Servicio Técnico. Tocar una abre su página
// (/servicio-tecnico/maquinas/:id, 08/10).
const MaquinasVista = ({ meta, onAbrirMaquina }) => {
    const [equipos, setEquipos] = useState(null);
    const [areasAlta, setAreasAlta] = useState([]); // áreas productivas, para dar de alta una máquina
    const [nueva, setNueva] = useState(false);
    const tec = !!meta?.esTecnico;
    const [q, setQ] = useState('');
    const [area, setArea] = useState('');
    const [soloProblemas, setSoloProblemas] = useState(false);

    const cargar = useCallback(async () => {
        try {
            const r = await servicioTecnicoService.equipos();
            setEquipos(r.data);
            setAreasAlta(r.areas || []);
        }
        catch (e) { toast.error(mensajeError(e, 'No se pudieron cargar las máquinas')); setEquipos([]); }
    }, []);
    useEffect(() => { cargar(); }, [cargar]);
    const avisar = useRecargaConFreno(() => cargar());
    useEffect(() => {
        socket.on('st:updated', avisar);
        socket.on('lotes:updated', avisar);
        return () => { socket.off('st:updated', avisar); socket.off('lotes:updated', avisar); };
    }, [avisar]);

    const areas = useMemo(() => {
        const m = new Map();
        (equipos || []).forEach(e => m.set(e.AreaID, e.AreaNombre || e.AreaID));
        return [...m.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    }, [equipos]);

    const grupos = useMemo(() => {
        const t = q.trim().toLowerCase();
        const lista = (equipos || []).filter(e =>
            (!area || e.AreaID === area)
            && (!t || [e.Nombre, e.Marca, e.Modelo].join(' ').toLowerCase().includes(t))
            && (!soloProblemas || e.Abiertas > 0 || String(e.Estado || '').trim().toUpperCase() === 'MANTENIMIENTO'));
        const g = new Map();
        lista.forEach(e => {
            const k = e.AreaNombre || e.AreaID || 'Sin área';
            if (!g.has(k)) g.set(k, []);
            g.get(k).push(e);
        });
        return [...g.entries()];
    }, [equipos, q, area, soloProblemas]);

    if (!equipos) return <div className="py-16 text-center text-zinc-400"><Loader2 className="inline animate-spin" size={22} /></div>;

    return (
        <div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex flex-wrap gap-2 items-center">
                <div className="relative flex-1 min-w-[180px]">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-300" />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar máquina…"
                        className={`${campoFiltro} w-full pl-9`} />
                </div>
                <Selector filtro value={area} onChange={(e) => setArea(e.target.value)}>
                    <option value="">Todas las áreas</option>
                    {areas.map(([id, nombre]) => <option key={id} value={id}>{nombre}</option>)}
                </Selector>
                <label className="inline-flex items-center gap-2 px-2 text-sm font-bold text-zinc-600">
                    <input type="checkbox" checked={soloProblemas} onChange={(e) => setSoloProblemas(e.target.checked)} className="w-4 h-4 accent-brand-cyan" />
                    Con solicitudes o en mantenimiento
                </label>
                {tec && (
                    <button type="button" onClick={() => setNueva(true)} className={`${btnPri} w-full sm:w-auto sm:ml-auto justify-center`}>
                        <Plus size={15} /> Nueva máquina
                    </button>
                )}
            </div>
            {nueva && <ModalNuevaMaquina areas={areasAlta} areaInicial={area} onCerrar={() => setNueva(false)} onCreada={(id) => { setNueva(false); onAbrirMaquina(id); }} />}

            {grupos.length === 0 ? (
                <div className="py-16 text-center text-sm text-zinc-400">No hay máquinas con esos filtros.</div>
            ) : grupos.map(([nombreArea, lista]) => (
                <div key={nombreArea} className="mb-5">
                    <h3 className="text-xs font-black text-zinc-400 uppercase tracking-wide mb-2">{nombreArea}</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2">
                        {lista.map(e => {
                            const est = estadoEquipo(e.Estado);
                            const enMant = String(e.Estado || '').trim().toUpperCase() === 'MANTENIMIENTO';
                            const alertas = alertasMaquina(e);
                            return (
                                <button key={e.EquipoID} onClick={() => onAbrirMaquina(e.EquipoID)}
                                    className={`flex flex-col text-left rounded-2xl border px-4 py-3 transition-all hover:shadow-sm ${enMant ? 'bg-amber-50/60 border-amber-200 hover:border-amber-300' : 'bg-white border-zinc-200 hover:border-brand-cyan/40'}`}>
                                    <div className="flex items-start justify-between gap-2">
                                        <span className="min-w-0">
                                            <span className="block font-black text-zinc-800 leading-tight">{e.Nombre}</span>
                                            {(e.Marca || e.Modelo) && <span className="block truncate text-xs text-zinc-400">{[e.Marca, e.Modelo].filter(Boolean).join(' ')}</span>}
                                        </span>
                                        <span className={`${chip} ${est.chip} shrink-0`}>{est.label}</span>
                                    </div>
                                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                                        {e.Abiertas > 0 ? (
                                            <span className={`inline-flex items-center gap-1 font-bold ${e.AbiertasParada > 0 ? 'text-amber-700' : 'text-brand-cyan'}`}>
                                                <AlertTriangle size={12} /> {e.Abiertas} abierta{e.Abiertas === 1 ? '' : 's'}{e.AbiertasParada > 0 ? ' · parada' : ''}
                                            </span>
                                        ) : <span className="text-emerald-600 font-bold">Sin solicitudes abiertas</span>}
                                        <span>{e.Fallas90} falla{e.Fallas90 === 1 ? '' : 's'} en 90 días</span>
                                        {e.MinutosParada90 > 0 && <span>parada {fmtDuracion(e.MinutosParada90)}</span>}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-zinc-400">
                                        {e.UltimaFalla && <span>Última falla {haceCuanto(e.UltimaFalla)}</span>}
                                        {e.Cambios > 0 && <span className="inline-flex items-center gap-1"><Wrench size={11} />{e.Cambios} cambio{e.Cambios === 1 ? '' : 's'} · último {fmtDia(e.UltimoCambio)}</span>}
                                    </div>
                                    {/* Alertas (parte 4, 08/10): lo que hay que mirar, rojo primero. "Sin capacidad" = Planificación no
                                        la cuenta hasta que tenga velocidad. En la página de la máquina se tocan para ir a cada cosa. */}
                                    {alertas.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {alertas.map(a => <span key={a.clave} className={`${chip} ${TONO_ALERTA[a.tono]}`}>{a.texto}</span>)}
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default MaquinasVista;
