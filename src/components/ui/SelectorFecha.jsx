import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';

// Selector de fecha con calendario propio: el del navegador no se puede estilizar y sale en el idioma del
// sistema. Se usa como un <input type="date">: value 'AAAA-MM-DD' (o ''), onChange(e) con e.target.value,
// min y max. Semana de lunes a domingo, en castellano; tocando el mes se elige mes y año. El calendario va
// en un portal (z-[99990], como el Selector): no lo cortan los paneles ni las ventanas.
//   filtro      → botón compacto para barras de filtros; se resalta con una fecha elegida (resaltar={false}
//                 para rangos que siempre tienen fecha).
//   vaciable    → muestra "Borrar" (y Supr / Retroceso la borran).
//   placeholder → texto sin fecha ("Desde", "Hasta"…).

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const ANCHO = 296;
const ALTO = 356;

const pad = (n) => String(n).padStart(2, '0');
const aISO = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`; // m de 0 a 11
const deDate = (dt) => aISO(dt.getFullYear(), dt.getMonth(), dt.getDate());
const leer = (s) => {
    const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    return r ? { y: +r[1], m: +r[2] - 1, d: +r[3] } : null;
};
const sumarDias = (iso, n) => { const f = leer(iso); return deDate(new Date(f.y, f.m, f.d + n)); };
const sumarMeses = (iso, n) => {
    const f = leer(iso);
    const primero = new Date(f.y, f.m + n, 1);
    const ultimo = new Date(primero.getFullYear(), primero.getMonth() + 1, 0).getDate();
    return aISO(primero.getFullYear(), primero.getMonth(), Math.min(f.d, ultimo));
};
const hoyLocal = () => deDate(new Date());
const mostrar = (s) => { const f = leer(s); return f ? `${pad(f.d)}/${pad(f.m + 1)}/${f.y}` : ''; };

// 6 semanas desde el lunes de la semana del día 1.
const celdasDelMes = (y, m) => {
    const corrimiento = (new Date(y, m, 1).getDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, i) => {
        const dt = new Date(y, m, 1 - corrimiento + i);
        return { iso: deDate(dt), dia: dt.getDate(), delMes: dt.getMonth() === m };
    });
};

const SelectorFecha = ({
    value, onChange, min, max, disabled = false, name, id, title, 'aria-label': ariaLabel,
    placeholder = 'dd/mm/aaaa', filtro = false, resaltar = filtro, vaciable = false, className = '',
}) => {
    const valor = leer(value) ? String(value) : '';
    const hoy = hoyLocal();
    const [abierto, setAbierto] = useState(false);
    const [pos, setPos] = useState(null);
    const [vista, setVista] = useState('dias'); // 'dias' | 'meses'
    const [mes, setMes] = useState(() => { const f = leer(valor) || leer(hoy); return { y: f.y, m: f.m }; });
    const [foco, setFoco] = useState(valor || hoy);
    const botonRef = useRef(null);
    const popRef = useRef(null);

    const fuera = (iso) => (!!min && iso < min) || (!!max && iso > max); // las fechas ISO se comparan como texto

    const calcularPos = () => {
        const b = botonRef.current;
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const ancho = Math.min(ANCHO, vw - 16);
        const left = Math.max(8, Math.min(r.left, vw - ancho - 8));
        const abajo = vh - r.bottom - 8;
        const arriba = r.top - 8;
        return abajo < ALTO && arriba > abajo ? { left, ancho, bottom: vh - r.top + 4 } : { left, ancho, top: r.bottom + 4 };
    };
    const calcularRef = useRef(calcularPos);
    calcularRef.current = calcularPos;

    const emitir = (v) => onChange?.({ target: { value: v, name }, currentTarget: { value: v, name } });
    const abrir = () => {
        if (disabled) return;
        const p = calcularPos();
        if (!p) return;
        const base = leer(valor) || leer(hoy);
        setMes({ y: base.y, m: base.m });
        setFoco(valor || hoy);
        setVista('dias');
        setPos(p);
        setAbierto(true);
    };
    const cerrar = (devolverFoco = false) => {
        setAbierto(false);
        if (devolverFoco) botonRef.current?.focus({ preventScroll: true });
    };
    const elegir = (iso) => {
        if (!iso || fuera(iso)) return;
        cerrar(true);
        if (iso !== valor) emitir(iso);
    };
    const borrar = () => { cerrar(true); if (valor) emitir(''); };
    const moverFoco = (iso) => { setFoco(iso); const f = leer(iso); setMes({ y: f.y, m: f.m }); };
    const moverVista = (n) => {
        if (vista === 'dias') {
            const dt = new Date(mes.y, mes.m + n, 1);
            setMes({ y: dt.getFullYear(), m: dt.getMonth() });
        } else setMes((p) => ({ y: p.y + n, m: p.m }));
    };

    // Abierto: se reubica con el scroll y el tamaño de la ventana; tocar afuera lo cierra.
    useEffect(() => {
        if (!abierto) return undefined;
        const reubicar = (e) => {
            if (e?.type === 'scroll' && popRef.current?.contains(e.target)) return;
            const p = calcularRef.current();
            if (p) setPos(p);
        };
        const afuera = (e) => {
            if (botonRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
            setAbierto(false);
        };
        window.addEventListener('resize', reubicar);
        window.addEventListener('scroll', reubicar, true);
        document.addEventListener('pointerdown', afuera, true);
        return () => {
            window.removeEventListener('resize', reubicar);
            window.removeEventListener('scroll', reubicar, true);
            document.removeEventListener('pointerdown', afuera, true);
        };
    }, [abierto]);

    useEffect(() => { if (abierto) popRef.current?.focus({ preventScroll: true }); }, [abierto]);
    useEffect(() => { if (disabled) setAbierto(false); }, [disabled]);

    const teclasBoton = (e) => {
        if (disabled || abierto) return;
        if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); abrir(); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && vaciable && valor) { e.preventDefault(); emitir(''); }
    };
    const teclasCalendario = (e) => {
        const k = e.key;
        if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); cerrar(true); return; }
        if (k === 'Tab') { e.preventDefault(); cerrar(true); return; }
        if (vista !== 'dias') return;
        const pasos = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (pasos[k] != null) { e.preventDefault(); e.stopPropagation(); moverFoco(sumarDias(foco, pasos[k])); }
        else if (k === 'PageUp' || k === 'PageDown') { e.preventDefault(); e.stopPropagation(); moverFoco(sumarMeses(foco, k === 'PageUp' ? -1 : 1)); }
        else if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); elegir(foco); }
    };

    const activo = resaltar && !!valor;
    const clases = [
        'flex items-center gap-2 border text-sm text-left outline-none transition-colors',
        'focus-visible:border-brand-cyan focus-visible:ring-2 focus-visible:ring-brand-cyan/15',
        'disabled:cursor-not-allowed disabled:opacity-60',
        filtro ? 'shrink-0 min-w-[132px] rounded-xl pl-3 pr-2.5 py-2 font-semibold' : 'w-full rounded-xl px-3 py-2.5',
        abierto ? 'border-brand-cyan ring-2 ring-brand-cyan/15' : activo ? 'border-brand-cyan/40 hover:border-brand-cyan/60' : 'border-zinc-200 hover:border-zinc-300',
        activo ? 'bg-brand-cyan/5 text-brand-cyan' : disabled ? 'bg-zinc-50 text-zinc-500' : filtro ? 'bg-white text-zinc-600' : 'bg-white text-zinc-800',
    ].join(' ');

    const seleccionado = leer(valor);
    const calendario = abierto && pos && createPortal(
        <div ref={popRef} role="dialog" aria-label="Elegir fecha" tabIndex={-1} onKeyDown={teclasCalendario}
            style={{ position: 'fixed', left: pos.left, width: pos.ancho, top: pos.top, bottom: pos.bottom }}
            className="z-[99990] rounded-xl border border-zinc-200 bg-white p-3 shadow-xl shadow-zinc-900/10 outline-none">
            <div className="mb-2 flex items-center justify-between">
                <button type="button" onClick={() => setVista((v) => (v === 'dias' ? 'meses' : 'dias'))} title={vista === 'dias' ? 'Elegir mes y año' : 'Volver a los días'}
                    className="rounded-lg px-2 py-1 text-sm font-black capitalize text-zinc-800 hover:bg-zinc-100">
                    {vista === 'dias' ? `${MESES[mes.m]} ${mes.y}` : mes.y}
                </button>
                <div className="flex items-center gap-1">
                    <button type="button" onClick={() => moverVista(-1)} aria-label={vista === 'dias' ? 'Mes anterior' : 'Año anterior'}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"><ChevronLeft size={16} /></button>
                    <button type="button" onClick={() => moverVista(1)} aria-label={vista === 'dias' ? 'Mes siguiente' : 'Año siguiente'}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100"><ChevronRight size={16} /></button>
                </div>
            </div>
            {vista === 'dias' ? (
                <>
                    <div className="mb-1 grid grid-cols-7">
                        {DIAS.map((d, i) => <div key={i} className="flex h-7 items-center justify-center text-[11px] font-black text-zinc-400">{d}</div>)}
                    </div>
                    <div className="grid grid-cols-7 gap-y-0.5">
                        {celdasDelMes(mes.y, mes.m).map((c) => {
                            const off = fuera(c.iso);
                            const clase = c.iso === valor ? 'bg-brand-cyan font-bold text-white'
                                : off ? 'cursor-not-allowed text-zinc-200'
                                : [c.iso === hoy ? 'font-bold text-brand-cyan ring-1 ring-inset ring-brand-cyan/40' : c.delMes ? 'text-zinc-700' : 'text-zinc-300',
                                    c.iso === foco ? 'bg-zinc-100' : 'hover:bg-zinc-100'].join(' ');
                            return (
                                <button key={c.iso} type="button" disabled={off} onClick={() => elegir(c.iso)} onMouseEnter={() => !off && setFoco(c.iso)}
                                    aria-label={mostrar(c.iso)} aria-pressed={c.iso === valor}
                                    className={`h-9 rounded-lg text-sm transition-colors ${clase}`}>{c.dia}</button>
                            );
                        })}
                    </div>
                </>
            ) : (
                <div className="grid grid-cols-3 gap-1.5">
                    {MESES.map((nombre, i) => {
                        const ultimo = new Date(mes.y, i + 1, 0).getDate();
                        const off = (!!min && aISO(mes.y, i, ultimo) < min) || (!!max && aISO(mes.y, i, 1) > max);
                        const sel = seleccionado && seleccionado.y === mes.y && seleccionado.m === i;
                        return (
                            <button key={nombre} type="button" disabled={off} onClick={() => { setMes({ y: mes.y, m: i }); setVista('dias'); }}
                                className={`rounded-lg py-2.5 text-sm capitalize transition-colors ${sel ? 'bg-brand-cyan font-bold text-white' : off ? 'cursor-not-allowed text-zinc-200' : 'text-zinc-700 hover:bg-zinc-100'}`}>
                                {nombre.slice(0, 3)}
                            </button>
                        );
                    })}
                </div>
            )}
            <div className="mt-2 flex items-center justify-between border-t border-zinc-100 pt-2">
                {vaciable && valor
                    ? <button type="button" onClick={borrar} className="rounded-lg px-2 py-1 text-xs font-bold text-zinc-400 hover:bg-red-50 hover:text-red-600">Borrar</button>
                    : <span />}
                <button type="button" onClick={() => elegir(hoy)} disabled={fuera(hoy)}
                    className="rounded-lg px-2 py-1 text-xs font-bold text-brand-cyan hover:bg-brand-cyan/10 disabled:cursor-not-allowed disabled:opacity-40">Hoy</button>
            </div>
        </div>,
        document.body,
    );

    return (
        <>
            <button ref={botonRef} type="button" id={id} name={name} title={title} disabled={disabled}
                aria-haspopup="dialog" aria-expanded={abierto} aria-label={ariaLabel || (valor ? mostrar(valor) : placeholder)}
                onClick={() => (abierto ? cerrar() : abrir())} onKeyDown={teclasBoton}
                className={`${clases} ${className}`}>
                <span className={`min-w-0 flex-1 truncate ${valor ? '' : 'text-zinc-400'}`}>{valor ? mostrar(valor) : placeholder}</span>
                <CalendarDays size={16} className={`shrink-0 ${activo || abierto ? 'text-brand-cyan' : 'text-zinc-400'}`} />
            </button>
            {calendario}
        </>
    );
};

export default SelectorFecha;
