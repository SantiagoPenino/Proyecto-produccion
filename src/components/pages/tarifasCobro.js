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
export const PUNTADAS_REFERENCIA = [3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000, 12000, 15000, 20000, 25000, 30000];
export const BAJADAS_REFERENCIA = [1, 5, 9, 10, 15, 20, 30, 40, 50, 100, 200];

const num = (v) => Number(String(v ?? '').replace(',', '.')) || 0;
const miles = (n) => Number(n).toLocaleString('es-UY');

// Los campos que se editan en Precios Estándar, por tarifa
export const CAMPOS_TARIFA = {
    bordado: [
        { campo: 'precioCada1000', etiqueta: '$ cada 1.000 puntadas', ayuda: 'O fracción. Por bordado, en pesos.', paso: '0.5' },
        { campo: 'tramo2Desde', etiqueta: 'Desde (puntadas)', ayuda: 'Desde acá rige el precio de al lado.', paso: '1000' },
        { campo: 'precioTramo2', etiqueta: '$ cada 1.000 desde ahí', ayuda: 'O fracción, de esas puntadas en más.', paso: '0.5' },
        { campo: 'matrizGratisDesde', etiqueta: 'Matriz sin cargo desde', ayuda: 'Bordados por diseño. 0 = siempre se cobra.', paso: '1' },
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
        descripcion: 'El bordado se cobra con esta tarifa, no con el precio de cada artículo. La matriz, el relieve 3D y la aplicación de parche sí usan su precio de la tabla.',
        nota: 'Precio de cada bordado según sus puntadas',
        extra: 'Mínimo 5 bordados por diseño.',
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
        const intervalo = num(t.intervalo) || 1000;
        const desde = num(t.tramo2Desde);
        const p1 = num(t.precioCada1000);
        const p2 = num(t.precioTramo2);
        const valores = t.referencia || PUNTADAS_REFERENCIA;
        return {
            titulo: TEXTOS_TARIFA.bordado.titulo,
            subtitulo: 'precio de cada bordado, en pesos',
            encabezado: { etiqueta: 'Puntadas', valores },
            filas: [{
                etiqueta: 'Precio por bordado', destacada: true,
                celdas: valores.map(p => {
                    const b1 = Math.ceil(Math.min(p, desde) / intervalo);
                    const b2 = Math.ceil(Math.max(0, p - desde) / intervalo);
                    return { precio: b1 * p1 + b2 * p2, detalle: `${b1} × $ ${p1}${b2 ? ` + ${b2} × $ ${p2}` : ''}` };
                }),
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
    if (t.tipo === 'bordado') return { precio: num(t.precioCada1000), texto: `cada ${miles(num(t.intervalo) || 1000)} puntadas`, titulo: 'Se cobra según las puntadas del diseño: ver la tabla de la tarifa' };
    if (t.tipo === 'estampado') return { precio: num(t.precioBajada), texto: 'por bajada', titulo: `Se cobra por bajadas: $ ${miles(num(t.cargoFijo))} fijo el trabajo con menos de ${num(t.umbral)} bajadas en total` };
    return null;
}
