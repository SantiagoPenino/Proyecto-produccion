import React, { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';
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
export const ROL_ARCHIVO = { ARTE_CLIENTE: 'Arte del cliente', REFERENCIA: 'Referencia', BOCETO: 'Boceto de ubicación', PLANILLA: 'Planilla de talles y nombres', TIZADA: 'Tizada / molde', DISENO_PRONTO: 'Diseño pronto' };
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

export const INPUT = 'block w-full border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm text-slate-800 outline-none focus:border-indigo-500 bg-white disabled:bg-slate-50 disabled:text-slate-400';
export const BTN_PRIMARIO = 'px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold inline-flex items-center gap-1 disabled:opacity-50';
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

/** Modal de confirmación con motivo obligatorio (cancelar la solicitud). */
export function MotivoModal({ titulo, descripcion, etiquetaBoton, busy, onConfirm, onClose }) {
    const [motivo, setMotivo] = useState('');
    const ref = useRef(null);
    useEffect(() => { ref.current?.focus(); }, []);
    return (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={busy ? undefined : onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between gap-3">
                    <h3 className="text-base font-black text-slate-800">{titulo}</h3>
                    <button onClick={onClose} disabled={busy} className="p-1 rounded-lg hover:bg-slate-100 text-slate-500"><X size={16} /></button>
                </div>
                <p className="text-xs text-slate-600 whitespace-pre-line">{descripcion}</p>
                <Campo label="Motivo (obligatorio)">
                    <textarea ref={ref} rows={3} value={motivo} onChange={e => setMotivo(e.target.value)} className={INPUT} />
                </Campo>
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} disabled={busy} className={BTN_SECUNDARIO}>No cancelar</button>
                    <button onClick={() => onConfirm(motivo.trim())} disabled={busy || !motivo.trim()} className={BTN_PELIGRO}>{busy && <Loader2 size={12} className="animate-spin" />} {etiquetaBoton}</button>
                </div>
            </div>
        </div>
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
