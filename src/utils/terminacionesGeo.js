/**
 * Geometría de terminaciones sobre una pieza rectangular (ECOUV).
 *
 * Único lugar donde se resuelve "dónde va" y "cuánto entra" una terminación:
 *  - el portal lo usa para sugerir la cantidad y dibujar lo que el cliente eligió
 *  - la orden de taller lo usa para imprimir el reparto real por lado
 *
 * Sin React ni acceso a datos: entra la medida, sale el número.
 */

// Lados de la pieza: t=arriba, b=abajo, l=izquierda, r=derecha
export const LADOS = ['t', 'r', 'b', 'l'];
export const LADO_NOMBRE = { t: 'arriba', r: 'derecha', b: 'abajo', l: 'izquierda' };

// Ubicación (lo que se guarda en OrdenTerminaciones.Ubicacion) → lados que ocupa
const UBI_LADOS = {
    ARRIBA: ['t'],
    ABAJO: ['b'],
    ARRIBA_ABAJO: ['t', 'b'],
    IZQUIERDA: ['l'],
    DERECHA: ['r'],
    COSTADOS: ['l', 'r'],
    PERIMETRO: ['t', 'r', 'b', 'l'],
};

export const UBI_LABEL = {
    ARRIBA: 'Arriba', ABAJO: 'Abajo', ARRIBA_ABAJO: 'Arriba y abajo',
    IZQUIERDA: 'Izquierda', DERECHA: 'Derecha',
    COSTADOS: 'Ambos costados', PERIMETRO: 'Todo el perímetro',
};

/**
 * Lados que ocupa una ubicación guardada. Acepta:
 *  - las canónicas: 'PERIMETRO', 'ARRIBA_ABAJO', ...
 *  - combinaciones libres separadas por coma: 'ARRIBA,IZQUIERDA'
 *    (el cliente puede marcar los bordes que quiera en el plano).
 */
export const ladosDeUbicacion = (ubi) => {
    if (!ubi) return [];
    if (UBI_LADOS[ubi]) return UBI_LADOS[ubi];
    const set = new Set();
    String(ubi).split(',').forEach(parte => {
        (UBI_LADOS[parte.trim()] || []).forEach(l => set.add(l));
    });
    return LADOS.filter(l => set.has(l));   // siempre en orden t,r,b,l
};

/**
 * Lados marcados → cómo se guarda. Si hay una ubicación canónica que los
 * representa exactamente se usa esa (compatible con todo lo ya cargado);
 * si no, se guarda la lista de lados simples separada por coma.
 */
export const ubicacionDeLados = (lados) => {
    const set = new Set(lados);
    if (!set.size) return '';
    const igual = (arr) => arr.length === set.size && arr.every(l => set.has(l));
    const canonica = Object.keys(UBI_LADOS).find(k => igual(UBI_LADOS[k]));
    if (canonica) return canonica;
    const SIMPLE = { t: 'ARRIBA', r: 'DERECHA', b: 'ABAJO', l: 'IZQUIERDA' };
    return LADOS.filter(l => set.has(l)).map(l => SIMPLE[l]).join(',');
};

/** Etiqueta legible de una ubicación, sea canónica o combinación libre. */
export const labelUbicacion = (ubi) => {
    if (!ubi) return '';
    if (UBI_LABEL[ubi]) return UBI_LABEL[ubi];
    return String(ubi).split(',')
        .map(p => UBI_LABEL[p.trim()] || p.trim())
        .join(' + ');
};

/** Largo de un lado en metros: arriba/abajo miden el ancho, los costados el alto. */
export const largoLado = (lado, w, h) => (lado === 't' || lado === 'b') ? (w || 0) : (h || 0);

/** Metros totales de borde que abarca una ubicación (para soldadura, bolsillo...). */
export const tramoTotal = (ubi, w, h) =>
    ladosDeUbicacion(ubi).reduce((acc, l) => acc + largoLado(l, w, h), 0);

