/* ══════════════════════════════════════════════════════════════════════
   TARIFAS POR DATO TÉCNICO: BORDADO (puntadas) Y ESTAMPADO (bajadas)
   19/10/2026

   Lo que comparten Precios por cantidad y Precios Estándar: los campos
   editables de cada tarifa, sus textos y las cuentas para armar la tabla
   ("Tarifa por puntadas" / "Tarifa por bajadas"). Las cuentas son las
   mismas del motor (backend/services/pricingService.js, tarifaBordado y
   tarifaEstampado): acá se repiten para ver el resultado mientras se
   editan los valores, antes de guardarlos. Los valores vienen de
   GET /prices/tarifa/:tipo.
   ══════════════════════════════════════════════════════════════════════ */

// Si el servidor no las manda (las mismas de pricesController)
export const BAJADAS_REFERENCIA = [1, 5, 9, 10, 15, 20, 30, 40, 50, 100, 200];

const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const miles = (n) => Number(n).toLocaleString('es-UY');
const pesos = (n) => `$ ${(Number(n) || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// [23/10/2026] Las franjas de bordado que se pueden usar, de menor a mayor (las que se están escribiendo
// pueden venir como texto o incompletas)
export const franjasValidas = (franjas) => (franjas || [])
    .map(f => ({ hasta: num(f.hasta), precio: num(f.precio) }))
    .filter(f => f.hasta > 0)
    .sort((a, b) => a.hasta - b.hasta);

// Los campos que se editan en Precios Estándar, por tarifa. Bordado además tiene sus franjas
// (tarifa.franjas: [{ hasta, precio }]), que el recuadro edita aparte.
export const CAMPOS_TARIFA = {
    bordado: [
        { campo: 'precioExcedente', etiqueta: '$ cada 1.000 de más', ayuda: 'Por encima de la última franja. O fracción.', paso: '0.5' },
        { campo: 'matrizGratisDesde', etiqueta: 'Matriz sin cargo desde', ayuda: 'Bordados por diseño. 0 = siempre se cobra.', paso: '1' },
        { campo: 'minimoBordados', etiqueta: 'Mínimo de bordados', ayuda: 'Por diseño: con menos, se cobra el mínimo. 0 = sin mínimo.', paso: '1' },
    ],
    estampado: [
        { campo: 'cargoFijo', etiqueta: 'Cargo fijo ($)', ayuda: 'Por trabajo, si tiene menos bajadas en total que el número de al lado.', paso: '10' },
        { campo: 'umbral', etiqueta: 'Desde (bajadas en total)', ayuda: 'Desde acá se cobra por bajada.', paso: '1' },
        { campo: 'precioBajada', etiqueta: '$ por bajada', ayuda: 'Bajadas en total = bajadas por prenda × prendas.', paso: '0.5' },
    ],
};

export const TEXTOS_TARIFA = {
    bordado: {
        titulo: 'Tarifa por puntadas',
        cobro: 'Por puntadas',
        // El motor no usa el precio de lista de estos artículos: Precios Estándar no deja cargarlo
        reemplazaLista: true,
        descripcion: 'El bordado se cobra con esta tarifa, no con el precio de cada artículo: cada bordado paga el precio de la franja de sus puntadas. La matriz, el relieve 3D y la aplicación de parche sí usan su precio de la tabla.',
        nota: 'Precio de cada bordado según sus puntadas',
        // [23/10/2026] el mínimo es configurable (minimoBordados, 0 = sin mínimo)
        extra: (t) => (num(t?.minimoBordados) > 0 ? `Mínimo ${num(t.minimoBordados)} bordados por diseño: con menos, se cobran ${num(t.minimoBordados)}.` : 'Sin mínimo de bordados por diseño.'),
    },
    estampado: {
        titulo: 'Tarifa por bajadas',
        cobro: 'Por bajadas',
        // Sin bajadas en la orden, el motor cobra la lista: el precio sigue editable
        reemplazaLista: false,
        pista: 'Por bajadas si la orden las trae; si no, este precio por prenda',
        descripcion: 'El estampado se cobra con esta tarifa cuando la orden trae las bajadas; si no las trae, se cobra el precio de la tabla por cada prenda.',
        nota: 'Precio del trabajo según las bajadas en total',
        extra: 'Bajadas en total = bajadas por prenda × prendas (20 prendas con 2 bajadas = 40).',
    },
};

// La tabla de la tarifa: { titulo, subtitulo, encabezado: { etiqueta, valores }, filas: [{ etiqueta, destacada, celdas: [{ precio, detalle }] }] }
export function tablaDeTarifa(t) {
    if (!t) return null;
    if (t.tipo === 'bordado') {
        // [23/10/2026] Una columna por franja y una más para lo que pasa la última (pricingService.tarifaBordado)
        const franjas = franjasValidas(t.franjas);
        if (franjas.length === 0) return null;
        const intervalo = num(t.intervalo) || 1000;
        const excedente = num(t.precioExcedente);
        const ultima = franjas[franjas.length - 1];
        return {
            titulo: TEXTOS_TARIFA.bordado.titulo,
            subtitulo: 'precio de cada bordado, en pesos',
            encabezado: {
                etiqueta: 'Puntadas',
                valores: [
                    ...franjas.map((f, i) => i === 0 ? `hasta ${miles(f.hasta)}` : `${miles(franjas[i - 1].hasta + 1)} a ${miles(f.hasta)}`),
                    `más de ${miles(ultima.hasta)}`,
                ],
            },
            filas: [{
                etiqueta: 'Precio por bordado', destacada: true,
                celdas: [
                    ...franjas.map(f => ({ precio: f.precio, detalle: '' })),
                    { precio: ultima.precio + excedente, texto: `desde ${pesos(ultima.precio + excedente)}`, detalle: `$ ${miles(ultima.precio)} + $ ${miles(excedente)} c/${miles(intervalo)} de más` },
                ],
            }],
        };
    }
    if (t.tipo === 'estampado') {
        const umbral = num(t.umbral);
        const fijo = num(t.cargoFijo);
        const pb = num(t.precioBajada);
        const valores = t.referencia || BAJADAS_REFERENCIA;
        const total = (b) => (b < umbral ? fijo : b * pb);
        return {
            titulo: TEXTOS_TARIFA.estampado.titulo,
            subtitulo: 'precio de cada trabajo según las bajadas en total, en pesos',
            encabezado: { etiqueta: 'Bajadas en total', valores },
            filas: [
                {
                    etiqueta: 'Precio del trabajo', destacada: true,
                    celdas: valores.map(b => ({ precio: total(b), detalle: b < umbral ? 'cargo fijo' : `${miles(b)} × $ ${pb}` })),
                },
                { etiqueta: 'Por bajada', celdas: valores.map(b => ({ precio: total(b) / b, detalle: '' })) },
            ],
        };
    }
    return null;
}

// El precio básico de la tarifa, para la columna de lista de los artículos que se cobran por ella
export function cobroBasico(t) {
    if (!t) return null;
    if (t.tipo === 'bordado') {
        const primera = franjasValidas(t.franjas)[0];
        if (!primera) return null;
        return { precio: primera.precio, texto: `hasta ${miles(primera.hasta)} puntadas`, titulo: 'Se cobra por franjas de puntadas del diseño: ver la tabla de la tarifa' };
    }
    if (t.tipo === 'estampado') return { precio: num(t.precioBajada), texto: 'por bajada', titulo: `Se cobra por bajadas: $ ${miles(num(t.cargoFijo))} fijo el trabajo con menos de ${num(t.umbral)} bajadas en total` };
    return null;
}
