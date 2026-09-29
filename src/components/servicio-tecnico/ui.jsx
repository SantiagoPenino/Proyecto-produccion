import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { X, Loader2, FileText, Video } from 'lucide-react';
import { servicioTecnicoService } from '../../services/api';
import { estadoEquipo, fmtFecha, mensajeError } from './constantes';

// Piezas visuales compartidas por las pantallas de Servicio Técnico.

export const chip = 'px-2 py-0.5 rounded-full border text-[11px] font-bold whitespace-nowrap';
export const label = 'block mb-1.5 text-[11px] font-black text-zinc-500 uppercase tracking-wide';
export const input = 'w-full px-3 py-2.5 border border-zinc-200 rounded-xl text-sm text-zinc-800 bg-white outline-none focus:border-brand-cyan focus:ring-2 focus:ring-brand-cyan/10 placeholder:text-zinc-300';
export const btn = 'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
export const btnSec = `${btn} bg-white border border-zinc-200 text-zinc-700 hover:bg-zinc-100`;
export const btnPri = `${btn} bg-brand-cyan text-white hover:bg-brand-cyan/90`;
export const btnCancelar = `${btn} text-zinc-500 hover:bg-zinc-200`;

// Ventanita para acciones. No se cierra tocando afuera (se perdería lo escrito).
export const MiniModal = ({ titulo, onCerrar, children, pie, ancho = 'max-w-lg' }) => createPortal(
    <div className="fixed inset-0 z-[1250] flex items-start sm:items-center justify-center bg-zinc-900/60 p-2 sm:p-4 overflow-y-auto">
        <div className={`bg-white rounded-2xl shadow-2xl w-full ${ancho} my-4 overflow-hidden`}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100">
                <h3 className="text-base font-black text-zinc-800">{titulo}</h3>
                <button onClick={onCerrar} className="w-8 h-8 rounded-lg flex items-center justify-center text-zinc-400 hover:bg-zinc-100"><X size={18} /></button>
            </div>
            <div className="p-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">{children}</div>
            {pie && <div className="px-5 py-3 border-t border-zinc-100 bg-zinc-50 flex justify-end gap-2">{pie}</div>}
        </div>
    </div>,
    document.body
);

// Pide un texto (motivo) y confirma.
export const ModalMotivo = ({ titulo, textoLabel, placeholder, sugerencias = [], confirmar, onConfirmar, onCerrar, opcional = false }) => {
    const [motivo, setMotivo] = useState('');
    const [guardando, setGuardando] = useState(false);
    const ok = async () => { setGuardando(true); try { await onConfirmar(motivo.trim()); } finally { setGuardando(false); } };
    return (
        <MiniModal titulo={titulo} onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={ok} disabled={(!opcional && !motivo.trim()) || guardando} className={btnPri}>
                {guardando && <Loader2 size={15} className="animate-spin" />} {confirmar}
            </button>
        </>}>
            <div>
                <span className={label}>{textoLabel}</span>
                {sugerencias.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                        {sugerencias.map(s => (
                            <button key={s} type="button" onClick={() => setMotivo(s)}
                                className="px-2.5 py-1 rounded-full bg-zinc-100 text-xs font-bold text-zinc-600 hover:bg-brand-cyan/10 hover:text-brand-cyan">{s}</button>
                        ))}
                    </div>
                )}
                <textarea className={`${input} min-h-[80px]`} value={motivo} autoFocus maxLength={500}
                    onChange={(e) => setMotivo(e.target.value)} placeholder={placeholder} />
            </div>
        </MiniModal>
    );
};

