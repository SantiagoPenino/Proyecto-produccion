// Orden de las órdenes de un lote (26/10/2026). Es la regla del detalle del lote (RollDetailsModal)
// sacada a un solo lugar para que el Control (FilePrintControl) muestre exactamente el mismo orden:
// antes el Control ordenaba solo por Secuencia, y una orden que entró tarde al lote (Secuencia =
// MAX+1) aparecía al final aunque en el detalle estuviera con su tela.
//
// En SB las órdenes se agrupan por tela. La lista tiene DOS mitades con reglas distintas (07/09/2026):
//  · IMPRESAS = historia. Van por FechaImpreso — lo que la máquina hizo, en ese orden — y se
//    agrupan por tela consecutiva. Su Secuencia NO cuenta: una orden que entró tarde al lote
//    (Secuencia = MAX+1) pero se imprimió con su tela queda donde se imprimió. Antes se ubicaba
//    por Secuencia y el bloque de tela "se cerraba" al tildar otra tela: la orden impresa
//    saltaba al final de la lista y, como "la última impresa" quedaba al final, arrastraba a
//    TODO lo pendiente a "fuera de orden" (lote sb-08 del 07/09: 18 órdenes de golpe).
//  · PENDIENTES = plan. Por Secuencia, agrupadas por tela. Las de la tela que está en máquina
//    continúan el último bloque impreso (se imprimen a continuación, sin cambiar tela). Las de
//    una tela que ya se imprimió y quedó atrás van al final con FUERA DE ORDEN (solo con `conCola`:
//    el lote en la impresora): hay que volver a cargar esa tela, así que se imprimen último.
// Se usa SIEMPRE 'printed' + 'fechaImpreso' (no el campo de la 2ª estación): el agrupado
// representa el orden de IMPRESIÓN y la calandra lo muestra invertido (`invertir`).
// Sin fecha (impresa antes de que existiera la columna) = antes que cualquiera con fecha.
// En el resto de las áreas no se agrupa por tela (todo suelto), y en las de marcado libre (DF/ECOUV)
// no hay cola: se muestra por Secuencia, sin mover nada.

// Marcado LIBRE: se puede marcar/desmarcar impresa CUALQUIER orden; son las áreas que no imprimen en cola.
export const AREAS_MARCADO_LIBRE = ['DF', 'ECOUV'];

// Clave de AGRUPADO: en Tela de Cliente se agrupa por Referencia de la bobina (solo si es igual);
// en el resto, por material. Así dos telas de cliente solo se juntan si comparten Referencia.
export const materialDeOrden = (o) => (o?.material || o?.Material || '').trim();
export const claveTela = (o) => (o?.referencia != null && String(o.referencia).trim() !== '')
    ? ('REF:' + String(o.referencia).trim()) : materialDeOrden(o);

// Grupos manuales — persistidos en BACKEND (Ordenes.GrupoManual). Las órdenes que comparten
// GrupoManual (>=2) forman un grupo, y solo si TODAS tienen la misma clave de agrupado (en Tela de
// Cliente = misma Referencia): si no, se ignora y sus órdenes se vuelven a separar.
export function gruposManuales(orders, groupKeyOf = claveTela) {
    const byGid = {};
    orders.forEach(o => { if (o.groupId != null) { (byGid[o.groupId] = byGid[o.groupId] || []).push(o); } });
    return Object.values(byGid)
        .filter(g => g.length >= 2 && new Set(g.map(groupKeyOf)).size === 1)
        .map(g => g.map(o => o.id));
}

const seqDe = (o) => (o.sequence ?? o.Secuencia ?? 999999);
const porSecuencia = (a, b) => (seqDe(a) - seqDe(b)) || ((a.id || 0) - (b.id || 0));

/**
 * Unidades del lote en el orden en que se muestran: grupo manual, grupo auto (tela con 1 sola orden),
 * bloque de tela u orden suelta. Cada unidad: { key, kind, material, orders, sig, mat? }.
 * Cada orden necesita: id, sequence, printed, fechaImpreso, groupId, material y referencia.
 */
