import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Plus, Search, ImageOff, ChevronDown } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import Selector from '../ui/Selector';
import SelectorFecha from '../ui/SelectorFecha';
import { btnPri, btnSec, btnCancelar, input, label, campoFiltro } from '../servicio-tecnico/ui';
import ClienteBuscador from './ClienteBuscador';
import { Comentarios, Historial, Adjuntos, Pastilla, Desplegable, fmtD, mensajeError } from './comun';
import {
    puntaje, fmtPuntaje, recBandeja, hoy, TIPOS_PEDIDO, tipoCorto, esAbierto, ETIQUETA_ESTADO, CRITERIOS, coincide,
} from './reglas';

// Bandeja (spec-B §2): todo lo que entra (pedidos, ideas, órdenes, correcciones y variantes) y la
// decisión de cada uno: aprobar y crear el proyecto (editor), posponer o descartar con un motivo que ve
// quien lo pidió. Textos del prototipo de Felipe.

const CHIPS = [
    ['abiertas', 'Por resolver', s => esAbierto(s)],
    ['POSPUESTA', 'Pospuestas', s => s.estado === 'POSPUESTA'],
    ['APROBADA', 'Aprobadas', s => s.estado === 'APROBADA'],
    ['RECHAZADA', 'Descartadas', s => s.estado === 'RECHAZADA'],
    ['todas', 'Todas', () => true],
];
const ORDENES = [
    ['rec', 'Recomendado para atender'], ['puntaje', 'Mayor puntaje'], ['nuevas', 'Más nuevas'], ['viejas', 'Más viejas'], ['limite', 'Fecha límite más cercana'],
];
const creadoMs = (s) => new Date(s.creado || 0).getTime();
const ordenar = (lista, orden) => {
    const desempate = (a, b) => creadoMs(b) - creadoMs(a) || b.numero - a.numero;
    const l = [...lista];
    if (orden === 'puntaje') return l.sort((a, b) => puntaje(b) - puntaje(a) || desempate(a, b));
    if (orden === 'nuevas') return l.sort(desempate);
    if (orden === 'viejas') return l.sort((a, b) => -desempate(a, b));
    if (orden === 'limite') return l.sort((a, b) => (a.fechaLimite || '9999').localeCompare(b.fechaLimite || '9999') || puntaje(b) - puntaje(a));
    return l.sort((a, b) => recBandeja(b) - recBandeja(a) || desempate(a, b));
};

// Plantilla que se propone (como en el backend, services/desarrollos/altas.js): la del mismo tipo de
// desarrollo; "tecnología" → máquina y "proceso" → procedimiento; si no, prenda.
const POR_TIPO = { tecnologia: 'maquina', proceso: 'procedimiento' };
const plantillaPara = (plantillas, tipos, tipoId, tipoPedido) => {
    if (tipoPedido === 'CORRECCION') return plantillas.find(p => p.clave === 'correccion')?.id || '';
    const prod = plantillas.filter(p => p.para === 'PRODUCTO');
    const tipo = tipos.find(t => t.id === tipoId);
    return (prod.find(p => p.tipoId === tipoId)
        || (POR_TIPO[tipo?.clave] && prod.find(p => p.clave === POR_TIPO[tipo.clave]))
        || (tipo && !tipo.esProducto && prod.find(p => !tipos.find(t => t.id === p.tipoId)?.esProducto))
        || prod.find(p => p.clave === 'prenda') || prod[0])?.id || '';
};

const borradorDe = (s) => ({
    titulo: s.titulo || '', descripcion: s.descripcion || '', cliente: { id: s.clienteId || null, texto: s.cliente || '' },
    cantidad: s.cantidad || '', fechaLimite: s.fechaLimite || '', tipo: s.tipo || 'SOLICITUD', tipoId: s.tipoId,
    corrigeProyectoId: s.corrigeProyectoId || '', familia: s.familia || '', evaluacion: s.evaluacion || '',
    estrategico: s.estrategico || 3, comercial: s.comercial || 3, complejidad: s.complejidad || 3, recursos: s.recursos || 3,
});
const cambioAlgo = (s, d) => {
    const o = borradorDe(s);
    return ['titulo', 'descripcion', 'cantidad', 'fechaLimite', 'tipo', 'tipoId', 'familia', 'evaluacion', 'estrategico', 'comercial', 'complejidad', 'recursos']
        .some(k => String(o[k] ?? '') !== String(d[k] ?? ''))
        || String(o.corrigeProyectoId || '') !== String(d.corrigeProyectoId || '')
        || (o.cliente.id || null) !== (d.cliente.id || null) || o.cliente.texto !== d.cliente.texto;
};
const datosParaGuardar = (d) => ({
    ...d, titulo: d.titulo.trim(), descripcion: d.descripcion.trim(), cantidad: d.cantidad.trim(), evaluacion: d.evaluacion.trim(),
    cliente: { id: d.cliente.id || null, texto: d.cliente.texto.trim() }, fechaLimite: d.fechaLimite || null,
    corrigeProyectoId: ['CORRECCION', 'VARIANTE'].includes(d.tipo) ? (Number(d.corrigeProyectoId) || null) : null,
});

