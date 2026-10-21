/**
 * Plan de sincronización de Pagos al editar un documento contado (pagosTransaccionService).
 * Función pura: decide qué Pago se actualiza, cuál se reemplaza y cuál se agrega, sin tocar la base.
 */
const { planificarSincronizacion } = require('../services/pagosTransaccionService');

const viejo = (id, metodo, moneda, monto) => ({ PagIdPago: id, MPaIdMetodoPago: metodo, PagIdMonedaPago: moneda, PagMontoPago: monto });
const nuevo = (metodoPagoId, monedaId, monto) => ({ metodoPagoId, monedaId, monto });

describe('planificarSincronizacion', () => {
    test('mismo cobro de antes → un par sin cambio de monto, nada que reemplazar', () => {
        const p = planificarSincronizacion([viejo(10, 1, 1, 490)], [nuevo(1, 1, 490)]);
        expect(p.pares).toHaveLength(1);
        expect(p.pares[0]).toMatchObject({ n: 0, cambiaMonto: false });
        expect(p.pares[0].viejo.PagIdPago).toBe(10);
        expect(p.reemplazos).toHaveLength(0);
        expect(p.insertar).toHaveLength(0);
        expect(p.absorber).toHaveLength(0);
    });

    test('diferencia de centavos (float) no cuenta como cambio', () => {
        const p = planificarSincronizacion([viejo(10, 1, 1, 4315.01)], [nuevo(1, 1, 4315.010000001)]);
        expect(p.pares[0].cambiaMonto).toBe(false);
    });

    test('mismo medio y moneda con otro monto → se actualiza en el lugar', () => {
        const p = planificarSincronizacion([viejo(10, 1, 1, 490)], [nuevo(1, 1, 500)]);
        expect(p.pares).toHaveLength(1);
        expect(p.pares[0].cambiaMonto).toBe(true);
        expect(p.reemplazos).toHaveLength(0);
    });

    test('cambia el medio de pago → se reemplaza (el Pago viejo pasa al nuevo)', () => {
        const p = planificarSincronizacion([viejo(10, 1, 1, 490)], [nuevo(2, 1, 490)]);
        expect(p.pares).toHaveLength(0);
        expect(p.reemplazos).toEqual([{ viejo: viejo(10, 1, 1, 490), n: 0 }]);
    });

    test('cambia la moneda → se reemplaza', () => {
        const p = planificarSincronizacion([viejo(10, 1, 1, 490)], [nuevo(1, 2, 12)]);
        expect(p.reemplazos).toHaveLength(1);
    });

    test('de 1 pago a 2 → el que coincide se conserva y el otro se agrega', () => {
        const p = planificarSincronizacion([viejo(10, 1, 1, 400)], [nuevo(1, 1, 400), nuevo(2, 1, 90)]);
        expect(p.pares.map(x => x.viejo.PagIdPago)).toEqual([10]);
        expect(p.insertar).toEqual([1]);
        expect(p.absorber).toHaveLength(0);
    });

    test('de 2 pagos a 1 → el que sobra se absorbe (sus vínculos pasan al que queda)', () => {
        const p = planificarSincronizacion([viejo(10, 1, 1, 400), viejo(11, 2, 1, 90)], [nuevo(1, 1, 490)]);
        expect(p.pares.map(x => x.viejo.PagIdPago)).toEqual([10]);
        expect(p.pares[0].cambiaMonto).toBe(true);
        expect(p.absorber.map(v => v.PagIdPago)).toEqual([11]);
    });

    test('dos pagos del mismo medio: cada uno empareja con el de su monto, sin cruzarse', () => {
        const p = planificarSincronizacion(
            [viejo(10, 1, 1, 100), viejo(11, 1, 1, 50)],
            [nuevo(1, 1, 50), nuevo(1, 1, 100)]);
        const porNuevo = Object.fromEntries(p.pares.map(x => [x.n, x.viejo.PagIdPago]));
        expect(porNuevo).toEqual({ 0: 11, 1: 10 });
        expect(p.pares.every(x => !x.cambiaMonto)).toBe(true);
    });

    test('un mismo Pago viejo no se usa dos veces', () => {
        const p = planificarSincronizacion([viejo(10, 1, 1, 100)], [nuevo(1, 1, 100), nuevo(1, 1, 100)]);
        expect(p.pares).toHaveLength(1);
        expect(p.insertar).toEqual([1]);
    });
});
