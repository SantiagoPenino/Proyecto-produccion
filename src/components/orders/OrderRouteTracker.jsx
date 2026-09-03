import React, { useEffect, useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react';

/**
 * OrderRouteTracker Component - DEBUG VERSION & DATA FIX
 *
 * [PRENDAS] Modo grafo: cuando el pedido tiene ramas reales (ej. Sublimación y DTF
 * arrancando en paralelo, o Estampado que depende de DTF Y de la prenda armada), se
 * arma como grafo por capas en vez de una fila derecha. Si NO hay ramas (el 99% de las
 * órdenes: una sola cadena lineal), se sigue viendo EXACTO a como se veía siempre — la
 * fila simple de abajo no se tocó.
 *
 * PRO (cuando existe) es un caso especial: no es un paso físico real — es el "pilar" que
 * agrupa el pedido (ver [PRENDAS] Fabricar a Medida con Producto Terminado). Por eso sus
 * hijos en el grafo NO salen de su propio ProximoServicio (que puede ser un valor sin
 * sentido físico, ej. 'DEPOSITO'), sino que se DERIVAN: es raíz de todo lo que no tenga
 * ningún otro paso apuntándole. En "Comprar y personalizar" (donde PRO sí es un paso
 * físico real) esto da el mismo resultado que seguir su ProximoServicio, así que no hay
 * caso especial que mantener aparte.
 */

// [PRENDAS] El backend manda el código de área (TWC, TWT...) tal cual, sin nombre legible —
// se traduce acá. Mismo mapeo que ya usa PrendaOrderForm.jsx para EMB/DF/TPU/TWC/TWT.
// Exportado: es la misma fuente de verdad que usa la lista de reordenar Costura/Bordado/
// Estampado en OrderDetailModal.jsx — nunca mostrar el código ahí tampoco.
export const AREA_NAMES = {
    SB: 'Sublimación',
    DF: 'Estampados DTF',
    TPU: 'Estampados TPU',
    EMB: 'Bordado',
    TWC: 'Corte',
    TWT: 'Costura',
    EST: 'Estampado',
    PRO: 'Producción',
    DEPOSITO: 'Depósito',
};

// HELPER: Extraer nombre de cualquier campo posible
const getAreaName = (s) => {
    if (!s) return '???';
    const raw = s.Nombre || s.nombre || s.AreaNombre || s.AreaID || s.area || s.id || '???';
    return AREA_NAMES[raw.toString().trim().toUpperCase()] || raw;
};

// HELPER: Extraer estado
const getStatus = (s) => {
    if (!s) return 'Pendiente';
    return s.Estado || s.estado || s.status || 'Pendiente';
};

// HELPER: Extraer Detalle
const getDetail = (s) => s.EstadoenArea || s.estadoenArea || s.estadoArea || '-';

const stepVisual = (step) => {
    const areaName = getAreaName(step).toUpperCase();
    const statusRaw = getStatus(step);
    const status = statusRaw.toUpperCase();
    const detail = getDetail(step);
    const logistic = step.EstadoLogistica || step.estadoLogistica || '-';

    let type = 'PENDING';
    // [PRENDAS] "Recibido en Destino"/"Ingresado": la orden ya se entregó del todo en esta
    // área (su bulto se confirmó en la siguiente) — cuenta como terminada acá, igual que
    // Pronto/Finalizado. "En tránsito" queda afuera a propósito: todavía está viajando.
    if (status.includes('PRONTO') || status.includes('FINALIZADO') || status.includes('COMPLETADO') || status.includes('RECIBIDO EN DESTINO') || status.includes('INGRESADO') || status.includes('ENTREGADO')) type = 'FINISHED';
    else if (status.includes('CANCEL')) type = 'CANCELLED';
    else if (status.startsWith('PENDIENTE') || status === '') type = 'PENDING';
    else type = 'ACTIVE';

    let circleClass = "bg-white border-2 border-slate-200 text-slate-300";
    let icon = "fa-circle";
    let textClass = "text-slate-400";
    let borderClass = "border-slate-100";
    let connectorClass = "bg-slate-200";

    if (type === 'FINISHED') {
        circleClass = "bg-teal-500 border-teal-500 text-white shadow-sm";
        icon = "fa-check";
        textClass = "text-teal-700 font-bold";
        borderClass = "border-teal-100 bg-teal-50";
        connectorClass = "bg-teal-400";
    } else if (type === 'ACTIVE') {
        circleClass = "bg-white border-4 border-amber-400 text-amber-500 font-bold scale-110 shadow-lg z-10";
        icon = "fa-gear fa-spin";
        textClass = "text-amber-700 font-black";
        borderClass = "border-amber-200 bg-amber-50";
        connectorClass = "bg-slate-200";
    } else if (type === 'CANCELLED') {
        circleClass = "bg-red-500 text-white border-red-500";
        icon = "fa-ban";
        textClass = "text-red-600 font-bold";
        borderClass = "border-red-100 bg-red-50";
    }

    return { areaName, statusRaw, detail, logistic, type, circleClass, icon, textClass, borderClass, connectorClass };
};

// Componente de módulo (no se redefine en cada render) — necesario para que los refs
// del modo grafo sean estables entre renders y el efecto de medición no entre en loop.
const StepCircle = React.forwardRef(({ step }, ref) => {
    const v = stepVisual(step);
    return (
        // bg-white de fondo propio: sin esto, la línea del grafo pasa "por detrás" pero pegada
        // al borde de la tarjeta y da la sensación de que los pasos se tocan/unen entre sí.
        <div ref={ref} className="flex flex-col items-center relative w-[150px] bg-white rounded-xl py-2">
            <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all box-content ${v.circleClass}`}>
                <i className={`fa-solid ${v.icon} ${v.type === 'PENDING' ? 'text-[8px]' : ''}`}></i>
            </div>
            <div className="mt-3 flex flex-col items-center gap-1 w-full px-1 text-center">
                <div className={`text-xs uppercase tracking-tight leading-tight mb-1 h-6 flex items-end ${v.textClass}`}>{v.areaName}</div>
                <div className={`w-full rounded border p-1 shadow-sm ${v.borderClass}`}>
                    <div className="text-[10px] font-bold uppercase truncate">{v.statusRaw}</div>
                    {v.detail !== '-' && <div className="text-[9px] text-slate-500 truncate border-t border-black/5 mt-0.5 pt-0.5">{v.detail}</div>}
                    {v.logistic !== '-' && <div className="text-[9px] text-blue-600 font-bold truncate pt-0.5"><i className="fa-solid fa-truck text-[8px] mr-1"></i>{v.logistic}</div>}
                </div>
            </div>
        </div>
    );
});

const OrderRouteTracker = ({ steps = [], title = "Hoja de Ruta (Flujo de Áreas)" }) => {

    // DEBUG: Ver qué datos llegan realmente
    useEffect(() => {
        if (steps && steps.length > 0) {
            console.log("OrderRouteTracker received steps:", steps);
        }
    }, [steps]);

    // 1. DATA PREPARATION & MAPPING ROBUSTNESS
    // Memoizado sobre el prop `steps`: si no, `[...steps]` arma un array nuevo en CADA
    // render, el grafo de abajo se recalcula siempre, dispara setLines, eso re-renderiza,
    // y vuelve a arrancar — loop infinito (se cuelga la pantalla) apenas hay ramas.
    const rawSteps = useMemo(() => (Array.isArray(steps) ? [...steps] : []), [steps]);

    // 2. ARMAR EL GRAFO (edges + capas). Puramente derivado de rawSteps — si no viene
    // "nextAreas" (respuestas viejas del backend, u otras pantallas que reusen este
    // componente sin ese campo), da 0 aristas y cae directo al modo lineal de siempre.
    const graph = useMemo(() => {
        const idsUpper = rawSteps.map(s => (s.id || getAreaName(s) || '').toString().trim().toUpperCase());
        const indexByUpperId = new Map(idsUpper.map((u, i) => [u, i]));
        const proIdx = idsUpper.indexOf('PRO');

        // [PRENDAS] FASE 5/6: con combos, PRO puede ser TANTO origen (de donde nacen los
        // componentes sueltos, ej. Bordado/DTF) COMO destino (donde convergen antes de
        // Depósito, porque cada componente "muere" en PRO) — antes de esto PRO solo podía
        // ser origen. Si detectamos una arista real que apunta a PRO, el nodo se DUPLICA
        // visualmente: una copia "origen" (misma posición/rol de siempre) y una copia
        // "destino" al final del array de trabajo, con los MISMOS datos de la orden (es
        // la misma orden real, solo se dibuja 2 veces). Sin ninguna arista real entrante a
        // PRO (el caso de siempre, sin combos), no hay duplicación — comportamiento
        // IDÉNTICO al de antes, fallback exacto.
        const proTieneEntradaReal = proIdx !== -1 && rawSteps.some((s, i) => {
            if (i === proIdx) return false;
            const nexts = Array.isArray(s.nextAreas) ? s.nextAreas : (s.nextArea ? [s.nextArea] : []);
            return nexts.some(n => (n || '').toString().trim().toUpperCase() === 'PRO');
        });
        const workingSteps = proTieneEntradaReal ? [...rawSteps, rawSteps[proIdx]] : rawSteps;
        const proOrigenIdx = proIdx;
        const proDestinoIdx = proTieneEntradaReal ? workingSteps.length - 1 : -1;

        // Aristas "reales": ProximoServicio de cada paso, solo si el destino también es un
        // paso visible acá. Las que apuntan a PRO van al nodo "destino" (si existe), no al
        // de "origen" — así la flecha entra a la convergencia, no al punto de partida.
        const realEdges = []; // [fromIdx, toIdx]
        workingSteps.forEach((s, i) => {
            if (i === proOrigenIdx || i === proDestinoIdx) return; // PRO: sus aristas se resuelven aparte
            const nexts = Array.isArray(s.nextAreas) ? s.nextAreas : (s.nextArea ? [s.nextArea] : []);
            nexts.forEach(n => {
                const target = (n || '').toString().trim().toUpperCase();
                const j = target === 'PRO' && proDestinoIdx !== -1 ? proDestinoIdx : indexByUpperId.get(target);
                if (j !== undefined && j !== i) realEdges.push([i, j]);
            });
        });
        // PRO-destino sale hacia el ProximoServicio real de la orden PRO (ej. DEPOSITO),
        // si ese paso también es visible acá.
        if (proDestinoIdx !== -1) {
            const proStep = rawSteps[proIdx];
            const nexts = Array.isArray(proStep.nextAreas) ? proStep.nextAreas : (proStep.nextArea ? [proStep.nextArea] : []);
            nexts.forEach(n => {
                const j = indexByUpperId.get((n || '').toString().trim().toUpperCase());
                if (j !== undefined && j !== proDestinoIdx) realEdges.push([proDestinoIdx, j]);
            });
        }

        // Raíces derivadas: todo paso (que no sea PRO-origen ni PRO-destino) sin ninguna
        // arista real entrante nace de PRO-origen.
        const inDegree = new Array(workingSteps.length).fill(0);
        realEdges.forEach(([, j]) => { inDegree[j]++; });
        const edges = [...realEdges];
        if (proOrigenIdx !== -1) {
            workingSteps.forEach((s, i) => {
                if (i !== proOrigenIdx && i !== proDestinoIdx && inDegree[i] === 0) edges.push([proOrigenIdx, i]);
            });
        }

        // Sin PRO y sin ninguna arista real: no hay grafo que armar (ej. un solo paso,
        // o datos viejos sin nextAreas) — modo lineal, como toda la vida.
        if (edges.length === 0) return { hasBranching: false };

        // Capas por camino más largo desde cualquier raíz (0 aristas entrantes en el set
        // final `edges`) — así un nodo con 2 padres (ej. Estampado, que depende de DTF Y
        // de la prenda armada; o PRO-destino, que depende de TODOS los componentes) queda
        // DESPUÉS de todos ellos, nunca antes.
        const inDegreeFinal = new Array(workingSteps.length).fill(0);
        edges.forEach(([, j]) => { inDegreeFinal[j]++; });
        const depth = new Array(workingSteps.length).fill(-1);
        const roots = workingSteps.map((_, i) => i).filter(i => inDegreeFinal[i] === 0);
        if (roots.length === 0) return { hasBranching: false }; // ciclo raro / datos inconsistentes — no arriesgar

        // BFS por niveles, relajando profundidad como "camino más largo conocido hasta ahora".
        const queue = [...roots];
        roots.forEach(r => { depth[r] = 0; });
        let iterations = 0;
        const maxIterations = workingSteps.length * workingSteps.length + 10; // guard anti-loop
        while (queue.length > 0 && iterations < maxIterations) {
            iterations++;
            const cur = queue.shift();
            edges.filter(([from]) => from === cur).forEach(([, to]) => {
                const candidate = depth[cur] + 1;
                if (candidate > depth[to]) {
                    depth[to] = candidate;
                    queue.push(to);
                }
            });
        }
        // Nodos nunca alcanzados (aislados, sin arista alguna): quedan en su propia capa al final.
        let maxDepth = Math.max(0, ...depth.filter(d => d >= 0));
        workingSteps.forEach((_, i) => { if (depth[i] === -1) { maxDepth += 1; depth[i] = maxDepth; } });

        const numLayers = Math.max(...depth) + 1;
        const hasBranching = numLayers < workingSteps.length; // menos capas que pasos = alguna capa tiene 2+

        if (!hasBranching) return { hasBranching: false };

        const columns = Array.from({ length: numLayers }, () => []);
        workingSteps.forEach((s, i) => columns[depth[i]].push(i));

        return { hasBranching: true, columns, edges, depth, workingSteps };
    }, [rawSteps]);

    // --- Grafo: medimos posiciones reales en el DOM para trazar las líneas, en vez de
    // adivinar coordenadas — así queda prolijo sin importar cuánto texto tenga cada tarjeta.
    const graphContainerRef = useRef(null);
    const nodeRefs = useRef(new Map());
    const [lines, setLines] = useState([]);

    const recomputeLines = useCallback(() => {
        if (!graph.hasBranching || !graphContainerRef.current) return;
        const containerRect = graphContainerRef.current.getBoundingClientRect();
        const next = [];
        graph.edges.forEach(([from, to]) => {
            const fromEl = nodeRefs.current.get(from);
            const toEl = nodeRefs.current.get(to);
            if (!fromEl || !toEl) return;
            const fromCircle = fromEl.querySelector('.rounded-full')?.getBoundingClientRect();
            const toCircle = toEl.querySelector('.rounded-full')?.getBoundingClientRect();
            if (!fromCircle || !toCircle) return;
            const x1 = fromCircle.right - containerRect.left + graphContainerRef.current.scrollLeft;
            const y1 = fromCircle.top + fromCircle.height / 2 - containerRect.top + graphContainerRef.current.scrollTop;
            const x2 = toCircle.left - containerRect.left + graphContainerRef.current.scrollLeft;
            const y2 = toCircle.top + toCircle.height / 2 - containerRect.top + graphContainerRef.current.scrollTop;
            next.push({ x1, y1, x2, y2, key: `${from}-${to}` });
        });
        setLines(next);
    }, [graph]);

    useLayoutEffect(() => {
        recomputeLines();
        if (!graph.hasBranching || !graphContainerRef.current) return;
        const ro = new ResizeObserver(() => recomputeLines());
        ro.observe(graphContainerRef.current);
        window.addEventListener('resize', recomputeLines);
        return () => {
            ro.disconnect();
            window.removeEventListener('resize', recomputeLines);
        };
    }, [graph, recomputeLines]);

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col gap-6 w-full">

            <div className="flex justify-between items-center border-b border-slate-100 pb-4">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <i className="fa-solid fa-timeline text-blue-600"></i>
                    {title}
                </h3>
            </div>

            {graph.hasBranching ? (
                // --- MODO GRAFO: columnas por capa, filas dentro de cada columna ---
                <div ref={graphContainerRef} className="relative overflow-x-auto pb-6 pt-4">
                    <svg className="absolute top-0 left-0 pointer-events-none" style={{ width: '100%', height: '100%', overflow: 'visible', zIndex: 0 }}>
                        <defs>
                            {/* Flecha en la punta: hace inequívoco A QUÉ nodo llega cada línea */}
                            <marker id="ort-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#94a3b8" />
                            </marker>
                        </defs>
                        {lines.map(l => {
                            // Trazado en dos tramos: la línea viaja RECTA a la altura del ORIGEN
                            // y baja/sube recién en el hueco libre (~120px) pegado al destino.
                            // Así nunca cruza por DETRÁS de un nodo intermedio de la fila del
                            // destino (los círculos son blancos, z-index arriba del svg: la
                            // "cortaban" y un DTF → Estampado parecía terminar en Bordado).
                            // El remate queda 5px antes del círculo para que la flecha se vea
                            // entera y no la tape el nodo.
                            const xEnd = l.x2 - 5;
                            const span = xEnd - l.x1;
                            const drop = Math.min(120, Math.max(30, span * 0.4));
                            const xs = Math.max(l.x1, xEnd - drop); // arranque de la caída
                            return (
                                <path key={l.key}
                                    d={`M ${l.x1} ${l.y1} L ${xs} ${l.y1} C ${xs + (xEnd - xs) * 0.5} ${l.y1}, ${xEnd - (xEnd - xs) * 0.5} ${l.y2}, ${xEnd} ${l.y2}`}
                                    fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" markerEnd="url(#ort-arrow)" />
                            );
                        })}
                    </svg>
                    <div className="relative flex items-center justify-center min-w-max px-6 mx-auto gap-20" style={{ zIndex: 1 }}>
                        {graph.columns.map((colIndices, colIdx) => (
                            <div key={colIdx} className="flex flex-col gap-12 justify-center">
                                {colIndices.map(i => (
                                    <StepCircle key={i} step={(graph.workingSteps || rawSteps)[i]} ref={el => {
                                        if (el) nodeRefs.current.set(i, el);
                                        else nodeRefs.current.delete(i);
                                    }} />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                // --- MODO LINEAL (de siempre): una sola fila, sin cambios ---
                <div className="overflow-x-auto pb-6 pt-2">
                    <div className="flex items-start justify-center min-w-max px-4 mx-auto gap-0">
                        {rawSteps.map((step, idx) => {
                            const v = stepVisual(step);
                            return (
                                <div key={idx} className="flex flex-col items-center relative flex-1 min-w-[140px] group">
                                    {idx < rawSteps.length - 1 && (
                                        <div className={`absolute top-7 left-1/2 w-full h-1 -translate-y-1/2 -z-10 ${v.connectorClass}`}></div>
                                    )}
                                    <div className={`w-14 h-14 rounded-full flex items-center justify-center text-xl transition-all box-content ${v.circleClass}`}>
                                        <i className={`fa-solid ${v.icon} ${v.type === 'PENDING' ? 'text-[8px]' : ''}`}></i>
                                    </div>
                                    <div className="mt-3 flex flex-col items-center gap-1 w-full px-1 text-center">
                                        <div className={`text-xs uppercase tracking-tight leading-tight mb-1 h-6 flex items-end ${v.textClass}`}>{v.areaName}</div>
                                        <div className={`w-full rounded border p-1 ${v.borderClass}`}>
                                            <div className="text-[10px] font-bold uppercase truncate">{v.statusRaw}</div>
                                            {v.detail !== '-' && <div className="text-[9px] text-slate-500 truncate border-t border-black/5 mt-0.5 pt-0.5">{v.detail}</div>}
                                            {v.logistic !== '-' && <div className="text-[9px] text-blue-600 font-bold truncate pt-0.5"><i className="fa-solid fa-truck text-[8px] mr-1"></i>{v.logistic}</div>}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderRouteTracker;