// Miniatura de la primera foto del pedido (se baja con el token)
const Miniatura = ({ fotoId }) => {
    const [url, setUrl] = useState(null);
    useEffect(() => {
        if (!fotoId) return undefined;
        let objeto = null;
        let vivo = true;
        desarrollosService.adjuntoBlob(fotoId).then(b => { objeto = URL.createObjectURL(b); if (vivo) setUrl(objeto); }).catch(() => {});
        return () => { vivo = false; if (objeto) URL.revokeObjectURL(objeto); };
    }, [fotoId]);
    return (
        <div className="w-14 h-14 rounded-xl border border-zinc-200 bg-zinc-50 overflow-hidden flex flex-col items-center justify-center shrink-0">
            {url ? <img src={url} alt="" className="w-full h-full object-cover" />
                : <><ImageOff size={16} className="text-zinc-300" /><span className="text-[9px] text-zinc-400">sin foto</span></>}
        </div>
    );
};

// ── Detalle / edición ────────────────────────────────────────────────────────
const SelectorPuntaje = ({ crit, valor, onChange, disabled }) => {
    const [k, etiqueta, bajo, alto] = crit;
    return (
        <div>
            <span className="block mb-1 text-[11px] font-bold text-zinc-500">{etiqueta}</span>
            <Selector value={String(valor || 3)} onChange={(e) => onChange(k, Number(e.target.value))} disabled={disabled} aria-label={etiqueta}>
                {[1, 2, 3, 4, 5].map(n => <option key={n} value={String(n)}>{n === 1 ? `1 · ${bajo}` : n === 5 ? `5 · ${alto}` : String(n)}</option>)}
            </Selector>
        </div>
    );
};

