// Precios por cantidad de los productos del configurador (27-oct-2026). Lo MISMO que
// backend/services/escalasProducto.precioPara (y que el motor con esas reglas), para mostrar el precio
// según la cantidad: gana la escala más alta que alcanza la cantidad; un precio fijo solo gana si es más
// bajo que la lista (y mayor que 0); el descuento es % sobre la lista.
//   escalas = { tipo: 'fixed_price' | 'percentage_discount', filas: [{ desde, valor }] }
// Devuelve { precio, desde } — desde = la escala que se aplicó (null = precio de lista).
export const precioPorCantidad = (precioLista, escalas, cantidad) => {
    const base = Number(precioLista);
    if (!(base > 0) || !escalas?.filas?.length) return { precio: base > 0 ? base : null, desde: null };
    const q = Number(cantidad) || 0;
    const f = [...escalas.filas].map(x => ({ desde: Number(x.desde), valor: Number(x.valor) }))
        .filter(x => x.desde > 0 && x.valor > 0).sort((a, b) => b.desde - a.desde).find(x => x.desde <= q);
    if (!f) return { precio: base, desde: null };
    const precio = escalas.tipo === 'percentage_discount' ? base * (1 - f.valor / 100) : (f.valor < base ? f.valor : base);
    return { precio: Math.round(precio * 100) / 100, desde: precio < base ? f.desde : null };
};

// "desde 10: $300 · desde 50: $280" (para la tarjeta del producto). simbolo = '$' o 'US$'.
export const textoEscalas = (precioLista, escalas, simbolo = '$') => {
    if (!escalas?.filas?.length || !(Number(precioLista) > 0)) return '';
    return [...escalas.filas].sort((a, b) => a.desde - b.desde)
        .map(f => ({ desde: Number(f.desde), r: precioPorCantidad(precioLista, escalas, f.desde) }))
        .filter(x => x.r.desde != null)
        .map(x => `desde ${x.desde}: ${simbolo} ${x.r.precio.toLocaleString('es-UY', { maximumFractionDigits: 2 })}`)
        .join(' · ');
};
