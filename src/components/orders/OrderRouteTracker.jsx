import React, { useId, useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { Ban, CircleCheck, CircleDashed, Cog, Pause, Route, Truck } from 'lucide-react';

/**
 * OrderRouteTracker — hoja de ruta del pedido (qué áreas recorre y en qué estado está cada una).
 *
 * Rediseño 23/10/2026 (estética nueva). Antes, en los pedidos con ramas (DTF y TPU que van a
 * Estampado mientras la prenda pasa por Sublimación → Corte → Costura → Bordado) las ramas se
 * dibujaban en la primera columna y sus flechas cruzaban toda la pantalla, y en los combos
 * Producción aparecía dos veces (al principio y al final). Ahora:
 *  - FILA PRINCIPAL: el camino más largo del pedido, en una línea recta.
 *  - RAMAS: en filas arriba y abajo, en la columna justo antes del paso al que llegan (DTF y
 *    TPU quedan al lado de Estampado), así las flechas son cortas y no cruzan nada.
 *  - Cada área aparece UNA vez, en el lugar que le da el ProximoServicio real de sus órdenes.
 *  - Sin datos de flujo (respuestas sin nextAreas) o con un ciclo: una fila en el orden que
 *    mandó el backend, unida paso a paso, como siempre.
 * Lo usan la Búsqueda integral, el detalle de la orden (OrderDetailModal) y la bandeja de PRO.
 * Respaldo del diseño anterior: scratchpad de la sesión, integral/OrderRouteTracker.antes.jsx.
 */

// [PRENDAS] El backend manda el código de área (TWC, TWT...) tal cual, sin nombre legible —
// se traduce acá. Mismo mapeo que ya usa PrendaOrderForm.jsx para EMB/DF/TPU/TWC/TWT.
// Exportado: es la misma fuente de verdad que usa la lista de reordenar Costura/Bordado/
// Estampado en OrderDetailModal.jsx — nunca mostrar el código ahí tampoco.
export const AREA_NAMES = {
    SB: 'Sublimación',
    // DF y TPU IMPRIMEN el transfer; estamparlo en la prenda es otra área (EST = 'Estampado')
    DF: 'Impresión DTF',
    TPU: 'Impresión TPU',
    EMB: 'Bordado',
    TWC: 'Corte',
    TWT: 'Costura',
    EST: 'Estampado',
    PRO: 'Producción',
    DEPOSITO: 'Depósito',
};

const getAreaName = (s) => {
    if (!s) return '???';
    const raw = s.Nombre || s.nombre || s.AreaNombre || s.AreaID || s.area || s.id || '???';
    return AREA_NAMES[raw.toString().trim().toUpperCase()] || raw;
};
const getStatus = (s) => (s && (s.Estado || s.estado || s.status)) || 'Pendiente';
const getDetail = (s) => s.EstadoenArea || s.estadoenArea || s.estadoArea || '-';

// "PENDIENTE A RECIBIR" / "En transito" → "Pendiente a recibir" / "En transito": todos igual.
const comoFrase = (t) => {
    const s = String(t || '').trim().toLowerCase();
    return s ? s[0].toUpperCase() + s.slice(1) : s;
};

// Tono de un estado (de un paso o de una orden). Exportado para que la Búsqueda integral pinte
// los estados de sus órdenes con los mismos colores que la hoja de ruta.
// [PRENDAS] "Recibido en Destino"/"Ingresado"/"Avisado": la orden ya se entregó del todo en esa
// área (su bulto se confirmó en la siguiente, o el cliente ya fue avisado) — cuenta como lista.
// "En tránsito" queda afuera a propósito: todavía está viajando.
export const tonoDeEstado = (estado) => {
    const st = String(estado || '').toUpperCase();
    if (['PRONTO', 'FINALIZAD', 'COMPLETADO', 'TERMINADO', 'RECIBIDO EN DESTINO', 'INGRESADO', 'ENTREGAD', 'AVISADO'].some(k => st.includes(k))) return 'listo';
    if (st.includes('CANCEL')) return 'cancelado';
    if (st === '' || st.startsWith('PENDIENTE')) return 'pendiente';
    if (st.includes('RETEN')) return 'retenido';
    if (st.includes('TRANSITO') || st.includes('TRÁNSITO')) return 'transito';
    return 'activo';
};

// El color va en lo que significa algo: listo (verde), en curso (brand-cyan), retenido (ámbar),
// cancelado (magenta). Pendiente queda neutro.
const ESTILO = {
    listo: { Icono: CircleCheck, card: 'border-emerald-200', icono: 'text-emerald-600', texto: 'text-emerald-700' },
    activo: { Icono: Cog, card: 'border-brand-cyan ring-2 ring-brand-cyan/10', icono: 'text-brand-cyan', texto: 'text-brand-cyan' },
    transito: { Icono: Truck, card: 'border-brand-cyan ring-2 ring-brand-cyan/10', icono: 'text-brand-cyan', texto: 'text-brand-cyan' },
    retenido: { Icono: Pause, card: 'border-amber-300 ring-2 ring-amber-100', icono: 'text-amber-600', texto: 'text-amber-700' },
    cancelado: { Icono: Ban, card: 'border-brand-magenta/30', icono: 'text-brand-magenta', texto: 'text-brand-magenta' },
    pendiente: { Icono: CircleDashed, card: 'border-zinc-200', icono: 'text-zinc-300', texto: 'text-zinc-500' },
};

// Chips de estado para listas (órdenes del pedido): mismos tonos que los pasos.
export const CHIP_TONO = {
    listo: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    activo: 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20',
    transito: 'bg-brand-cyan/5 text-brand-cyan border-brand-cyan/20',
    retenido: 'bg-amber-50 text-amber-700 border-amber-200',
    cancelado: 'bg-brand-magenta/5 text-brand-magenta border-brand-magenta/20',
    pendiente: 'bg-zinc-50 text-zinc-500 border-zinc-200',
};

const pasoVisual = (step) => ({
    areaName: getAreaName(step),
    status: comoFrase(getStatus(step)),
    tono: tonoDeEstado(getStatus(step)),
    detail: getDetail(step),
    logistic: step.EstadoLogistica || step.estadoLogistica || '-',
    count: Number(step.count) || 0,
    // [PRENDAS] Órdenes de falla/reposición ("-F#"/"-R#") detrás del estado del paso: sin esto una
    // reposición encadenada quedaba invisible. fallaCantidad = Reposiciones.Cantidad;
    // fallaPendiente = alguna sigue abierta (magenta) o ya cerraron todas (verde).
    fallaCount: Number(step.fallaCount) || 0,
    fallaCantidad: step.fallaCantidad != null ? Number(step.fallaCantidad) : null,
    fallaPendiente: !!step.fallaPendiente,
});

const numeroCorto = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

const FallaChip = ({ count, cantidad, pendiente }) => {
    if (!count) return null;
    const texto = `${count} ${count === 1 ? 'falla' : 'fallas'}${cantidad != null ? ` · ${numeroCorto(cantidad)}` : ''}`;
    return (
        <span
            title={`${count} orden(es) de falla/reposición en este paso · ${pendiente ? 'pendiente' : 'cerrada'}`}
            className={`mt-1.5 self-start text-[10px] font-bold px-2 py-0.5 rounded-full border ${pendiente
                ? 'bg-brand-magenta/5 text-brand-magenta border-brand-magenta/20'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}
        >
            {texto} · {pendiente ? 'pendiente' : 'cerrada'}
        </span>
    );
};

// Componente de módulo (no se redefine en cada render): los refs para medir las flechas quedan
// estables entre renders y el efecto de medición no entra en loop.
const PasoCard = React.forwardRef(({ step, style }, ref) => {
    const v = pasoVisual(step);
    const e = ESTILO[v.tono];
    const Icono = e.Icono;
    return (
        // justify-center: en el grafo todas las tarjetas tienen el alto de la más alta, y el contenido
        // va centrado, igual que las flechas, que entran y salen por la mitad de la tarjeta.
        <div ref={ref} style={style}
            className={`relative z-[1] w-[168px] flex flex-col justify-center rounded-xl border bg-white px-3 py-2.5 ${e.card}`}>
            <div className="flex items-center gap-1.5 min-w-0">
                <span className="shrink-0 inline-flex"><Icono size={15} className={e.icono} aria-hidden="true" /></span>
                <span className="text-[11px] font-black uppercase tracking-tight text-zinc-800 truncate" title={v.areaName}>{v.areaName}</span>
                {v.count > 1 && (
                    <span className="ml-auto shrink-0 text-[10px] font-bold text-zinc-400 tabular-nums" title={`${v.count} órdenes en esta área`}>×{v.count}</span>
                )}
            </div>
            <div className={`mt-1 text-[11px] font-bold truncate ${e.texto}`} title={v.status}>{v.status}</div>
            {v.detail !== '-' && <div className="text-[10px] text-zinc-500 truncate" title={v.detail}>{v.detail}</div>}
            {v.logistic !== '-' && (
                <div className="text-[10px] font-bold text-brand-cyan truncate inline-flex items-center gap-1" title={v.logistic}>
                    <Truck size={10} className="shrink-0" aria-hidden="true" />{v.logistic}
                </div>
            )}
            <FallaChip count={v.fallaCount} cantidad={v.fallaCantidad} pendiente={v.fallaPendiente} />
        </div>
    );
});

// Códigos de área del pedido en el orden del recorrido (columna, y dentro de la columna de arriba a
// abajo; el mismo orden que la lista del celular). Lo usa el filtro por área de la Búsqueda integral.
export const ordenRecorrido = (steps) => {
    const pasos = Array.isArray(steps) ? steps : [];
    const d = armarDisposicion(pasos);
    const filaIndex = new Map(d.filas.map((f, k) => [f, k]));
    return [...d.nodos]
        .sort((x, y) => x.col - y.col || filaIndex.get(x.fila) - filaIndex.get(y.fila))
        .map(x => (pasos[x.i].id || pasos[x.i].AreaID || '').toString().trim().toUpperCase());
};

// Disposición: { nodos: [{ i, col, fila }], aristas: [[i, j]], columnas, filas: [valores de fila en orden] }.
function armarDisposicion(pasos) {
    const n = pasos.length;
    const enFila = (orden) => ({
        nodos: orden.map((i, c) => ({ i, col: c, fila: 0 })),
        aristas: orden.slice(1).map((j, k) => [orden[k], j]),
        columnas: orden.length,
        filas: [0],
    });
    if (n === 0) return enFila([]);

    const ids = pasos.map(s => (s.id || s.AreaID || getAreaName(s) || '').toString().trim().toUpperCase());
    const indice = new Map(ids.map((u, i) => [u, i]));
    const suc = pasos.map(() => []);
    const pre = pasos.map(() => []);
    const aristas = [];
    pasos.forEach((s, i) => {
        const nexts = Array.isArray(s.nextAreas) ? s.nextAreas : (s.nextArea ? [s.nextArea] : []);
        nexts.forEach(nx => {
            const j = indice.get((nx || '').toString().trim().toUpperCase());
            if (j !== undefined && j !== i && !suc[i].includes(j)) { suc[i].push(j); pre[j].push(i); aristas.push([i, j]); }
        });
    });

    // Orden topológico; las raíces en el orden en que las mandó el backend.
    const grado = pre.map(p => p.length);
    const cola = [];
    grado.forEach((g, i) => { if (g === 0) cola.push(i); });
    const topo = [];
    while (cola.length) {
        const i = cola.shift();
        topo.push(i);
        suc[i].forEach(j => { if (--grado[j] === 0) cola.push(j); });
    }
    // Sin datos de flujo, o un ciclo (datos inconsistentes): una fila en el orden crudo.
    if (aristas.length === 0 || topo.length < n) return enFila(pasos.map((_, i) => i));
    const posTopo = new Map(topo.map((i, k) => [i, k]));

    // Fila principal = el camino más largo (en cantidad de pasos). Empate: el que llegó primero.
    const largo = new Array(n).fill(1);
    const siguiente = new Array(n).fill(-1);
    for (let k = topo.length - 1; k >= 0; k--) {
        const i = topo[k];
        suc[i].forEach(j => { if (largo[j] + 1 > largo[i]) { largo[i] = largo[j] + 1; siguiente[i] = j; } });
    }
    let inicio = -1;
    topo.forEach(i => { if (pre[i].length === 0 && (inicio === -1 || largo[i] > largo[inicio])) inicio = i; });
    const principal = [];
    for (let i = inicio; i !== -1; i = siguiente[i]) principal.push(i);
    const enPrincipal = new Set(principal);

    // Columnas: la principal, una por paso. Las ramas, lo más tarde posible: justo antes del primer
    // paso al que llegan. Una rama sin sucesor va donde la deja su camino desde el inicio.
    const col = new Array(n).fill(-1);
    principal.forEach((i, c) => { col[i] = c; });
    const temprano = new Array(n).fill(0);
    topo.forEach(i => suc[i].forEach(j => { temprano[j] = Math.max(temprano[j], temprano[i] + 1); }));
    for (let k = topo.length - 1; k >= 0; k--) {
        const i = topo[k];
        if (enPrincipal.has(i)) continue;
        const cs = suc[i].map(j => col[j]).filter(c => c >= 0);
        col[i] = cs.length ? Math.min(...cs) - 1 : temprano[i];
    }
    const minCol = Math.min(...col);
    if (minCol < 0) for (let i = 0; i < n; i++) col[i] -= minCol;

    // Filas: cada rama (una cadena de pasos seguidos fuera de la principal) va en su propia fila,
    // alternando arriba y abajo de la principal. Solo un antecesor hereda la fila de su sucesor,
    // así dos ramas que llegan al mismo paso no se pisan.
    const cadena = new Array(n).fill(-1);
    const heredado = new Set();
    let nCadenas = 0;
    for (let k = topo.length - 1; k >= 0; k--) {
        const i = topo[k];
        if (enPrincipal.has(i)) continue;
        const s = suc[i].find(j => !enPrincipal.has(j) && !heredado.has(j) && col[j] === col[i] + 1);
        if (s !== undefined) { cadena[i] = cadena[s]; heredado.add(s); } else cadena[i] = nCadenas++;
    }
    const arranque = new Array(nCadenas).fill(Infinity);
    for (let i = 0; i < n; i++) if (cadena[i] >= 0) arranque[cadena[i]] = Math.min(arranque[cadena[i]], posTopo.get(i));
    const filaDeCadena = new Array(nCadenas);
    [...Array(nCadenas).keys()].sort((a, b) => arranque[a] - arranque[b])
        .forEach((c, k) => { filaDeCadena[c] = k % 2 === 0 ? -(k / 2 + 1) : (k + 1) / 2; });

    const nodos = pasos.map((_, i) => ({ i, col: col[i], fila: enPrincipal.has(i) ? 0 : filaDeCadena[cadena[i]] }));
    const filas = [...new Set(nodos.map(x => x.fila))].sort((a, b) => a - b);
    return { nodos, aristas, columnas: Math.max(...col) + 1, filas };
}

// Distancia del punto donde se juntan (o se abren) las flechas al borde de la tarjeta.
const UNION = 16;

// En el celular el grafo no entra: las ramas quedaban fuera de la pantalla y dejaban huecos.
const MQ_ANGOSTO = '(max-width: 639px)';
const useAngosto = () => {
    const [angosto, setAngosto] = useState(() => typeof window !== 'undefined' && window.matchMedia(MQ_ANGOSTO).matches);
    useEffect(() => {
        const mq = window.matchMedia(MQ_ANGOSTO);
        const alCambiar = () => setAngosto(mq.matches);
        mq.addEventListener('change', alCambiar);
        return () => mq.removeEventListener('change', alCambiar);
    }, []);
    return angosto;
};

const OrderRouteTracker = ({ steps = [], title = 'Hoja de ruta' }) => {
    // Memoizado sobre `steps`: un array nuevo en cada render recalcularía la disposición, eso
    // volvería a medir las flechas, re-renderizaría y entraría en loop.
    const pasos = useMemo(() => (Array.isArray(steps) ? [...steps] : []), [steps]);
    const disp = useMemo(() => armarDisposicion(pasos), [pasos]);
    const marcador = `ort-${useId().replace(/:/g, '')}`;
    const angosto = useAngosto();

    const listos = pasos.filter(s => tonoDeEstado(getStatus(s)) === 'listo').length;

    // Las flechas se miden en el DOM (no se adivinan coordenadas). Salen y entran por la mitad de
    // cada tarjeta. Cuando a un paso le llegan varias (DTF, Bordado y TPU a Estampado), se juntan en
    // un punto un poco antes y entra UNA sola flecha; lo mismo al salir de un paso hacia varios.
    const gridRef = useRef(null);
    const nodoRefs = useRef(new Map());
    const [trazos, setTrazos] = useState([]);

    const medir = useCallback(() => {
        const grid = gridRef.current;
        if (!grid) { setTrazos(t => (t.length ? [] : t)); return; }
        const g = grid.getBoundingClientRect();
        const caja = new Map();
        nodoRefs.current.forEach((el, i) => {
            const r = el.getBoundingClientRect();
            caja.set(i, { l: r.left - g.left, r: r.right - g.left, y: r.top - g.top + r.height / 2 });
        });
        const entran = new Map();
        const salen = new Map();
        disp.aristas.forEach(([a, b]) => {
            entran.set(b, (entran.get(b) || 0) + 1);
            salen.set(a, (salen.get(a) || 0) + 1);
        });
        const listo = (i) => tonoDeEstado(getStatus(pasos[i])) === 'listo';
        const tramo = (x1, y1, x2, y2) => {
            if (Math.abs(y1 - y2) < 1) return `M ${x1} ${y1} L ${x2} ${y2}`;
            const dx = (x2 - x1) / 2;
            return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
        };
        const lineas = [];
        const flechas = [];
        disp.aristas.forEach(([a, b]) => {
            const A = caja.get(a);
            const B = caja.get(b);
            if (!A || !B) return;
            const x1 = salen.get(a) > 1 ? A.r + UNION : A.r;
            const junta = entran.get(b) > 1;
            const d = tramo(x1, A.y, junta ? B.l - UNION : B.l - 2, B.y);
            (junta ? lineas : flechas).push({ key: `${a}-${b}`, d, listo: listo(a), flecha: !junta });
        });
        salen.forEach((n, a) => {
            const A = caja.get(a);
            if (n > 1 && A) lineas.push({ key: `s${a}`, d: `M ${A.r} ${A.y} L ${A.r + UNION} ${A.y}`, listo: listo(a), flecha: false });
        });
        entran.forEach((n, b) => {
            const B = caja.get(b);
            if (n < 2 || !B) return;
            const todasListas = disp.aristas.filter(([, y]) => y === b).every(([x]) => listo(x));
            flechas.push({ key: `e${b}`, d: `M ${B.l - UNION} ${B.y} L ${B.l - 2} ${B.y}`, listo: todasListas, flecha: true });
        });
        setTrazos([...lineas, ...flechas]); // las flechas al final: quedan arriba de las líneas
    }, [disp, pasos]);

    useLayoutEffect(() => {
        medir();
        if (!gridRef.current) return;
        const ro = new ResizeObserver(() => medir());
        ro.observe(gridRef.current);
        return () => ro.disconnect();
    }, [medir, angosto]);

    const filaIndex = new Map(disp.filas.map((f, k) => [f, k]));

    // Celular: lista vertical en el orden del recorrido (columna, y dentro de la columna de arriba
    // a abajo). Las ramas dicen a qué paso llegan, porque ahí no hay flechas que lo muestren.
    const enLista = useMemo(() => {
        if (!angosto) return [];
        const sucesores = new Map();
        disp.aristas.forEach(([a, b]) => { if (!sucesores.has(a)) sucesores.set(a, []); sucesores.get(a).push(b); });
        return [...disp.nodos]
            .sort((x, y) => x.col - y.col || filaIndex.get(x.fila) - filaIndex.get(y.fila))
            .map(x => ({ ...x, llegaA: x.fila !== 0 ? (sucesores.get(x.i) || []).map(j => getAreaName(pasos[j])) : [] }));
    }, [angosto, disp, pasos]);

    return (
        <div className="bg-white rounded-2xl border border-zinc-200 p-4 md:p-5 flex flex-col gap-4 w-full">
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-black uppercase tracking-wide text-zinc-800 flex items-center gap-2">
                    <Route size={18} className="text-brand-cyan" aria-hidden="true" />
                    {title}
                </h3>
                {pasos.length > 0 && (
                    <span className="text-xs font-bold text-zinc-400 tabular-nums">{listos} de {pasos.length} áreas listas</span>
                )}
            </div>

            {pasos.length === 0 ? (
                <p className="text-sm text-zinc-400 py-6 text-center">Sin áreas para mostrar.</p>
            ) : angosto ? (
                <ol className="flex flex-col gap-2">
                    {enLista.map(({ i, llegaA }) => (
                        <li key={i} className="flex flex-col gap-1">
                            {llegaA.length > 0 && (
                                <span className="text-[10px] font-bold uppercase tracking-wide text-zinc-400">Rama · llega a {llegaA.join(' y ')}</span>
                            )}
                            <PasoCard step={pasos[i]} style={{ width: '100%' }} />
                        </li>
                    ))}
                </ol>
            ) : (
                <div className="overflow-x-auto pb-1">
                    <div
                        ref={gridRef}
                        className="relative grid mx-auto w-max py-1"
                        style={{
                            gridTemplateColumns: `repeat(${disp.columnas}, 168px)`,
                            gridAutoRows: '1fr', // todas las filas (y con stretch, todas las tarjetas) del mismo alto
                            columnGap: 56,
                            rowGap: 16,
                            alignItems: 'stretch',
                        }}
                    >
                        <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible" style={{ zIndex: 0 }} aria-hidden="true">
                            <defs>
                                {/* Punta chica en píxeles reales (userSpaceOnUse): no crece con el grosor de la línea */}
                                {['gris', 'verde'].map(c => (
                                    <marker key={c} id={`${marcador}-${c}`} viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
                                        <path d="M 0.5 0.75 L 7.5 4 L 0.5 7.25 z" fill={c === 'verde' ? '#34d399' : '#a1a1aa'} />
                                    </marker>
                                ))}
                            </defs>
                            {trazos.map(t => (
                                <path key={t.key} d={t.d} fill="none"
                                    stroke={t.listo ? '#6ee7b7' : '#d4d4d8'} strokeWidth="1.5" strokeLinecap="round"
                                    markerEnd={t.flecha ? `url(#${marcador}-${t.listo ? 'verde' : 'gris'})` : undefined} />
                            ))}
                        </svg>
                        {disp.nodos.map(({ i, col, fila }) => (
                            <PasoCard
                                key={i}
                                step={pasos[i]}
                                style={{ gridColumn: col + 1, gridRow: filaIndex.get(fila) + 1 }}
                                ref={el => { if (el) nodoRefs.current.set(i, el); else nodoRefs.current.delete(i); }}
                            />
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderRouteTracker;
