/**
 * Asiento del cobro de caja (services/cajaService.js, 29/10/2026, INF-SIS-2026-15).
 * Función pura: decide si el cobro se rechaza, va sin asiento o con el asiento de siempre.
 */
const { decidirAsientoCobro } = require('../services/cajaService');

describe('decidirAsientoCobro', () => {
    test('retiro en $0 con una línea de pago vacía → se rechaza (antes: 500 «mínimo 2 líneas»)', () => {
        expect(decidirAsientoCobro({ totalBruto: 0, totalNeto: 0, totalCobrado: 0, cantPagos: 1 })).toBe('RECHAZAR');
    });

    test('retiro en $0 a crédito → se rechaza', () => {
        expect(decidirAsientoCobro({ totalBruto: 0, totalNeto: 0, totalCobrado: 0, cantPagos: 0 })).toBe('RECHAZAR');
    });

    test('a crédito, sin pagos → sin asiento de cobro (antes: el total a Descuentos 5.2.03)', () => {
        expect(decidirAsientoCobro({ totalBruto: 1500, totalNeto: 1500, totalCobrado: 0, cantPagos: 0 })).toBe('SIN_ASIENTO');
    });

    test('contado normal → asiento', () => {
        expect(decidirAsientoCobro({ totalBruto: 1500, totalNeto: 1500, totalCobrado: 1500, cantPagos: 1 })).toBe('ASIENTO');
    });

    test('importe a cobrar menor que el total → asiento (el descuento es real)', () => {
        expect(decidirAsientoCobro({ totalBruto: 1500, totalNeto: 1500, totalCobrado: 1400, cantPagos: 1 })).toBe('ASIENTO');
    });

    test('descuento del 100 % por ajuste, con pago en 0 → asiento, como antes', () => {
        expect(decidirAsientoCobro({ totalBruto: 1500, totalNeto: 0, totalCobrado: 0, cantPagos: 1 })).toBe('ASIENTO');
    });

    test('total en $0 pero el cajero cobró algo → asiento (va como recargo)', () => {
        expect(decidirAsientoCobro({ totalBruto: 0, totalNeto: 0, totalCobrado: 50, cantPagos: 1 })).toBe('ASIENTO');
    });

    test('montos que vienen como null o texto (línea de pago vacía) cuentan como 0', () => {
        expect(decidirAsientoCobro({ totalBruto: '0.00', totalNeto: null, totalCobrado: NaN, cantPagos: 1 })).toBe('RECHAZAR');
    });
});
