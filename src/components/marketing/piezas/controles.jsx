import React, { useEffect, useState } from 'react';
import { COLORES, TINTAS, resolverColor } from './marca';

// Controles chicos del panel del compositor, en el tema claro de las pantallas de Marketing.

export const Tarjeta = ({ titulo, acciones, children, className = '' }) => (
    <section className={`bg-white rounded-2xl border border-slate-200 p-4 ${className}`}>
        {(titulo || acciones) && (
            <div className="flex items-center gap-2 mb-3">
                {titulo && <h3 className="flex-1 text-[11px] font-black uppercase tracking-wider text-slate-400">{titulo}</h3>}
                {acciones}
            </div>
        )}
        {children}
    </section>
);

export const Campo = ({ etiqueta, children, className = '' }) => (
    <label className={`block ${className}`}>
        <span className="block text-[11px] font-bold text-slate-500 mb-1">{etiqueta}</span>
        {children}
    </label>
);

export const claseInput = 'w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-sky-200';

export const Segmentado = ({ opciones, valor, onCambiar, className = '' }) => (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
        {opciones.map(o => (
            <button
                key={o.id}
                type="button"
                title={o.titulo || o.nombre}
                onClick={() => onCambiar(o.id)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-bold flex items-center gap-1.5 ${valor === o.id
                    ? 'bg-brand-cyan text-white border-brand-cyan'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
            >
                {o.icono && <o.icono size={14} />}
                {o.nombre}
            </button>
        ))}
    </div>
);

// Pastillas de color de la marca. «Automático» se dibuja mitad blanco, mitad negro.
export const Paleta = ({ valor, onCambiar, pieza, opciones = COLORES.map(c => c.id) }) => (
    <div className="flex flex-wrap gap-2">
        {opciones.map((id) => {
            const c = COLORES.find(x => x.id === id);
            if (!c) return null;
            const fondo = id === 'auto'
                ? 'linear-gradient(135deg, #ffffff 50%, #000000 50%)'
                : resolverColor(id, 'oscuro', pieza?.acento);
            return (
                <button
                    key={id}
                    type="button"
                    title={c.nombre}
                    aria-label={c.nombre}
                    onClick={() => onCambiar(id)}
                    className={`w-7 h-7 rounded-full border border-slate-300 flex items-center justify-center ${valor === id ? 'ring-2 ring-brand-cyan ring-offset-2' : ''}`}
                    style={{ background: fondo }}
                >
                    {/* El acento sigue a la tinta elegida para la pieza: se marca con una A para no confundirlo con el color fijo. */}
                    {id === 'acento' && <span className={`text-[10px] font-black ${pieza?.acento === 'amarillo' ? 'text-black' : 'text-white'}`}>A</span>}
                </button>
            );
        })}
    </div>
);

export const PaletaTintas = ({ valor, onCambiar }) => (
    <div className="flex gap-2">
        {Object.entries(TINTAS).map(([id, hex]) => (
            <button
                key={id}
                type="button"
                title={id.charAt(0).toUpperCase() + id.slice(1)}
                aria-label={id}
                onClick={() => onCambiar(id)}
                className={`w-8 h-8 rounded-full border border-slate-300 ${valor === id ? 'ring-2 ring-brand-cyan ring-offset-2' : ''}`}
                style={{ background: hex }}
            />
        ))}
    </div>
);

export const Interruptor = ({ activo, onCambiar, etiqueta }) => (
    <button type="button" onClick={() => onCambiar(!activo)} className="flex items-center gap-2.5 text-sm text-slate-600">
        <span className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${activo ? 'bg-emerald-500' : 'bg-slate-200'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${activo ? 'translate-x-4' : ''}`} />
        </span>
        {etiqueta}
    </button>
);

// Número que se edita libre y se aplica al salir o con Enter (así no salta mientras se tipea).
export const Numero = ({ valor, onCambiar, min, max, paso = 1, sufijo, decimales = 0 }) => {
    const [texto, setTexto] = useState('');
    const [editando, setEditando] = useState(false);
    const mostrar = (v) => (v == null || Number.isNaN(v) ? '' : String(Math.round(v * 10 ** decimales) / 10 ** decimales));
    useEffect(() => { if (!editando) setTexto(mostrar(valor)); }, [valor, editando]); // eslint-disable-line react-hooks/exhaustive-deps
    const aplicar = () => {
        setEditando(false);
        const n = parseFloat(String(texto).replace(',', '.'));
        if (Number.isNaN(n)) { setTexto(mostrar(valor)); return; }
        const v = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
        if (v !== valor) onCambiar(v);
        setTexto(mostrar(v));
    };
    return (
        <div className="relative">
            <input
                type="number"
                inputMode="decimal"
                step={paso}
                min={min}
                max={max}
                value={texto}
                onFocus={() => setEditando(true)}
                onChange={e => setTexto(e.target.value)}
                onBlur={aplicar}
                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                className={`${claseInput} ${sufijo ? 'pr-8' : ''} tabular-nums`}
            />
            {sufijo && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 pointer-events-none">{sufijo}</span>}
        </div>
    );
};

export const Deslizador = ({ valor, onCambiar, min, max, paso }) => (
    <input
        type="range"
        min={min}
        max={max}
        step={paso}
        value={valor}
        onChange={e => onCambiar(parseFloat(e.target.value))}
        className="w-full accent-[#006E97]"
    />
);
