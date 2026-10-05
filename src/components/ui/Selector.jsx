import { useState, useRef, useEffect, useId, Children, isValidElement, Fragment } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check, Search } from 'lucide-react';

// Select con estilo propio (la lista de un <select> nativo no se puede estilizar). Se usa como un <select>:
//
//   <Selector value={v} onChange={(e) => setV(e.target.value)}>
//       <option value="">Todos</option>
//       <optgroup label="Grupo">{lista.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</optgroup>
//   </Selector>
//
// Los <option> no se dibujan: se leen sus props (value, children, disabled y, opcional, `descripcion`: una
// segunda línea en gris). El valor vuelve siempre como texto, igual que en el nativo, y onChange solo se
// llama si cambia. Con más de 8 opciones aparece un buscador (buscar={true|false} lo fuerza). La lista va
// en un portal: no la cortan los paneles ni las ventanas con scroll. Va en z-[99990], arriba de cualquier
// panel o ventana (navbar 5010, modales hasta 9999) y abajo de los avisos de sonner (99999).
//   filtro      → botón compacto para barras de filtros; se resalta cuando no está en la primera opción.
//   claseBoton  → reemplaza el estilo del botón; renderValor(opcion) → lo que muestra el botón;
//   sinFlecha   → sin la flecha (botones que son solo un ícono).
//   altoMax     → alto máximo de la lista (320 px si no se pasa). Más alto, para que entren todas las opciones sin
//                 scroll; igual nunca pasa el lugar que hay en la pantalla.

const ALTO_MAX = 320;

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Texto plano de un contenido (para el buscador y para tipear con la lista abierta).
const textoDe = (nodo) => {
    if (nodo == null || typeof nodo === 'boolean') return '';
    if (typeof nodo === 'string' || typeof nodo === 'number') return String(nodo);
    if (Array.isArray(nodo)) return nodo.map(textoDe).join('');
    if (isValidElement(nodo)) return textoDe(nodo.props.children);
    return '';
};

// <option> / <optgroup> / fragmentos → lista plana de grupos y opciones (gid = grupo de la opción).
const leerOpciones = (hijos, gid = null, salida = []) => {
    Children.forEach(hijos, (h) => {
        if (!isValidElement(h)) return;
        if (h.type === Fragment) { leerOpciones(h.props.children, gid, salida); return; }
        if (h.type === 'optgroup') {
            const id = salida.length;
            salida.push({ tipo: 'grupo', gid: id, label: h.props.label });
            leerOpciones(h.props.children, id, salida);
            return;
        }
        if (h.type === 'option') {
            const texto = textoDe(h.props.children);
            salida.push({
                tipo: 'opcion', gid, value: h.props.value == null ? texto : String(h.props.value),
                contenido: h.props.children, texto, descripcion: h.props.descripcion, disabled: !!h.props.disabled,
            });
        }
    });
    return salida;
};

