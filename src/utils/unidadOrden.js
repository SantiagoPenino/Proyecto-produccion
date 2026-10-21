// Unidad que se MUESTRA junto a la cantidad (Magnitud) de una orden.
//
// Bordado guarda UM 'punt' en la orden, porque las puntadas son la métrica con
// que se cotiza, pero su Magnitud es la cantidad de PIEZAS: prendas o, si es un
// parche, parches. Las puntadas van aparte (MagnitudCapacidad, y las de cada
// diseño en la nota de la orden). Mostrar "10 punt" decía 10 puntadas cuando
// eran 10 prendas.
//
// `texto` es lo que dice qué es la orden (variante, material): de ahí sale si es
// un parche. Cualquier otra UM se devuelve tal cual.
export function unidadVisible(um, cantidad, texto = '') {
    const u = String(um ?? '').trim();
    if (u.toLowerCase() !== 'punt') return u;
    const una = Number(cantidad) === 1;
    if (/parche/i.test(texto || '')) return una ? 'parche' : 'parches';
    return una ? 'prenda' : 'prendas';
}
