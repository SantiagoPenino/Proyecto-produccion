import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ban, Loader2, Search, X } from 'lucide-react';
import api from '../../../services/apiClient';
import { fmtFecha } from '../../../utils/fechas';

// Spec 41 — piezas compartidas por las pantallas de Solicitudes de vendedores.

export const ESTADO_SOLICITUD = {
    INGRESADA: { txt: 'Ingresada', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
    EN_DISENO: { txt: 'En diseño', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    PEDIDO_SOLICITADO: { txt: 'Pedido solicitado', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
    CANCELADA: { txt: 'Cancelada', cls: 'bg-slate-200 text-slate-600 border-slate-300' },
};

export const ESTADO_PARTE = {
    INGRESADO: { txt: 'Ingresado', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
    ENVIADO_DISENO: { txt: 'Enviado a diseño', cls: 'bg-sky-100 text-sky-700 border-sky-200' },
    DISENO_INICIADO: { txt: 'Diseño iniciado', cls: 'bg-amber-100 text-amber-700 border-amber-200' },
    DISENADO: { txt: 'Diseñado', cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
};

export const NOMBRE_PARTE = { PRINCIPAL: 'Producción principal (sublimación)', BORDADO: 'Bordado', DTF: 'Estampado DTF', TPU: 'Estampado TPU' };
export const TIPO_TRABAJO = { REVISAR: 'Revisar el arte del cliente', DESDE_CERO: 'Diseñar desde cero' };
export const ROL_ARCHIVO = { ARTE_CLIENTE: 'Arte del cliente', REFERENCIA: 'Referencia', BOCETO: 'Boceto de ubicación', PLANILLA: 'Planilla de talles y nombres', TIZADA: 'Tizada / molde', DISENO_PRONTO: 'Diseño pronto', COMPROBANTE: 'Comprobante de pago' };
export const MONEDA = { 1: '$', 2: 'US$' };

export const errorDe = (e) => e?.response?.data?.error || e?.message || 'Error inesperado';
export const plata = (monto, mon) => (monto == null ? '—' : `${MONEDA[mon] || ''} ${Number(monto).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`.trim());

export const Pill = ({ e, mapa }) => {
    const s = mapa[e] || { txt: e, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
    return <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-wide whitespace-nowrap ${s.cls}`}>{s.txt}</span>;
};

export const PillModificada = ({ titulo }) => (
    <span title={titulo || ''} className="inline-block px-2 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-wide whitespace-nowrap bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200">Modificada · falta aceptar</span>
);

export const Info = ({ l, v }) => <div><div className="text-[9px] font-black uppercase tracking-wide text-slate-400">{l}</div><div className="text-slate-700">{v}</div></div>;

export const Campo = ({ label, children, ayuda }) => (
    <label className="block text-xs">
        <span className="text-[10px] font-black text-slate-500 uppercase tracking-wide">{label}</span>
        <div className="mt-1">{children}</div>
        {ayuda && <span className="block text-[10px] text-slate-400 mt-0.5">{ayuda}</span>}
    </label>
);

// 06/10: brand-cyan (antes índigo). BTN_PRIMARIO lo usan el detalle, Diseño y TIZADA PRO, que pasaron al tema claro;
// el formulario de la solicitud (que sigue oscuro) no lo usa. INPUT sí llega al formulario por BuscadorCliente, pero
// ahí fichaPedido.css le pone su propio foco (.fp input:focus), así que no cambia.
export const INPUT = 'block w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-brand-cyan bg-white disabled:bg-slate-50 disabled:text-slate-400';
export const BTN_PRIMARIO = 'px-3 py-1.5 rounded-lg bg-brand-cyan hover:bg-brand-cyan/90 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50';
export const BTN_SECUNDARIO = 'px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50';
export const BTN_PELIGRO = 'px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50';

/** Buscador de cliente: misma consulta que el ingreso de pedidos de prenda (/clients/search). */
export function BuscadorCliente({ cliente, onPick, disabled }) {
    const [q, setQ] = useState('');
    const [rows, setRows] = useState([]);
    const [buscando, setBuscando] = useState(false);

    useEffect(() => {
        const t = q.trim();
        if (t.length < 3) { setRows([]); return undefined; }
        setBuscando(true);
        const timer = setTimeout(() => {
            api.get('/clients/search', { params: { q: t } })
                .then(r => setRows(r.data || []))
                .catch(() => setRows([]))
                .finally(() => setBuscando(false));
        }, 400);
        return () => clearTimeout(timer);
    }, [q]);

    if (cliente) {
        return (
            <div className="flex items-center justify-between gap-2 border border-indigo-200 bg-indigo-50/60 rounded-lg px-3 py-2">
                <div className="text-sm"><b className="text-slate-800">{cliente.Nombre}</b>{cliente.Codigo ? <span className="text-slate-500 font-mono text-xs"> · {cliente.Codigo}</span> : null}</div>
                {!disabled && <button type="button" onClick={() => onPick(null)} className="text-xs font-bold text-indigo-600 hover:underline">Cambiar cliente</button>}
            </div>
        );
    }
    return (
        <div className="relative">
            <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar por nombre, fantasía o código (mínimo 3 letras)" className={`${INPUT} pl-8`} />
                {buscando && <Loader2 size={14} className="absolute right-2.5 top-2.5 animate-spin text-slate-400" />}
            </div>
            {rows.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-64 overflow-y-auto text-sm">
                    {rows.map(c => (
                        <li key={c.CodCliente}>
                            <button type="button" onClick={() => { onPick({ CodCliente: c.CodCliente, Nombre: String(c.Nombre || '').trim(), Codigo: String(c.IDCliente || '').trim() }); setQ(''); setRows([]); }}
                                className="w-full text-left px-3 py-2 hover:bg-indigo-50">
                                <b className="text-slate-800">{String(c.Nombre || '').trim()}</b>
                                <span className="text-xs text-slate-500"> · {String(c.IDCliente || '').trim()}{c.NombreFantasia ? ` · ${String(c.NombreFantasia).trim()}` : ''}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {q.trim().length >= 3 && !buscando && rows.length === 0 && <p className="text-[11px] text-slate-400 mt-1">Sin resultados.</p>}
        </div>
    );
}

/**
 * Presupuesto del que salió la solicitud (opcional). Usa el listado de la pantalla Ventas → Presupuestos:
 * cada vendedor encuentra los suyos; un administrador, todos.
 */
export function BuscadorPresupuesto({ presupuesto, onPick, clienteNombre }) {
    const [q, setQ] = useState('');
    const [lista, setLista] = useState(null);       // presupuestos del vendedor (null = todavía no se pidieron)
    const [rows, setRows] = useState([]);           // resultado de la búsqueda por texto
    const [buscando, setBuscando] = useState(false);
    const [abierto, setAbierto] = useState(false);

    // Al hacer foco se muestra el LISTADO (los más nuevos primero), sin tener que escribir nada.
    const abrir = () => {
        setAbierto(true);
        if (lista !== null) return;
        setBuscando(true);
        api.get('/presupuestos', { params: { tipo: 'PRESUPUESTO' } })
            .then(r => setLista(r.data || []))
            .catch(() => setLista([]))
            .finally(() => setBuscando(false));
    };

    useEffect(() => {
        const t = q.trim();
        if (t.length < 2) { setRows([]); return undefined; }
        setBuscando(true);
        const timer = setTimeout(() => {
            api.get('/presupuestos', { params: { tipo: 'PRESUPUESTO', q: t } })
                .then(r => setRows(r.data || []))
                .catch(() => setRows([]))
                .finally(() => setBuscando(false));
        }, 400);
        return () => clearTimeout(timer);
    }, [q]);

    if (presupuesto) {
        return (
            <div className="flex items-center justify-between gap-2 border border-indigo-200 bg-indigo-50/60 rounded-lg px-3 py-2">
                <div className="text-sm"><b className="text-slate-800 font-mono">{presupuesto.PreNumero}</b>{presupuesto.ClienteNombre ? <span className="text-slate-500 text-xs"> · {presupuesto.ClienteNombre}</span> : null}{presupuesto.Total != null ? <span className="text-slate-500 text-xs"> · {presupuesto.Moneda} {Number(presupuesto.Total).toLocaleString('es-UY', { minimumFractionDigits: 2 })}</span> : null}</div>
                <button type="button" onClick={() => onPick(null)} className="text-xs font-bold text-indigo-600 hover:underline">Quitar presupuesto</button>
            </div>
        );
    }

    const escribiendo = q.trim().length >= 2;
    const cli = String(clienteNombre || '').trim().toLowerCase();
    const esDelCliente = (p) => !!cli && String(p.ClienteNombre || '').toLowerCase().includes(cli);
    // Sin texto: el listado, con los del cliente elegido arriba. Con texto: lo que encontró la búsqueda.
    const visibles = (escribiendo ? rows : [...(lista || [])].sort((a, b) => Number(esDelCliente(b)) - Number(esDelCliente(a)))).slice(0, 50);

    return (
        <div className="relative">
            <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                <input value={q} onChange={e => { setQ(e.target.value); setAbierto(true); }} onFocus={abrir} onBlur={() => setTimeout(() => setAbierto(false), 200)}
                    placeholder="Elegí de la lista o buscá por número de presupuesto / nombre del cliente" className={`${INPUT} pl-8`} />
                {buscando && <Loader2 size={14} className="absolute right-2.5 top-2.5 animate-spin text-slate-400" />}
            </div>
            {abierto && visibles.length > 0 && (
                <ul className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-72 overflow-y-auto text-sm">
                    {!escribiendo && <li className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-slate-400 bg-slate-50 sticky top-0">{cli ? 'Tus presupuestos — primero los de este cliente' : 'Tus presupuestos — los más nuevos primero'}</li>}
                    {visibles.map(p => (
                        <li key={p.PreId}>
                            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onPick(p); setQ(''); setRows([]); setAbierto(false); }}
                                className={`w-full text-left px-3 py-2 hover:bg-indigo-50 ${!escribiendo && esDelCliente(p) ? 'bg-indigo-50/40' : ''}`}>
                                <b className="text-slate-800 font-mono">{p.PreNumero}</b>
                                <span className="text-xs text-slate-500"> · {p.ClienteNombre || 'sin cliente'} · {p.Moneda} {Number(p.Total || 0).toLocaleString('es-UY', { minimumFractionDigits: 2 })} · {p.Estado}{p.FechaEmision ? ` · ${fmtFecha(p.FechaEmision)}` : ''}</span>
                                {p.Asunto ? <div className="text-[11px] text-slate-400 truncate">{p.Asunto}</div> : null}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
            {abierto && !buscando && visibles.length === 0 && (
                <p className="text-[11px] text-slate-400 mt-1">{escribiendo ? 'Sin resultados.' : 'Todavía no tenés presupuestos emitidos.'} Cada vendedor ve solo sus propios presupuestos.</p>
            )}
        </div>
    );
}

/** Modal de confirmación con motivo obligatorio (cancelar la solicitud).
 *  06/10: en una Ventana, con el estilo del resto del sistema (encabezado blanco con el ícono en brand-cyan, a
 *  pantalla completa en el celular) y por encima de la navbar: antes iba en z-50 y la navbar (z-5010) la tapaba. */
export function MotivoModal({ titulo, descripcion, etiquetaBoton, busy, onConfirm, onClose, Icono = Ban }) {
    const [motivo, setMotivo] = useState('');
    const cerrar = () => { if (!busy) onClose(); };
    return (
        <Ventana Icono={Icono} titulo={titulo} onClose={cerrar} ancho="sm:max-w-lg"
            pie={<>
                <button type="button" onClick={cerrar} disabled={busy} className={BTN_GRANDE_NO}>No cancelar</button>
                <button type="button" onClick={() => onConfirm(motivo.trim())} disabled={busy || !motivo.trim()} className={BTN_GRANDE_PELIGRO}>{busy && <Loader2 size={14} className="animate-spin" />} {etiquetaBoton}</button>
            </>}>
            <div className="space-y-4">
                <p className="text-sm text-slate-600 whitespace-pre-line">{descripcion}</p>
                <Campo label="Motivo (obligatorio)">
                    <textarea data-autofocus rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} className={INPUT} />
                </Campo>
            </div>
        </Ventana>
    );
}

// ── Checklist de ingreso a producción (misma lectura que la maqueta: rojo frena, verde listo, ámbar después) ──
export const Sello = ({ listo, chico }) => (
    <span className={`inline-block font-black uppercase tracking-wider border-2 rounded-sm ${chico ? 'text-[10px] px-1.5 py-0.5' : 'text-sm px-2.5 py-1 -rotate-3'} ${listo ? 'text-emerald-700 border-emerald-600 bg-emerald-50' : 'text-rose-700 border-rose-600 bg-rose-50'}`}>
        {listo ? 'Listo para ingresar' : 'Falta info'}
    </span>
);

export function Checklist({ ch, titulo, compacto }) {
    if (!ch) return null;
    return (
        <div className={`rounded-xl border p-3 ${ch.listo ? 'border-emerald-200 bg-emerald-50/50' : 'border-rose-200 bg-rose-50/40'}`}>
            <div className="flex items-center gap-3 mb-2">
                <Sello listo={ch.listo} />
                <div className="text-xs text-slate-600">{titulo || (ch.listo ? 'Tiene todo lo necesario para entrar a producción.' : `Falta${ch.faltan.length === 1 ? '' : 'n'} ${ch.faltan.length} cosa${ch.faltan.length === 1 ? '' : 's'} para poder ingresar.`)}</div>
            </div>
            {ch.faltan.length > 0 && <ul className="text-xs text-rose-800 space-y-0.5 mb-2">{ch.faltan.map((x, i) => <li key={i} className="flex gap-1.5"><span className="font-black">✕</span><span>{x}</span></li>)}</ul>}
            {!compacto && ch.ok.length > 0 && <ul className="text-xs text-emerald-800 space-y-0.5">{ch.ok.map((x, i) => <li key={i} className="flex gap-1.5"><span className="font-black">✓</span><span>{x}</span></li>)}</ul>}
            {compacto && ch.ok.length > 0 && <div className="text-[11px] text-emerald-800">✓ {ch.ok.length} requisito{ch.ok.length === 1 ? '' : 's'} cumplido{ch.ok.length === 1 ? '' : 's'}</div>}
            {ch.luego.length > 0 && <div className="mt-2 pt-2 border-t border-dashed border-slate-300 text-[11px] text-amber-700">Se puede completar después, no frena: {ch.luego.join(' · ')}</div>}
        </div>
    );
}

/** Visor de un PDF generado en el servidor (Blob). Se muestra ACÁ, en un modal: no depende de
 *  pestañas emergentes (que el navegador bloquea cuando el PDF tarda en llegar). Desde el modal
 *  se descarga o se abre en pestaña nueva con un clic real del usuario. */
export function VisorPdf({ blob, nombre, onClose }) {
    const [url, setUrl] = useState(null);
    useEffect(() => {
        if (!blob) return undefined;
        const u = URL.createObjectURL(blob instanceof Blob ? blob : new Blob([blob], { type: 'application/pdf' }));
        setUrl(u);
        return () => URL.revokeObjectURL(u);
    }, [blob]);
    if (!blob) return null;
    return (
        // z-[6000] (06/10): en z-50 la navbar (z-5010) tapaba la parte de arriba del visor
        <div className="fixed inset-0 bg-black/60 z-[6000] flex items-center justify-center p-3" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200">
                    <h3 className="text-sm font-black text-slate-800 truncate">{nombre || 'Ficha del pedido'}</h3>
                    <div className="flex items-center gap-2">
                        {url && <a href={url} download={nombre || 'ficha.pdf'} className={BTN_SECUNDARIO}>Descargar</a>}
                        {url && <button type="button" onClick={() => window.open(url, '_blank')} className={BTN_SECUNDARIO}>Abrir en pestaña nueva</button>}
                        <button type="button" onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
                    </div>
                </div>
                {url ? <iframe title={nombre || 'PDF'} src={url} className="flex-1 w-full rounded-b-2xl" /> : <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin" /></div>}
            </div>
        </div>
    );
}

// ── Desplegables y ventanas con el estilo del sistema (06/10) ──

// Botón del desplegable propio (ui/Selector) con el aspecto que tenía cada <select> del navegador al que reemplaza:
// recibe sus clases (borde, tamaño, ancho, rojo si falta elegir). SEL_CAMPO es el de los campos, como INPUT.
export const claseSel = (clases) => `flex items-center gap-1.5 bg-white text-left text-slate-800 outline-none transition-colors hover:border-slate-300 focus-visible:border-brand-cyan focus-visible:ring-2 focus-visible:ring-brand-cyan/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${clases}`;
export const SEL_CAMPO = 'w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm';

// Ventanas: por encima de la navbar (z-[6000]), encabezado blanco con el ícono de Lucide en brand-cyan y sin fondo, y
// a pantalla completa en el celular. Las confirmaciones (`chica`) van en z-[6100], porque pueden abrirse encima de
// otra ventana, y en el celular no ocupan toda la pantalla: son de dos líneas, como las de Servicio Técnico. Se
// cierran con Escape, con la cruz o tocando afuera. Van en un portal. Nacieron en la Bandeja de Diseño y las usan
// también el detalle de la solicitud y Diseño.
// Botones de las ventanas, más grandes que los de las filas; en el celular se reparten el ancho y miden 44 px
const BTN_GRANDE = 'inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50 max-sm:min-h-[44px] max-sm:flex-1';
export const BTN_GRANDE_SI = `${BTN_GRANDE} bg-brand-cyan text-white hover:bg-brand-cyan/90`;
export const BTN_GRANDE_NO = `${BTN_GRANDE} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50`;
export const BTN_GRANDE_PELIGRO = `${BTN_GRANDE} bg-rose-600 text-white hover:bg-rose-700`;

// Las ventanas abiertas, la de arriba al final. Escape cierra solo la de arriba, tenga o no el foco: una confirmación
// puede abrirse sobre otra ventana. Al cerrar una, el foco vuelve adonde estaba o, si eso ya no existe (un botón que
// desapareció con lo que se confirmó), a la ventana de abajo.
const ventanasAbiertas = [];

export function Ventana({ Icono, titulo, onClose, children, pie, chica = false, ancho = 'sm:max-w-2xl' }) {
    const idTitulo = useId();
    const panel = useRef(null);
    const cerrar = useRef(onClose);
    cerrar.current = onClose;
    const enfocadoAntes = useRef(document.activeElement);
    useEffect(() => {
        const yo = { panel };
        ventanasAbiertas.push(yo);
        // El foco arranca en lo marcado con data-autofocus o en el panel (sin abrir el teclado del celular).
        // Acá y no con autoFocus: en desarrollo, StrictMode monta dos veces y el autoFocus se perdía.
        (panel.current?.querySelector('[data-autofocus]') || panel.current)?.focus();
        const tecla = (e) => { if (e.key === 'Escape' && ventanasAbiertas[ventanasAbiertas.length - 1] === yo) cerrar.current(); };
        document.addEventListener('keydown', tecla);
        const antes = enfocadoAntes.current;
        return () => {
            document.removeEventListener('keydown', tecla);
            ventanasAbiertas.splice(ventanasAbiertas.indexOf(yo), 1);
            if (antes?.isConnected) antes.focus();
            else ventanasAbiertas[ventanasAbiertas.length - 1]?.panel.current?.focus();
        };
    }, []);
    return createPortal(
        <div className={`fixed inset-0 flex justify-center bg-slate-900/70 sm:items-center sm:p-4 ${chica ? 'z-[6100] items-center p-3' : 'z-[6000]'}`} onMouseDown={onClose}>
            <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={idTitulo} tabIndex={-1}
                onMouseDown={e => e.stopPropagation()}
                className={`flex w-full flex-col overflow-hidden bg-white shadow-2xl outline-none sm:rounded-3xl sm:border sm:border-slate-200 ${chica ? 'max-w-md rounded-2xl' : `h-full sm:h-auto sm:max-h-[85vh] ${ancho}`}`}>
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-6 py-4">
                    <div className="flex min-w-0 items-center gap-3">
                        <Icono size={24} className="shrink-0 text-brand-cyan" aria-hidden="true" />
                        <h2 id={idTitulo} className="text-lg font-black text-slate-800">{titulo}</h2>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600" title="Cerrar" aria-label="Cerrar"><X size={20} /></button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
                {pie ? <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3">{pie}</div> : null}
            </div>
        </div>,
        document.body
    );
}

// En vez de window.confirm (la ventana del navegador), y se usa igual: if (!(await preguntar({ ... }))) return;
// Opciones: Icono, titulo, texto (admite saltos de línea), nota (en ámbar, opcional), boton y peligro (botón rojo, para
// quitar o deshacer). Devuelve la ventana para dibujar (o null) y la función que pregunta.
export function useConfirmar() {
    const [pedido, setPedido] = useState(null);
    const preguntar = useCallback((opciones) => new Promise(resolver => setPedido({ ...opciones, resolver })), []);
    const responder = (si) => { pedido.resolver(si); setPedido(null); };
    const dialogo = pedido && (
        <Ventana chica Icono={pedido.Icono} titulo={pedido.titulo} onClose={() => responder(false)}
            pie={<>
                <button type="button" onClick={() => responder(false)} className={BTN_GRANDE_NO}>Cancelar</button>
                <button type="button" data-autofocus onClick={() => responder(true)} className={pedido.peligro ? BTN_GRANDE_PELIGRO : BTN_GRANDE_SI}>{pedido.boton}</button>
            </>}>
            <p className="whitespace-pre-line text-sm text-slate-600">{pedido.texto}</p>
            {pedido.nota ? <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{pedido.nota}</p> : null}
        </Ventana>
    );
    return [dialogo, preguntar];
}
