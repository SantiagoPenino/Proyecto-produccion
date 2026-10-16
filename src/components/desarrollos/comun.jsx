import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { Loader2, X, FileText, Send, Paperclip, ChevronDown } from 'lucide-react';
import { desarrollosService } from '../../services/api';
import { btnPri, btnSec, input } from '../servicio-tecnico/ui';

// Piezas comunes de Desarrollos (docs/desarrollos/plan-integracion.md): comentarios, historial de
// cambios y adjuntos de un pedido, proyecto o muestra. Los textos son los del prototipo de Felipe.
// entidad = 'solicitud' | 'proyecto' | 'muestra'.

// 'AAAA-MM-DD…' → 'dd/mm/yy' (DP.fmtD). Los momentos (ISO con hora) se pasan a la fecha local.
export const fmtD = (s) => {
    if (!s) return '';
    const str = String(s);
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return `${str.slice(8, 10)}/${str.slice(5, 7)}/${str.slice(2, 4)}`;
    const d = new Date(str);
    if (Number.isNaN(d.getTime())) return str.slice(0, 10);
    return d.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit' });
};

export const mensajeError = (e, porDefecto = 'No se pudo guardar.') => e?.response?.data?.error || e?.response?.data?.message || porDefecto;

// Pastilla de estado. Colores del Plan funcional: cian lo que está en curso, magenta lo que pide atención,
// ámbar lo que espera y neutro lo hecho o recibido; verde, lo listo.
const TONO_PASTILLA = {
    recibido: 'border-zinc-200 bg-zinc-50 text-zinc-500',
    desarrollo: 'border-brand-cyan/30 bg-brand-cyan/10 text-brand-cyan',
    listo: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    no: 'border-brand-magenta/30 bg-brand-magenta/10 text-brand-magenta',
    pospuesto: 'border-amber-200 bg-amber-50 text-amber-700',
    neutro: 'border-zinc-200 bg-white text-zinc-600',
};
export const Pastilla = ({ tono = 'neutro', children, title }) => (
    <span title={title} className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap ${TONO_PASTILLA[tono] || TONO_PASTILLA.neutro}`}>{children}</span>
);

// ── Panel desplegable ────────────────────────────────────────────────────────
// Lo que se abre dentro de la página con un botón (formularios en línea, «más», detalles): al abrir se
// despliega (el alto crece desde 0) y al cerrar se pliega, sin fundido. El overflow se oculta solo
// mientras se mueve: abierto queda visible, para no cortar listas ni bordes de foco.
// Si lo de adentro depende de algo que puede faltar al cerrar, ponerlo como `{abierto && …}`: al
// plegarse se sigue viendo lo último que había.
// `hueco` (px): el gap de la columna flex donde está. Se descuenta afuera y se pone adentro, así el
// espacio también se despliega y no salta al abrir o cerrar (no usarlo si es el primero de la columna).
export const Desplegable = ({ abierto, children, className = '', hueco = 0 }) => (
    <AnimatePresence initial={false}>
        {abierto && (
            <motion.div
                key="desplegable"
                className={className}
                style={hueco ? { marginTop: -hueco } : undefined}
                initial={{ height: 0, overflow: 'hidden' }}
                animate={{ height: 'auto', transitionEnd: { overflow: 'visible' } }}
                exit={{ height: 0, overflow: 'hidden' }}
                transition={{ duration: 0.2, ease: 'easeInOut' }}
            >
                {hueco ? <div style={{ paddingTop: hueco }}>{children}</div> : children}
            </motion.div>
        )}
    </AnimatePresence>
);

// ── Comentarios ──────────────────────────────────────────────────────────────
// Un hilo por pedido o proyecto: lo ven y escriben el equipo y quien lo pidió. No se editan ni se borran.
export const Comentarios = ({ entidad, id, puede = true, version = 0 }) => {
    const [lista, setLista] = useState(null);
    const [texto, setTexto] = useState('');
    const [enviando, setEnviando] = useState(false);
    const cargar = useCallback(async () => {
        try { setLista(await desarrollosService.comentarios(entidad, id)); }
        catch (e) { setLista([]); toast.error(mensajeError(e, 'No se pudieron cargar los comentarios.')); }
    }, [entidad, id]);
    useEffect(() => { cargar(); }, [cargar, version]);

    const enviar = async () => {
        const t = texto.trim();
        if (!t) return;
        setEnviando(true);
        try {
            const nuevo = await desarrollosService.comentar(entidad, id, t);
            setLista(l => [...(l || []), nuevo]);
            setTexto('');
        } catch (e) { toast.error(mensajeError(e, 'No se pudo enviar el comentario.')); }
        finally { setEnviando(false); }
    };

    return (
        <div className="flex flex-col gap-2">
            {lista === null ? <Loader2 size={16} className="animate-spin text-zinc-300" />
                : !lista.length ? <p className="text-sm text-zinc-400">Sin comentarios todavía.</p>
                : lista.map(c => (
                    <div key={c.id} className="text-sm">
                        <span className="font-bold text-zinc-700">{c.quien || 'Alguien'}</span>
                        <span className="text-zinc-400"> · {fmtD(c.fecha)}</span>
                        <p className="whitespace-pre-wrap text-zinc-700">{c.texto}</p>
                    </div>
                ))}
            {puede && (
                <div className="flex items-end gap-2">
                    <textarea className={`${input} min-h-[60px]`} value={texto} maxLength={2000}
                        onChange={(e) => setTexto(e.target.value)} placeholder="Escribí un comentario o una pregunta…" />
                    <button type="button" onClick={enviar} disabled={!texto.trim() || enviando} className={btnPri}>
                        {enviando ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Enviar
                    </button>
                </div>
            )}
        </div>
    );
};

// ── Historial de cambios ─────────────────────────────────────────────────────
// Plegado, lo más nuevo arriba: "dd/mm/yy · quién · acción: detalle". Se carga al abrirlo.
export const Historial = ({ entidad, id, version = 0 }) => {
    const [abierto, setAbierto] = useState(false);
    const [lista, setLista] = useState(null);
    useEffect(() => {
        if (!abierto) return;
        desarrollosService.historial(entidad, id).then(setLista).catch(e => { setLista([]); toast.error(mensajeError(e, 'No se pudo cargar el historial.')); });
    }, [abierto, entidad, id, version]);
    return (
        <div className="text-sm">
            <button type="button" onClick={() => setAbierto(a => !a)} className="inline-flex items-center gap-1 font-bold text-zinc-500 select-none hover:text-zinc-700">
                <ChevronDown size={14} className={`transition-transform duration-200 ${abierto ? '' : '-rotate-90'}`} /> Historial de cambios
            </button>
            <Desplegable abierto={abierto}>
                <div className="pt-2 flex flex-col gap-1">
                    {lista === null ? <Loader2 size={16} className="animate-spin text-zinc-300" />
                        : !lista.length ? <p className="text-zinc-400">Sin registros.</p>
                        : lista.map(h => (
                            <p key={h.id} className="text-zinc-600">
                                {fmtD(h.fecha)} · <b className="text-zinc-700">{h.quien || '—'}</b> · {h.accion}{h.detalle ? `: ${h.detalle}` : ''}
                            </p>
                        ))}
                </div>
            </Desplegable>
        </div>
    );
};

// ── Adjuntos ─────────────────────────────────────────────────────────────────
// Miniaturas de 60×60 (las fotos se agrandan al tocarlas); lo que no es foto es una pastilla con la
// extensión que abre el archivo. Con `editable`, ✕ para quitar y un botón para subir.
const extension = (nombre, tipo) => {
    if (String(tipo || '') === 'application/pdf') return 'PDF';
    const m = String(nombre || '').match(/\.([a-z0-9]{1,6})$/i);
    return m ? m[1].toUpperCase() : 'ARCHIVO';
};

const Miniatura = ({ a, editable, onQuitar, onVer }) => {
    const [url, setUrl] = useState(null);
    const esImagen = String(a.tipo || '').startsWith('image/');
    useEffect(() => {
        if (!esImagen) return undefined;
        let objeto = null;
        let vivo = true;
        desarrollosService.adjuntoBlob(a.id).then((b) => { objeto = URL.createObjectURL(b); if (vivo) setUrl(objeto); }).catch(() => {});
        return () => { vivo = false; if (objeto) URL.revokeObjectURL(objeto); };
    }, [a.id, esImagen]);
    const abrir = async () => {
        if (esImagen && url) { onVer(url, a.nombre); return; }
        try {
            const u = URL.createObjectURL(await desarrollosService.adjuntoBlob(a.id));
            window.open(u, '_blank', 'noopener');
            setTimeout(() => URL.revokeObjectURL(u), 60000);
        } catch (e) { toast.error(mensajeError(e, 'No se pudo abrir el archivo.')); }
    };
    return (
        <div className="relative">
            <button type="button" onClick={abrir} title={`${a.nombre || ''} · ${a.quien || ''} · ${fmtD(a.fecha)}`}
                className="w-[60px] h-[60px] rounded-lg border border-zinc-200 bg-zinc-50 overflow-hidden flex flex-col items-center justify-center gap-0.5 hover:border-brand-cyan/50">
                {esImagen && url ? <img src={url} alt={a.nombre || ''} className="w-full h-full object-cover" />
                    : esImagen ? <Loader2 size={14} className="animate-spin text-zinc-300" />
                    : <><FileText size={18} className="text-brand-cyan" /><span className="text-[10px] font-black text-zinc-500">{extension(a.nombre, a.tipo)}</span></>}
            </button>
            {editable && (
                <button type="button" onClick={() => onQuitar(a)} title="Quitar"
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-zinc-200 text-zinc-500 flex items-center justify-center hover:text-brand-magenta">
                    <X size={12} />
                </button>
            )}
        </div>
    );
};

// Miniaturas con la foto agrandada a pantalla completa (Escape o tocándola la cierra)
export const Galeria = ({ lista, editable = false, onQuitar, vacio = null }) => {
    const [verFoto, setVerFoto] = useState(null); // { url, nombre }
    useEffect(() => {
        if (!verFoto) return undefined;
        const alTeclear = (e) => { if (e.key === 'Escape') setVerFoto(null); };
        window.addEventListener('keydown', alTeclear);
        return () => window.removeEventListener('keydown', alTeclear);
    }, [verFoto]);
    return (
        <>
            <div className="flex flex-wrap gap-2">
                {lista.map(a => <Miniatura key={a.id} a={a} editable={editable} onQuitar={onQuitar} onVer={(url, nombre) => setVerFoto({ url, nombre })} />)}
                {!lista.length && vacio}
            </div>
            {verFoto && createPortal(
                <div className="fixed inset-0 z-[6200] flex items-center justify-center bg-zinc-900/80 p-4" onClick={() => setVerFoto(null)}>
                    <img src={verFoto.url} alt={verFoto.nombre || ''} className="max-w-full max-h-full rounded-lg shadow-2xl" />
                </div>,
                document.body,
            )}
        </>
    );
};

export const Adjuntos = ({ entidad, id, editable = false, version = 0, ayuda = 'Fotos, PDF, planillas o texto.', accept, textoBoton = 'Subir archivos', onCambio }) => {
    const [lista, setLista] = useState(null);
    const [subiendo, setSubiendo] = useState('');
    const inputRef = useRef(null);
    const cargar = useCallback(async () => {
        try { setLista(await desarrollosService.adjuntos(entidad, id)); }
        catch (e) { setLista([]); toast.error(mensajeError(e, 'No se pudieron cargar los archivos.')); }
    }, [entidad, id]);
    useEffect(() => { cargar(); }, [cargar, version]);

    const subir = async (files) => {
        const archivos = [...(files || [])];
        if (!archivos.length) return;
        setSubiendo(archivos.length === 1 ? `Subiendo ${archivos[0].name}…` : `Subiendo ${archivos.length} archivos…`);
        try { setLista(await desarrollosService.adjuntar(entidad, id, archivos)); onCambio?.(); }
        catch (e) { toast.error(mensajeError(e, archivos.length === 1 ? `No se pudo subir ${archivos[0].name}.` : 'No se pudieron subir los archivos.')); }
        finally { setSubiendo(''); if (inputRef.current) inputRef.current.value = ''; }
    };
    const quitar = async (a) => {
        try { setLista(await desarrollosService.quitarAdjunto(a.id)); onCambio?.(); }
        catch (e) { toast.error(mensajeError(e, 'No se pudo quitar.')); }
    };

    return (
        <div className="flex flex-col gap-2">
            {lista === null ? <Loader2 size={16} className="animate-spin text-zinc-300" />
                : <Galeria lista={lista} editable={editable} onQuitar={quitar} vacio={!editable && <p className="text-sm text-zinc-400">Sin archivos.</p>} />}
            {editable && (
                <div className="flex flex-wrap items-center gap-2">
                    <input ref={inputRef} type="file" multiple accept={accept} className="hidden" onChange={(e) => subir(e.target.files)} />
                    <button type="button" onClick={() => inputRef.current?.click()} disabled={!!subiendo} className={btnSec}>
                        {subiendo ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} className="text-brand-cyan" />}
                        {subiendo || textoBoton}
                    </button>
                    {!subiendo && <span className="text-xs text-zinc-400">{ayuda}</span>}
                </div>
            )}
        </div>
    );
};