/**
 * Ojales que entran en UN lado: son PUNTOS, no intervalos.
 * Un lado de 3 m cada 50 cm lleva 7 ojales (uno en cada punta + 5 en el medio),
 * no 6. Mínimo 2 (las puntas) en cualquier lado con ojales.
 * El -0.001 evita que un largo múltiplo exacto del paso sume un ojal de más
 * por error de coma flotante.
 */
export const ojalesEnLado = (largoM, pasoM) => {
    if (!(largoM > 0) || !(pasoM > 0)) return 0;
    return Math.max(2, Math.ceil(largoM / pasoM - 0.001) + 1);
};

/**
 * Reparto real de ojales de una ubicación.
 * Las esquinas se comparten entre dos lados contiguos: se cuentan una sola vez.
 * @returns {{total:number, porLado:Array<{lado,largoM,cantidad,separacionM}>}}
 */
export const repartoOjales = (ubi, w, h, pasoM) => {
    const lados = ladosDeUbicacion(ubi);
    const porLado = lados.map(lado => {
        const largoM = largoLado(lado, w, h);
        const cantidad = ojalesEnLado(largoM, pasoM);
        return { lado, largoM, cantidad, separacionM: cantidad > 1 ? largoM / (cantidad - 1) : 0 };
    });
    let total = porLado.reduce((acc, x) => acc + x.cantidad, 0);
    // Esquinas compartidas: solo si ambos lados de la esquina llevan ojales
    const tiene = (l) => lados.includes(l);
    [['t', 'l'], ['t', 'r'], ['b', 'l'], ['b', 'r']].forEach(([a, b]) => {
        if (tiene(a) && tiene(b)) total -= 1;
    });
    return { total: Math.max(0, total), porLado };
};

/** Posiciones 0..1 de los ojales sobre un lado (para dibujarlos). */
export const posicionesOjales = (cantidad) => {
    if (cantidad < 2) return cantidad === 1 ? [0.5] : [];
    return Array.from({ length: cantidad }, (_, i) => i / (cantidad - 1));
};

/**
 * Cantidad sugerida de una terminación según su regla:
 *   METROS_TRAMO → metros del tramo elegido (soldadura, bolsillo)
 *   CADA_X_CM    → ojales repartidos sobre el tramo (ParamCantidad = paso en cm)
 *   FIJA         → ParamCantidad tal cual
 */
export const cantidadSugerida = (term, ubi, { w, h }) => {
    const regla = term?.ReglaCantidad || 'FIJA';
    if (regla === 'METROS_TRAMO') return Math.round(tramoTotal(ubi, w, h) * 100) / 100;
    if (regla === 'CADA_X_CM') {
        const pasoM = (parseFloat(term?.ParamCantidad) || 50) / 100;
        const { total } = repartoOjales(ubi, w, h, pasoM);
        return total || 1;
    }
    return parseFloat(term?.ParamCantidad) || 1;
};

/** Texto del reparto para mostrar al cliente y al taller. */
export const textoReparto = (term, ubi, { w, h }) => {
    const regla = term?.ReglaCantidad || 'FIJA';
    if (regla === 'CADA_X_CM') {
        const pasoM = (parseFloat(term?.ParamCantidad) || 50) / 100;
        const { porLado } = repartoOjales(ubi, w, h, pasoM);
        if (!porLado.length) return '';
        const det = porLado
            .map(x => `${LADO_NOMBRE[x.lado]}: ${x.cantidad} cada ${Math.round(x.separacionM * 100)} cm`)
            .join(' · ');
        return porLado.length > 1 ? `${det} — las esquinas van una sola vez` : det;
    }
    if (regla === 'METROS_TRAMO') {
        const lados = ladosDeUbicacion(ubi);
        if (!lados.length) return '';
        return lados.map(l => `${LADO_NOMBRE[l]} (${largoLado(l, w, h).toFixed(2)} m)`).join(' · ');
    }
    return '';
};