const PanelPedido = ({ s, d, setD, edita, esEditor, catalogos, proyectos, guardando, onGuardar, onCerrar, onBorrar, version }) => {
    const [seguro, setSeguro] = useState(false);
    const cambiar = (k, v) => setD(x => ({ ...x, [k]: v }));
    const familias = catalogos?.familias || [];
    const conProducto = ['CORRECCION', 'VARIANTE'].includes(d.tipo);
    return (
        <div className="border-t border-zinc-100 px-4 pt-4 pb-4 flex flex-col gap-4 bg-zinc-50/60">
            <div>
                <span className={label}>Qué piden</span>
                <input className={input} value={d.titulo} maxLength={120} disabled={!edita} onChange={(e) => cambiar('titulo', e.target.value)} />
            </div>
            <div>
                <span className={label}>Detalle</span>
                <textarea className={`${input} min-h-[84px]`} rows={3} value={d.descripcion} maxLength={4000} disabled={!edita} onChange={(e) => cambiar('descripcion', e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
                <div className="sm:col-span-2"><span className={label}>Cliente</span><ClienteBuscador value={d.cliente} onChange={(v) => cambiar('cliente', v)} disabled={!edita} /></div>
                <div><span className={label}>Cantidad</span><input className={input} value={d.cantidad} maxLength={60} disabled={!edita} onChange={(e) => cambiar('cantidad', e.target.value)} /></div>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
                <div><span className={label}>Para cuándo</span><SelectorFecha value={d.fechaLimite} onChange={(e) => cambiar('fechaLimite', e.target.value)} disabled={!edita} vaciable className="w-full" /></div>
                <div>
                    <span className={label}>Desarrollo de</span>
                    <Selector value={String(d.tipoId || '')} onChange={(e) => cambiar('tipoId', Number(e.target.value))} disabled={!edita} aria-label="Desarrollo de">
                        {(catalogos?.tipos || []).map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
                    </Selector>
                </div>
                <div>
                    <span className={label}>Tipo</span>
                    <Selector value={d.tipo} onChange={(e) => cambiar('tipo', e.target.value)} disabled={!edita} aria-label="Tipo" anchoLista={260}>
                        {TIPOS_PEDIDO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Selector>
                </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <span className={label}>Familia del ERP</span>
                    <Selector value={d.familia} onChange={(e) => cambiar('familia', e.target.value)} disabled={!edita} aria-label="Familia del ERP" anchoLista={260}>
                        <option value="">— sin familia —</option>
                        {familias.map(f => <option key={f.codStock} value={f.nombre}>{f.nombre}</option>)}
                        {d.familia && !familias.some(f => f.nombre === d.familia) && <option value={d.familia}>{d.familia}</option>}
                    </Selector>
                </div>
                {conProducto && (
                    <div>
                        <span className={label}>Producto</span>
                        <Selector value={String(d.corrigeProyectoId || '')} onChange={(e) => cambiar('corrigeProyectoId', e.target.value)} disabled={!edita} aria-label="Producto" anchoLista={320}>
                            <option value="">— elegir producto —</option>
                            {(proyectos || []).map(p => <option key={p.id} value={String(p.id)}>{`${p.nombre} · ${p.codigo}`}</option>)}
                        </Selector>
                    </div>
                )}
            </div>
            <div>
                <span className={label}>Puntaje (opcional) · resultado <span className="text-brand-cyan">{fmtPuntaje(puntaje(d))}</span></span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {CRITERIOS.map(c => <SelectorPuntaje key={c[0]} crit={c} valor={d[c[0]]} onChange={cambiar} disabled={!edita} />)}
                </div>
            </div>
            <div>
                <span className={label}>Nota de evaluación (opcional)</span>
                <textarea className={`${input} min-h-[64px]`} rows={2} value={d.evaluacion} maxLength={2000} disabled={!edita} onChange={(e) => cambiar('evaluacion', e.target.value)}
                    placeholder="Viabilidad, qué falta saber, con quién se habló…" />
                <p className="mt-1 text-xs text-zinc-400">Es del equipo: quien lo pidió no la ve.</p>
            </div>
            <div>
                <span className={label}>Fotos o PDF</span>
                <Adjuntos entidad="solicitud" id={s.id} editable={edita} version={version} ayuda="Fotos o PDF." />
            </div>
            <div className="flex flex-wrap items-center gap-2">
                {edita && <button type="button" onClick={() => onGuardar(false)} disabled={guardando} className={btnPri}>{guardando && <Loader2 size={15} className="animate-spin" />} Guardar cambios</button>}
                <button type="button" onClick={onCerrar} className={btnCancelar}>Cerrar</button>
                {esEditor && (
                    <button type="button" onClick={() => (seguro ? onBorrar() : setSeguro(true))} onBlur={() => setSeguro(false)}
                        className={`ml-auto text-sm font-bold ${seguro ? 'text-brand-magenta' : 'text-zinc-400 hover:text-zinc-600'}`}>
                        {seguro ? '¿Borrar? Tocá de nuevo' : 'Borrar'}
                    </button>
                )}
            </div>
            <div><span className={label}>Comentarios</span><Comentarios entidad="solicitud" id={s.id} version={version} /></div>
            <Historial entidad="solicitud" id={s.id} version={version} />
        </div>
    );
};

// ── Decisiones ───────────────────────────────────────────────────────────────
const CajaAprobar = ({ s, d, catalogos, proyectos, onConfirmar, onCancelar }) => {
    const plantillas = (catalogos?.plantillas || []).filter(p => p.para !== 'VARIANTE');
    const tipos = catalogos?.tipos || [];
    const tipoId = d?.tipoId || s.tipoId;
    const tipoPedido = d?.tipo || s.tipo;
    const esVariante = tipoPedido === 'VARIANTE';
    const conProducto = ['CORRECCION', 'VARIANTE'].includes(tipoPedido);
    const [plantillaId, setPlantillaId] = useState(() => String(plantillaPara(plantillas, tipos, tipoId, tipoPedido)));
    const [producto, setProducto] = useState(String(d?.corrigeProyectoId || s.corrigeProyectoId || ''));
    const [error, setError] = useState('');
    const [creando, setCreando] = useState(false);
    // Primero las del mismo tipo de desarrollo
    const ordenadas = [...plantillas].sort((a, b) => (b.tipoId === tipoId) - (a.tipoId === tipoId));
    const sel = plantillas.find(p => String(p.id) === plantillaId);
    const confirmar = async () => {
        if (esVariante && !producto) { setError('Elegí el producto.'); return; }
        setCreando(true);
        setError('');
        try { await onConfirmar({ plantillaId: esVariante ? null : Number(plantillaId) || null, corrigeProyectoId: Number(producto) || null }); }
        catch (e) { setError(mensajeError(e, 'No se pudo aprobar.')); setCreando(false); }
    };
    return (
        <div className="rounded-xl border border-brand-cyan/30 bg-brand-cyan/5 p-3 flex flex-col gap-3">
            {!esVariante && (
                <div>
                    <span className={label}>Plantilla de tareas</span>
                    <Selector value={plantillaId} onChange={(e) => setPlantillaId(e.target.value)} aria-label="Plantilla de tareas" anchoLista={340}>
                        {ordenadas.map(p => <option key={p.id} value={String(p.id)} descripcion={`${p.tareas} tareas · ${p.dias} días hábiles`}>{p.nombre}</option>)}
                    </Selector>
                    {sel?.descripcion && <p className="mt-1 text-xs text-zinc-500">{sel.descripcion}</p>}
                </div>
            )}
            {conProducto && (
                <div>
                    <span className={label}>{esVariante ? 'Producto al que se le agrega la variante' : 'Producto que se corrige'}</span>
                    <Selector value={producto} onChange={(e) => setProducto(e.target.value)} aria-label="Producto" anchoLista={340}>
                        <option value="">— elegir producto —</option>
                        {(proyectos || []).map(p => <option key={p.id} value={String(p.id)}>{`${p.nombre} · ${p.codigo}`}</option>)}
                    </Selector>
                </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={confirmar} disabled={creando} className={btnPri}>
                    {creando && <Loader2 size={15} className="animate-spin" />}{creando ? 'Creando…' : esVariante ? 'Aprobar y agregar la variante' : 'Crear proyecto'}
                </button>
                <button type="button" onClick={onCancelar} disabled={creando} className={btnCancelar}>Cancelar</button>
                <span className="text-xs text-zinc-500">Lo que falte se completa después, en el proyecto.</span>
            </div>
            {error && <p className="text-sm font-bold text-brand-magenta">{error}</p>}
        </div>
    );
};

const CajaDecidir = ({ tipo, onConfirmar, onCancelar }) => {
    const [motivo, setMotivo] = useState('');
    const [fecha, setFecha] = useState('');
    const [error, setError] = useState('');
    const [enviando, setEnviando] = useState(false);
    const posponer = tipo === 'posponer';
    const confirmar = async () => {
        if (!motivo.trim()) { setError('Escribí el motivo.'); return; }
        setEnviando(true);
        try { await onConfirmar({ motivo: motivo.trim(), fechaRevision: posponer ? fecha || null : null }); }
        catch (e) { setError(mensajeError(e, 'No se pudo guardar.')); setEnviando(false); }
    };
    return (
        <div className="rounded-xl border border-zinc-200 bg-white p-3 flex flex-col gap-3">
            <div>
                <span className={label}>Motivo (lo ve quien lo pidió)</span>
                <textarea className={`${input} min-h-[64px]`} rows={2} value={motivo} maxLength={2000} autoFocus
                    onChange={(e) => { setMotivo(e.target.value); setError(''); }} placeholder={posponer ? 'Por qué queda para más adelante' : 'Por qué no se hace'} />
            </div>
            {posponer && (
                <div className="max-w-xs"><span className={label}>Volver a verlo el (opcional)</span><SelectorFecha value={fecha} onChange={(e) => setFecha(e.target.value)} vaciable className="w-full" /></div>
            )}
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={confirmar} disabled={enviando} className={btnPri}>{enviando && <Loader2 size={15} className="animate-spin" />}{posponer ? 'Posponer' : 'Descartar'}</button>
                <button type="button" onClick={onCancelar} disabled={enviando} className={btnCancelar}>Cancelar</button>
                {error && <span className="text-sm font-bold text-brand-magenta">{error}</span>}
            </div>
        </div>
    );
};

// ── Tarjeta ──────────────────────────────────────────────────────────────────
const Tarjeta = ({ s, tipos, sesion, abierto, onAlternar, accion, setAccion, onReabrir, onVerProyecto, children }) => {
    const abiertoEstado = esAbierto(s);
    const tipoDes = tipos.find(t => t.id === s.tipoId);
    const h = hoy();
    const enAccion = accion?.id === s.id;
    return (
        <div id={`bandeja-${s.id}`} className="rounded-2xl border border-zinc-200 bg-white overflow-hidden">
            <div className="flex gap-3 p-3 sm:p-4">
                <Miniatura fotoId={s.fotoId} />
                <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                    <div className="flex items-start gap-2">
                        <button type="button" onClick={onAlternar} className="flex-1 min-w-0 flex items-start gap-1.5 text-left">
                            <span className="text-sm sm:text-base font-bold text-zinc-800 hover:text-brand-cyan">{s.titulo || 'Sin título'}</span>
                            <ChevronDown size={16} className={`mt-0.5 shrink-0 text-zinc-400 transition-transform ${abierto ? 'rotate-180' : ''}`} />
                        </button>
                        <span title="Puntaje" className="shrink-0 min-w-[2.5rem] text-center px-2 py-0.5 rounded-lg bg-zinc-100 text-sm font-black text-zinc-700">{fmtPuntaje(puntaje(s))}</span>
                        {!abiertoEstado && <Pastilla tono={s.estado === 'APROBADA' ? 'desarrollo' : s.estado === 'POSPUESTA' ? 'pospuesto' : 'no'}>{ETIQUETA_ESTADO[s.estado] || s.estado}</Pastilla>}
                    </div>
                    <p className="text-xs text-zinc-500 leading-relaxed">
                        {s.codigo} · {tipoCorto(s.tipo)}
                        {tipoDes && !tipoDes.esProducto && <> · <b className="text-zinc-700">{tipoDes.nombre}</b></>}
                        {s.pedidoPor && ` · pidió ${s.pedidoPor}`}{s.cliente && ` · cliente ${s.cliente}`}
                        {` · ${fmtD(s.creado)}`}{s.comentarios > 0 && ` · ${s.comentarios} ${s.comentarios === 1 ? 'comentario' : 'comentarios'}`}
                        {abiertoEstado && s.fechaLimite && (
                            <> · <span className={`font-bold ${s.fechaLimite < h ? 'text-brand-magenta' : 'text-amber-700'}`}>{s.fechaLimite < h ? 'vencido el' : 'para el'} {fmtD(s.fechaLimite)}</span></>
                        )}
                    </p>
                    {!abiertoEstado && s.estado !== 'APROBADA' && s.motivo && (
                        <div className="rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs"><b className="text-zinc-500">Motivo</b> <span className="text-zinc-700">{s.motivo}</span></div>
                    )}
                    {s.estado === 'POSPUESTA' && s.fechaRevision && (
                        <p className="text-xs text-amber-700">Volver a verlo el {fmtD(s.fechaRevision)}{s.fechaRevision <= h && <b> · ya es momento</b>}</p>
                    )}
                    <Desplegable abierto={!enAccion} hueco={6}>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                            {sesion.esEquipo && (abiertoEstado || s.estado === 'POSPUESTA') && (<>
                                {sesion.esEditor
                                    ? <button type="button" onClick={() => setAccion({ id: s.id, tipo: 'aprobar' })} className={btnPri}>{s.tipo === 'VARIANTE' ? 'Aprobar' : 'Aprobar y crear proyecto'}</button>
                                    : <span className="text-xs text-zinc-400">Aprobar lo hace un editor del equipo.</span>}
                                {abiertoEstado && <button type="button" onClick={() => setAccion({ id: s.id, tipo: 'posponer' })} className={btnSec}>Posponer</button>}
                                {s.tipo !== 'ORDEN' && <button type="button" onClick={() => setAccion({ id: s.id, tipo: 'descartar' })} className={btnSec}>Descartar</button>}
                            </>)}
                            {s.proyectoId && (
                                <button type="button" onClick={() => onVerProyecto(s.proyectoId)} className="text-sm font-bold text-brand-cyan hover:underline">
                                    Ver el proyecto{s.proyectoNombre ? `: ${s.proyectoNombre}` : ''}
                                </button>
                            )}
                            {sesion.esEquipo && s.estado === 'RECHAZADA' && <button type="button" onClick={() => onReabrir(s)} className={btnSec}>Reabrir</button>}
                        </div>
                    </Desplegable>
                    <Desplegable abierto={enAccion} hueco={6}><div className="pt-1">{children?.accion}</div></Desplegable>
                </div>
            </div>
            <Desplegable abierto={abierto}>{children?.panel}</Desplegable>
        </div>
    );
};

// ── Cargar pedido (el equipo) ────────────────────────────────────────────────
const NuevoPedidoEquipo = ({ sesion, catalogos, desarrolloInicial, onCargado, onCancelar }) => {
    const [d, setD] = useState({ titulo: '', descripcion: '', tipoId: desarrolloInicial || catalogos?.tipos?.[0]?.id, tipo: 'SOLICITUD', cliente: { id: null, texto: '' } });
    const [usuarios, setUsuarios] = useState([]);
    const [pidio, setPidio] = useState(String(sesion?.usuario?.id || ''));
    const [otro, setOtro] = useState('');
    const [error, setError] = useState('');
    const [cargando, setCargando] = useState(false);
    useEffect(() => { desarrollosService.usuarios().then(setUsuarios).catch(() => {}); }, []);
    const cambiar = (k, v) => { setD(x => ({ ...x, [k]: v })); setError(''); };
    const cargar = async () => {
        if (!d.titulo.trim()) { setError('Escribí qué piden.'); return; }
        setCargando(true);
        try {
            const nuevo = await desarrollosService.crearPedido({
                titulo: d.titulo.trim(), descripcion: d.descripcion.trim(), tipo: d.tipo, tipoId: d.tipoId,
                cliente: { id: d.cliente.id, texto: d.cliente.texto.trim() },
                ...(pidio === '__otro' ? { pedidoPorUsuarioId: null, pedidoPorTexto: otro.trim() } : { pedidoPorUsuarioId: Number(pidio) || null }),
            });
            toast.success('Cargado en la Bandeja.');
            onCargado(nuevo.id);
        } catch (e) { setError(mensajeError(e, 'No se pudo cargar.')); setCargando(false); }
    };
    return (
        <div className="rounded-2xl border border-brand-cyan/30 bg-white p-4 flex flex-col gap-4">
            <div><span className={label}>Qué piden</span><input className={input} value={d.titulo} maxLength={120} autoFocus onChange={(e) => cambiar('titulo', e.target.value)} placeholder="Ej.: camiseta de ciclismo manga larga" /></div>
            <div><span className={label}>Detalle</span><textarea className={`${input} min-h-[64px]`} rows={2} value={d.descripcion} maxLength={4000} onChange={(e) => cambiar('descripcion', e.target.value)} placeholder="Medidas, tela, terminaciones, cantidad…" /></div>
            <div className="grid gap-4 sm:grid-cols-2">
                <div>
                    <span className={label}>Desarrollo de</span>
                    <Selector value={String(d.tipoId || '')} onChange={(e) => cambiar('tipoId', Number(e.target.value))} aria-label="Desarrollo de">
                        {(catalogos?.tipos || []).map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
                    </Selector>
                </div>
                <div>
                    <span className={label}>Tipo</span>
                    <Selector value={d.tipo} onChange={(e) => cambiar('tipo', e.target.value)} aria-label="Tipo" anchoLista={260}>
                        {TIPOS_PEDIDO.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </Selector>
                </div>
                <div><span className={label}>Cliente</span><ClienteBuscador value={d.cliente} onChange={(v) => cambiar('cliente', v)} /></div>
                <div>
                    <span className={label}>Lo pidió</span>
                    <Selector value={pidio} onChange={(e) => setPidio(e.target.value)} aria-label="Lo pidió" anchoLista={280} buscar>
                        {usuarios.map(u => <option key={u.id} value={String(u.id)}>{u.nombre}</option>)}
                        <option value="__otro">Otra persona (escribir el nombre)</option>
                    </Selector>
                    {pidio === '__otro' && <input className={`${input} mt-2`} value={otro} maxLength={120} onChange={(e) => setOtro(e.target.value)} placeholder="Nombre de quien lo pidió" />}
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={cargar} disabled={cargando} className={btnPri}>{cargando && <Loader2 size={15} className="animate-spin" />} Cargar</button>
                <button type="button" onClick={onCancelar} disabled={cargando} className={btnCancelar}>Cancelar</button>
                <span className="text-xs text-zinc-500">Fotos, puntaje y el resto se agregan después, abriéndolo.</span>
                {error && <span className="text-sm font-bold text-brand-magenta">{error}</span>}
            </div>
        </div>
    );
};

// ── Pantalla ─────────────────────────────────────────────────────────────────
const BandejaVista = ({ sesion, catalogos, version, params = {} }) => {
    const navigate = useNavigate();
    const [lista, setLista] = useState(null);
    const [q, setQ] = useState('');
    const [filtroDes, setFiltroDes] = useState('');
    const [filtroTipo, setFiltroTipo] = useState(params.tipo || '');
    const [orden, setOrden] = useState('rec');
    const [chip, setChip] = useState(CHIPS.some(c => c[0] === params.est) ? params.est : 'abiertas');
    const [abierto, setAbierto] = useState(null);
    const [borrador, setBorrador] = useState(null);
    const [guardando, setGuardando] = useState(false);
    const [accion, setAccion] = useState(null);
    const [nuevo, setNuevo] = useState(!!params.nueva);
    const [proyectos, setProyectos] = useState(null);
    const pendienteAbrir = useRef(params.abrir ? Number(params.abrir) : null);
    const tipos = catalogos?.tipos || [];

    const cargar = useCallback(async () => {
        try { setLista(await desarrollosService.bandeja()); }
        catch (e) { setLista([]); toast.error(mensajeError(e, 'No se pudo cargar la Bandeja.')); }
    }, []);
    useEffect(() => { cargar(); }, [cargar, version]);
    // Los proyectos (para elegir qué producto se corrige) se piden cuando hacen falta
    const necesitaProyectos = !!(abierto || accion);
    useEffect(() => {
        if (necesitaProyectos && proyectos === null) desarrollosService.proyectosOpciones().then(setProyectos).catch(() => setProyectos([]));
    }, [necesitaProyectos, proyectos]);

    const abrir = useCallback((s) => {
        if (!s) return;
        setAbierto(s.id);
        setBorrador(borradorDe(s));
        setAccion(null);
    }, []);

    // Abrir desde un aviso (?abrir=ID): limpia la búsqueda y el tipo, y si no se ve en el chip, pasa a "Todas"
    useEffect(() => {
        if (!lista || !pendienteAbrir.current) return;
        const s = lista.find(x => x.id === pendienteAbrir.current);
        pendienteAbrir.current = null;
        if (!s) return;
        setQ(''); setFiltroTipo(''); setFiltroDes('');
        if (!CHIPS.find(c => c[0] === chip)[2](s)) setChip('todas');
        abrir(s);
        setTimeout(() => document.getElementById(`bandeja-${s.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
    }, [lista, chip, abrir]);
    useEffect(() => { if (params.abrir) pendienteAbrir.current = Number(params.abrir); }, [params.abrir]);

    const base = useMemo(() => (lista || []).filter(s =>
        coincide(q, s.titulo, s.codigo, s.descripcion, s.cliente, s.pedidoPor, s.familia)
        && (!filtroTipo || s.tipo === filtroTipo)
        && (!filtroDes || s.tipoId === Number(filtroDes))), [lista, q, filtroTipo, filtroDes]);
    const visibles = useMemo(() => ordenar(base.filter(CHIPS.find(c => c[0] === chip)[2]), orden), [base, chip, orden]);
    const porResolver = (lista || []).filter(esAbierto).length;

    const alternar = (s) => {
        if (abierto === s.id) { setAbierto(null); setBorrador(null); return; }
        abrir(s);
    };
    const reemplazar = (s) => setLista(l => (l || []).map(x => (x.id === s.id ? s : x)));

    const guardar = async (silencio = false) => {
        const s = lista.find(x => x.id === abierto);
        if (!s || !borrador) return true;
        if (!borrador.titulo.trim()) { toast.error('Falta el título.'); return false; }
        if (!cambioAlgo(s, borrador)) return true;
        setGuardando(true);
        try {
            const nuevoS = await desarrollosService.editarPedido(s.id, datosParaGuardar(borrador));
            reemplazar(nuevoS);
            setBorrador(borradorDe(nuevoS));
            if (!silencio) toast.success('Cambios guardados.');
            return true;
        } catch (e) { toast.error(mensajeError(e, 'No se pudo guardar.')); return false; }
        finally { setGuardando(false); }
    };
    // Aprobar, posponer o descartar con el detalle abierto: primero se guarda lo editado
    const empezarAccion = async (a) => {
        if (abierto === a.id && !(await guardar(true))) return;
        setAccion(a);
    };
    const aprobar = async (s, datos) => {
        const r = await desarrollosService.aprobar(s.id, datos);
        reemplazar(r.pedido);
        setAccion(null); setAbierto(null); setBorrador(null);
        toast.success(r.varianteId ? 'Variante agregada al producto.' : `Proyecto creado: ${r.pedido.proyectoCodigo}.`);
        // Como el prototipo: se abre la ficha (de una variante, la del producto)
        navigate(`/desarrollos/proyectos?abrir=${r.proyectoId}`);
    };
    const decidir = async (s, tipo, datos) => {
        const r = tipo === 'posponer' ? await desarrollosService.posponer(s.id, datos) : await desarrollosService.descartar(s.id, datos);
        reemplazar(r);
        setAccion(null);
        toast.success(tipo === 'posponer' ? 'Pospuesto.' : 'Descartado.');
    };
    const reabrir = async (s) => {
        try { reemplazar(await desarrollosService.reabrir(s.id)); setChip('abiertas'); toast.success('Vuelve a la Bandeja.'); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo reabrir.')); }
    };
    const borrar = async (s) => {
        try { await desarrollosService.borrarPedido(s.id); setLista(l => l.filter(x => x.id !== s.id)); setAbierto(null); setBorrador(null); toast.success('Borrado.'); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo borrar.')); }
    };
    const cargado = async (id) => {
        setNuevo(false);
        setChip('abiertas'); setQ(''); setFiltroTipo('');
        pendienteAbrir.current = id;
        await cargar();
    };

    const vacio = !lista?.length ? 'Todavía no entró ningún pedido.'
        : chip === 'abiertas' && !q && !filtroTipo ? 'No queda nada por resolver.' : 'Nada coincide con el filtro.';

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                <span className="px-2.5 py-1 rounded-full bg-brand-cyan/10 text-sm font-black text-brand-cyan">{porResolver} por resolver</span>
                <div className="flex-1" />
                {sesion.esEquipo && !nuevo && <button type="button" onClick={() => setNuevo(true)} className={btnPri}><Plus size={15} /> Cargar pedido</button>}
            </div>
            <Desplegable abierto={nuevo} hueco={16}>
                <NuevoPedidoEquipo sesion={sesion} catalogos={catalogos} desarrolloInicial={filtroDes ? Number(filtroDes) : null} onCargado={cargado} onCancelar={() => setNuevo(false)} />
            </Desplegable>

            <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[220px]">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
                    <input type="search" className={`${campoFiltro} w-full pl-9`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por título, código, cliente o quién lo pidió" />
                </div>
                <Selector filtro value={filtroDes} onChange={(e) => setFiltroDes(e.target.value)} aria-label="Desarrollo" renderValor={o => `Desarrollo: ${o?.texto || 'Todos'}`}>
                    <option value="">Todos</option>
                    {tipos.map(t => <option key={t.id} value={String(t.id)}>{t.nombre}</option>)}
                </Selector>
                <Selector filtro value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} aria-label="Tipo" renderValor={o => `Tipo: ${o?.texto || 'Todos'}`}>
                    <option value="">Todos</option>
                    {TIPOS_PEDIDO.map(([v, , corto]) => <option key={v} value={v}>{corto}</option>)}
                </Selector>
                <Selector filtro resaltar={false} value={orden} onChange={(e) => setOrden(e.target.value)} aria-label="Ordenar" anchoLista={260}>
                    {ORDENES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </Selector>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {CHIPS.map(([k, l, f]) => (
                    <button key={k} type="button" onClick={() => setChip(k)}
                        className={`px-3 py-1.5 rounded-full border text-xs font-bold transition-colors ${chip === k ? 'border-brand-cyan bg-brand-cyan text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'}`}>
                        {l} <span className={chip === k ? 'text-white/80' : 'text-zinc-400'}>{base.filter(f).length}</span>
                    </button>
                ))}
            </div>

            {lista === null ? <Loader2 size={20} className="animate-spin text-zinc-300" />
                : !visibles.length ? <p className="text-sm text-zinc-400">{vacio}</p>
                : (
                    <div className="flex flex-col gap-2.5">
                        {visibles.map(s => (
                            <Tarjeta key={s.id} s={s} tipos={tipos} sesion={sesion} abierto={abierto === s.id} onAlternar={() => alternar(s)}
                                accion={accion} setAccion={empezarAccion} onReabrir={reabrir}
                                onVerProyecto={(id) => navigate(`/desarrollos/proyectos?abrir=${id}`)}>
                                {{
                                    accion: accion?.id === s.id && (accion.tipo === 'aprobar'
                                        ? <CajaAprobar s={s} d={abierto === s.id ? borrador : null} catalogos={catalogos} proyectos={proyectos}
                                            onConfirmar={(datos) => aprobar(s, datos)} onCancelar={() => setAccion(null)} />
                                        : <CajaDecidir tipo={accion.tipo} onConfirmar={(datos) => decidir(s, accion.tipo, datos)} onCancelar={() => setAccion(null)} />),
                                    panel: abierto === s.id && borrador && (
                                        <PanelPedido s={s} d={borrador} setD={setBorrador} edita={sesion.esEquipo} esEditor={sesion.esEditor}
                                            catalogos={catalogos} proyectos={proyectos} guardando={guardando} version={version}
                                            onGuardar={guardar} onCerrar={() => { setAbierto(null); setBorrador(null); }} onBorrar={() => borrar(s)} />
                                    ),
                                }}
                            </Tarjeta>
                        ))}
                    </div>
                )}
        </div>
    );
};

export default BandejaVista;