const Selector = ({
    value, onChange, children, disabled = false, name, id, title, 'aria-label': ariaLabel,
    filtro = false, resaltar = filtro, buscar, className = '', claseBoton, renderValor, anchoLista = 220, sinFlecha = false,
    altoMax = ALTO_MAX,
}) => {
    const items = leerOpciones(children);
    const opciones = items.filter(i => i.tipo === 'opcion');
    const valor = String(value ?? '');
    // Como el nativo: si el valor no está entre las opciones, se muestra la primera.
    const actual = opciones.find(o => o.value === valor) || opciones[0] || null;
    const conBuscador = buscar ?? opciones.length > 8;

    const [abierto, setAbierto] = useState(false);
    const [pos, setPos] = useState(null);
    const [q, setQ] = useState('');
    const [resaltado, setResaltado] = useState(null);
    const botonRef = useRef(null);
    const listaRef = useRef(null);
    const scrollRef = useRef(null);
    const buscadorRef = useRef(null);
    const tipeo = useRef({ texto: '', hasta: 0 });
    const idLista = useId();

    // Lo visible según el buscador (cada palabra, en cualquier orden); los títulos de grupo solo si les
    // queda alguna opción.
    const palabras = normalizar(q).split(/\s+/).filter(Boolean);
    const visibles = [];
    let grupoPendiente = null;
    items.forEach((it) => {
        if (it.tipo === 'grupo') { grupoPendiente = it; return; }
        if (palabras.length) {
            const texto = normalizar(`${it.texto} ${it.descripcion || ''}`);
            if (!palabras.every(p => texto.includes(p))) return;
        }
        if (it.gid != null && grupoPendiente?.gid === it.gid) { visibles.push(grupoPendiente); grupoPendiente = null; }
        visibles.push(it);
    });
    const navegables = visibles.filter(i => i.tipo === 'opcion' && !i.disabled);
    const resaltadoEfectivo = navegables.some(o => o.value === resaltado) ? resaltado : (navegables[0]?.value ?? null);

    const calcularPos = () => {
        const b = botonRef.current;
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const ancho = Math.min(Math.max(r.width, anchoLista), vw - 16);
        const left = Math.max(8, Math.min(r.left, vw - ancho - 8));
        const abajo = vh - r.bottom - 8;
        const arriba = r.top - 8;
        const deseado = Math.min(altoMax, items.length * 38 + (conBuscador ? 60 : 12));
        const haciaArriba = abajo < deseado && arriba > abajo;
        const alto = Math.max(140, Math.min(altoMax, (haciaArriba ? arriba : abajo) - 4));
        return haciaArriba ? { left, ancho, alto, bottom: vh - r.top + 4 } : { left, ancho, alto, top: r.bottom + 4 };
    };
    const calcularRef = useRef(calcularPos);
    calcularRef.current = calcularPos;

    const porTipeo = (tecla) => {
        const t = tipeo.current;
        const ahora = Date.now();
        t.texto = ahora < t.hasta ? t.texto + tecla : tecla;
        t.hasta = ahora + 800;
        const buscado = normalizar(t.texto);
        return opciones.find(o => !o.disabled && normalizar(o.texto).replace(/^[^a-z0-9]+/, '').startsWith(buscado));
    };

    const abrir = (tecla) => {
        if (disabled) return;
        const p = calcularPos();
        if (!p) return;
        let r = actual && !actual.disabled ? actual.value : (opciones.find(o => !o.disabled)?.value ?? null);
        if (tecla && !conBuscador) r = porTipeo(tecla)?.value ?? r;
        setPos(p);
        setQ(conBuscador && tecla ? tecla : '');
        setResaltado(r);
        setAbierto(true);
    };
    const cerrar = (devolverFoco = false) => {
        setAbierto(false);
        if (devolverFoco) botonRef.current?.focus({ preventScroll: true });
    };
    const elegir = (o) => {
        if (!o || o.disabled) return;
        cerrar(true);
        if (o.value !== valor) onChange?.({ target: { value: o.value, name }, currentTarget: { value: o.value, name } });
    };
    const mover = (paso) => {
        if (!navegables.length) return;
        const i = navegables.findIndex(o => o.value === resaltadoEfectivo);
        const n = i < 0 ? (paso > 0 ? 0 : navegables.length - 1) : Math.max(0, Math.min(navegables.length - 1, i + paso));
        setResaltado(navegables[n].value);
    };

    // Abierta: se reubica con el scroll y el tamaño de la ventana (esos eventos ya llegan uno por cuadro);
    // tocar afuera la cierra.
    useEffect(() => {
        if (!abierto) return undefined;
        const reubicar = (e) => {
            if (e?.type === 'scroll' && listaRef.current?.contains(e.target)) return;
            const p = calcularRef.current();
            if (p) setPos(p);
        };
        const afuera = (e) => {
            if (botonRef.current?.contains(e.target) || listaRef.current?.contains(e.target)) return;
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

    // Al abrir: foco al buscador (en pantallas táctiles no, para que no salte el teclado) o a la lista.
    useEffect(() => {
        if (!abierto) return;
        const tactil = window.matchMedia?.('(pointer: coarse)').matches;
        const b = buscadorRef.current;
        if (b && !tactil) {
            b.focus({ preventScroll: true });
            b.setSelectionRange(b.value.length, b.value.length);
        } else listaRef.current?.focus({ preventScroll: true });
    }, [abierto]);

    // La opción resaltada, siempre a la vista dentro de la lista.
    useEffect(() => {
        if (!abierto || resaltadoEfectivo == null) return;
        const cont = scrollRef.current;
        const i = visibles.findIndex(v => v.tipo === 'opcion' && v.value === resaltadoEfectivo);
        const el = cont?.querySelector(`[data-i="${i}"]`);
        if (!el) return;
        if (el.offsetTop < cont.scrollTop) cont.scrollTop = el.offsetTop - 4;
        else if (el.offsetTop + el.offsetHeight > cont.scrollTop + cont.clientHeight) cont.scrollTop = el.offsetTop + el.offsetHeight - cont.clientHeight + 4;
    }, [abierto, resaltadoEfectivo, q]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => { if (disabled) setAbierto(false); }, [disabled]);

    const teclasBoton = (e) => {
        if (disabled || abierto) return;
        const k = e.key;
        if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); abrir(); }
        else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); abrir(k); }
    };
    const teclasLista = (e) => {
        const k = e.key;
        const enBuscador = e.target === buscadorRef.current;
        if (['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'].includes(k)) {
            e.preventDefault(); e.stopPropagation();
            mover({ ArrowDown: 1, ArrowUp: -1, PageDown: 8, PageUp: -8 }[k]);
        } else if ((k === 'Home' || k === 'End') && !enBuscador) {
            e.preventDefault(); e.stopPropagation();
            setResaltado((k === 'Home' ? navegables[0] : navegables[navegables.length - 1])?.value ?? null);
        } else if (k === 'Enter' || (k === ' ' && !enBuscador)) {
            e.preventDefault(); e.stopPropagation();
            elegir(navegables.find(o => o.value === resaltadoEfectivo));
        } else if (k === 'Escape') {
            e.preventDefault(); e.stopPropagation();
            cerrar(true);
        } else if (k === 'Tab') {
            e.preventDefault();
            cerrar(true);
        } else if (!enBuscador && k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const o = porTipeo(k);
            if (o) setResaltado(o.value);
        }
    };

    const activo = resaltar && !!actual && !!opciones[0] && actual.value !== opciones[0].value;
    const vacio = !filtro && !claseBoton && actual?.value === '';
    const clases = claseBoton ?? [
        'flex items-center gap-2 border text-sm text-left outline-none transition-colors',
        'focus-visible:border-brand-cyan focus-visible:ring-2 focus-visible:ring-brand-cyan/15',
        'disabled:cursor-not-allowed disabled:opacity-60',
        filtro ? 'shrink-0 max-w-full sm:max-w-[260px] rounded-xl pl-3 pr-2.5 py-2 font-semibold' : 'w-full rounded-xl px-3 py-2.5',
        abierto ? 'border-brand-cyan ring-2 ring-brand-cyan/15' : activo ? 'border-brand-cyan/40 hover:border-brand-cyan/60' : 'border-zinc-200 hover:border-zinc-300',
        activo ? 'bg-brand-cyan/5 text-brand-cyan' : disabled ? 'bg-zinc-50 text-zinc-500' : filtro ? 'bg-white text-zinc-600' : 'bg-white text-zinc-800',
    ].join(' ');

    // Filas de la lista: títulos de grupo, una línea antes de las opciones sueltas que siguen a un grupo.
    const filas = [];
    let gidAnterior = null;
    visibles.forEach((it, i) => {
        if (it.tipo === 'grupo') {
            filas.push(<div key={`g${i}`} className={`px-2.5 pb-1 text-[10px] font-black uppercase tracking-wide text-zinc-400 ${filas.length ? 'pt-3' : 'pt-1.5'}`}>{it.label}</div>);
            gidAnterior = it.gid;
            return;
        }
        if (it.gid == null && gidAnterior != null) filas.push(<div key={`s${i}`} className="mx-1 my-1 border-t border-zinc-100" />);
        gidAnterior = it.gid;
        const elegida = it.value === actual?.value;
        const marcada = !it.disabled && it.value === resaltadoEfectivo;
        filas.push(
            <div key={`o${i}`} data-i={i} role="option" aria-selected={elegida} aria-disabled={it.disabled || undefined}
                onMouseMove={() => { if (!it.disabled && resaltado !== it.value) setResaltado(it.value); }}
                onClick={() => elegir(it)}
                className={`flex items-start gap-2 rounded-lg px-2.5 py-2 text-sm select-none
                    ${it.disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
                    ${marcada ? 'bg-zinc-100' : ''}
                    ${elegida ? 'font-bold text-brand-cyan' : 'text-zinc-700'}`}>
                <span className="min-w-0 flex-1 break-words">
                    {it.contenido}
                    {it.descripcion && <span className="block text-xs font-normal text-zinc-400">{it.descripcion}</span>}
                </span>
                {elegida && <Check size={15} className="mt-0.5 shrink-0" />}
            </div>,
        );
    });

    return (
        <>
            <button ref={botonRef} type="button" id={id} name={name} title={title} disabled={disabled}
                role="combobox" aria-haspopup="listbox" aria-expanded={abierto} aria-controls={abierto ? idLista : undefined} aria-label={ariaLabel}
                onClick={() => (abierto ? cerrar() : abrir())} onKeyDown={teclasBoton}
                className={`${clases} ${className}`}>
                <span className={`min-w-0 flex-1 truncate ${vacio ? 'text-zinc-400' : ''}`}>
                    {renderValor ? renderValor(actual) : actual ? actual.contenido : ' '}
                </span>
                {!sinFlecha && <ChevronDown size={16} className={`shrink-0 transition-transform duration-150 ${abierto ? 'rotate-180' : ''} ${activo || abierto ? 'text-brand-cyan' : 'text-zinc-400'}`} />}
            </button>
            {abierto && pos && createPortal(
                <div ref={listaRef} id={idLista} role="listbox" tabIndex={-1} onKeyDown={teclasLista}
                    style={{ position: 'fixed', left: pos.left, width: pos.ancho, maxHeight: pos.alto, top: pos.top, bottom: pos.bottom }}
                    className="z-[99990] flex flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl shadow-zinc-900/10 outline-none">
                    {conBuscador && (
                        <div className="shrink-0 border-b border-zinc-100 p-2">
                            <div className="relative">
                                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400" />
                                <input ref={buscadorRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…"
                                    className="w-full rounded-lg border border-zinc-200 bg-zinc-50 py-1.5 pl-8 pr-2 text-sm text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-brand-cyan focus:bg-white" />
                            </div>
                        </div>
                    )}
                    <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
                        {filas}
                        {navegables.length === 0 && <div className="px-3 py-4 text-center text-sm text-zinc-400">Sin resultados</div>}
                    </div>
                </div>,
                document.body,
            )}
        </>
    );
};

export default Selector;