// Cambiar el estado de una máquina (los mismos de Configuración → Equipos), con motivo.
export const ModalEstadoMaquina = ({ nombre, estadoActual, estadosEquipo, onConfirmar, onCerrar }) => {
    const [estado, setEstado] = useState(String(estadoActual || '').trim().toUpperCase() === 'MANTENIMIENTO' ? 'DISPONIBLE' : 'MANTENIMIENTO');
    const [motivo, setMotivo] = useState('');
    const [guardando, setGuardando] = useState(false);
    const ok = async () => { setGuardando(true); try { await onConfirmar(estado, motivo.trim()); } finally { setGuardando(false); } };
    return (
        <MiniModal titulo={`Estado de ${nombre}`} onCerrar={onCerrar} pie={<>
            <button onClick={onCerrar} className={btnCancelar}>Cancelar</button>
            <button onClick={ok} disabled={!motivo.trim() || guardando} className={btnPri}>
                {guardando && <Loader2 size={15} className="animate-spin" />} Cambiar
            </button>
        </>}>
            <p className="text-sm text-zinc-600">Ahora: <span className={`${chip} ${estadoEquipo(estadoActual).chip}`}>{estadoEquipo(estadoActual).label}</span></p>
            <div className="grid grid-cols-3 gap-2">
                {estadosEquipo.map(e => (
                    <button key={e} type="button" onClick={() => setEstado(e)}
                        className={`px-2 py-2.5 rounded-xl border text-sm font-bold ${estado === e ? `${estadoEquipo(e).chip} ring-2 ring-offset-1 ring-zinc-300` : 'border-zinc-200 text-zinc-600'}`}>{estadoEquipo(e).label}</button>
                ))}
            </div>
            <p className="text-xs text-zinc-500">MANTENIMIENTO: sale de la capacidad de planificación y no recibe lotes nuevos (se le pueden sacar los que tiene).</p>
            <div><span className={label}>Motivo</span><textarea className={`${input} min-h-[70px]`} value={motivo} autoFocus maxLength={500} onChange={(e) => setMotivo(e.target.value)} /></div>
        </MiniModal>
    );
};

// Miniatura de un adjunto: se baja con el token (un <img src> directo no lo manda).
export const Adjunto = ({ a, chico = false }) => {
    const [url, setUrl] = useState(null);
    const esImagen = String(a.Mime || '').startsWith('image/');
    const esVideo = String(a.Mime || '').startsWith('video/');
    useEffect(() => {
        if (!esImagen) return undefined;
        let objeto = null;
        let vivo = true;
        servicioTecnicoService.adjuntoBlob(a.AdjId).then((b) => { objeto = URL.createObjectURL(b); if (vivo) setUrl(objeto); }).catch(() => {});
        return () => { vivo = false; if (objeto) URL.revokeObjectURL(objeto); };
    }, [a.AdjId, esImagen]);
    const abrir = async () => {
        try {
            const b = await servicioTecnicoService.adjuntoBlob(a.AdjId);
            const u = URL.createObjectURL(b);
            window.open(u, '_blank', 'noopener');
            setTimeout(() => URL.revokeObjectURL(u), 60000);
        } catch (e) { toast.error(mensajeError(e, 'No se pudo abrir el archivo')); }
    };
    const tam = chico ? 'w-16 h-16' : 'w-24 h-24';
    return (
        <button type="button" onClick={abrir} title={`${a.NombreOriginal || ''} · ${a.UsuarioNombre || ''} · ${fmtFecha(a.Fecha)}`}
            className={`relative ${tam} rounded-xl border border-zinc-200 bg-zinc-50 overflow-hidden flex flex-col items-center justify-center gap-1 hover:border-brand-cyan/50 shrink-0`}>
            {esImagen && url ? <img src={url} alt={a.NombreOriginal || ''} className="w-full h-full object-cover" />
                : esImagen ? <Loader2 size={18} className="animate-spin text-zinc-300" />
                : <>{esVideo ? <Video size={22} className="text-zinc-400" /> : <FileText size={22} className="text-zinc-400" />}
                    <span className="px-1 text-[10px] text-zinc-500 truncate w-full">{a.NombreOriginal}</span></>}
        </button>
    );
};

export const Dato = ({ titulo, children }) => (
    <div className="min-w-0">
        <div className="text-[10px] font-black text-zinc-400 uppercase tracking-wide">{titulo}</div>
        <div className="text-sm text-zinc-800 break-words">{children}</div>
    </div>
);

// Panel lateral (detalle de solicitud, ficha de máquina, ...). Tocando afuera se cierra.
export const PanelLateral = ({ onCerrar, children, ancho = 'max-w-2xl' }) => createPortal(
    <div className="fixed inset-0 z-[1100] flex justify-end bg-zinc-900/50" onMouseDown={onCerrar}>
        <div className={`h-full w-full ${ancho} bg-zinc-50 shadow-2xl flex flex-col`} onMouseDown={(e) => e.stopPropagation()}>
            {children}
        </div>
    </div>,
    document.body
);