export function unidadesLote(ordersIn, {
    isSB = false, marcadoLibre = false, invertir = false, conCola = false,
    manualGroups = null, matKey = (o) => (claveTela(o) || '—'), matDisplay = materialDeOrden,
} = {}) {
    const orders = [...(ordersIn || [])].sort(porSecuencia);
    const manualIdxOf = {};
    (manualGroups || gruposManuales(orders)).forEach((g, gi) => g.forEach(id => { manualIdxOf[id] = gi; }));
    const unidad = (key, kind, o) => ({ key, kind, material: matDisplay(o) || '—', orders: [] });
    // Firma estable por unidad (ids ordenados) — la usan el drag y la marca de bloqueo — y el
    // inverso EXACTO para la calandra: se invierten los grupos Y las órdenes dentro de cada grupo,
    // igual que el botón "invertir".
    const cerrar = (units) => {
        units.forEach(u => { u.sig = u.orders.map(o => o.id).slice().sort((a, b) => a - b).join(','); });
        if (invertir) {
            units.reverse();
            units.forEach(u => { u.orders = [...u.orders].reverse(); });
        }
        return units;
    };

    if (marcadoLibre) {
        return cerrar(orders.map(o => { const u = unidad('l:' + o.id, 'loose', o); u.orders.push(o); return u; }));
    }

    const tsDe = (o) => { const t = o?.fechaImpreso ? new Date(o.fechaImpreso).getTime() : NaN; return Number.isFinite(t) ? t : -Infinity; };
    const porImpresion = (a, b) => {
        const ta = tsDe(a), tb = tsDe(b);
        if (ta !== tb) return ta < tb ? -1 : 1;
        return porSecuencia(a, b);
    };

    // ── Impresas: por hora de impresión, tela consecutiva = un bloque ──────────────────
    const list = [];
    let ult = null;
    orders.filter(o => o.printed).sort(porImpresion).forEach(o => {
        const mat = isSB ? matKey(o) : ('l:' + o.id);
        if (!ult || ult.mat !== mat) { ult = unidad('p:' + list.length, 'loose', o); ult.mat = mat; list.push(ult); }
        ult.orders.push(o);
    });
    const telaEnCurso = ult ? ult.mat : null;
    const telasImpresas = new Set(list.map(u => u.mat));

    // ── Pendientes: por Secuencia ──────────────────────────────────────────────────────
    const pendientes = orders.filter(o => !o.printed);
    // matCount (auto vs bloque suelto) cuenta las sueltas, NUEVAS incluidas: una nueva que se
    // suma a su tela hace bloque igual que cualquier otra. Solo quedan afuera las ya agrupadas.
    const matCount = {};
    pendientes.forEach(o => { if (manualIdxOf[o.id] === undefined) { const m = matKey(o); matCount[m] = (matCount[m] || 0) + 1; } });
    const byKey = {};
    const cola = [];
    pendientes.forEach(o => {
        // Una orden NUEVA (asignada al lote con el modal abierto) NO se saca del circuito: se
        // ubica por su tela como cualquier otra (pedido de planta 10/09/2026). Antes se iba
        // derecho al final en un bloque propio sin siquiera mirar la tela, así que una orden
        // de una tela que estaba ahí mismo sin imprimir aparecía último. Las tres ramas de abajo
        // dan justo la regla pedida: se suma a su grupo si le queda algo sin imprimir, o si su tela
        // es la que está en máquina (el grupo siguiente todavía no arrancó); si su tela ya pasó,
        // FUERA DE ORDEN.
        if (!isSB) { const u = unidad('l:' + o.id, 'loose', o); u.orders.push(o); list.push(u); return; }
        const mat = matKey(o);
        // La tela que está en máquina sigue: la orden entra al bloque impreso, a continuación.
        if (ult && mat === telaEnCurso && manualIdxOf[o.id] === undefined) { ult.orders.push(o); return; }
        // Su tela ya se imprimió y la máquina siguió con otra → al final (habrá que recargarla).
        const fuera = conCola && telasImpresas.has(mat) && mat !== telaEnCurso;
        let key, kind;
        if (manualIdxOf[o.id] !== undefined) { key = 'm' + manualIdxOf[o.id]; kind = 'manual'; }
        else if (matCount[mat] === 1) { key = 'a:' + mat; kind = 'auto'; }
        else { key = 'lm:' + mat; kind = 'loose'; }
        if (fuera) { key = 'seq:' + key; kind = 'outseq'; }
        let u = byKey[key];
        if (!u) { u = unidad(key, kind, o); byKey[key] = u; (fuera ? cola : list).push(u); }
        u.orders.push(o);
    });
    // Bloques impresos en SB: 1 orden = 'auto' (encabezado con la tela), más de una = bloque.
    if (isSB) list.forEach(u => { if (u.mat !== undefined) u.kind = u.orders.length > 1 ? 'loose' : 'auto'; });

    return cerrar(list.concat(cola));
}

/** Los ids del lote en el orden en que se muestran (mismas opciones que unidadesLote). */
export const idsEnOrdenLote = (orders, opciones) => unidadesLote(orders, opciones).flatMap(u => u.orders.map(o => o.id));
