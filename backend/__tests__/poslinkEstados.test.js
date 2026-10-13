/**
 * POSLink — traducción de respuestas de PLS a nuestros estados (plan §4.2) y helpers del cliente.
 * Funciones puras: no tocan la base ni la red, así que corren sin terminal ni credenciales.
 */
const { E, OCUPA_TERMINAL, LIBERA_REFERENCIAS, interpretarAlta, interpretarConsulta, filtrarRespuesta, esDebito, decidirRebaja, repartoConRebaja } = require('../services/poslink/poslinkEstados');
const { fechaPls, centesimosDe, transactionIdDe, _interno } = require('../services/poslink/poslinkClient');

const venta = (estado = E.ESPERANDO_POS, extra = {}) => ({ estado, transactionId: '2124555675197402', cancelOk: false, esTotem: false, ...extra });
const aprobada = (pos, extra = {}) => ({ ResponseCode: 0, PosResponseCode: pos, TotalAmount: '10000', ...extra });

describe('alta de la venta (processFinancialPurchase)', () => {
    test('0 con TransactionId → ENVIADA, y el id sale del string', () => {
        const r = interpretarAlta({ ResponseCode: 0, TransactionId: 2124555675197402, STransactionId: '2124555675197402' }, null);
        expect(r).toMatchObject({ estado: E.ENVIADA, transactionId: '2124555675197402' });
    });
    test('-100 y 107 sin TransactionId → ERROR_VALIDACION (la venta no existe)', () => {
        expect(interpretarAlta({ ResponseCode: -100 }, null).estado).toBe(E.ERROR_VALIDACION);
        expect(interpretarAlta({ ResponseCode: 107 }, null).estado).toBe(E.ERROR_VALIDACION);
    });
    test('timeout o corte de red → INDETERMINADA: nunca se reintenta a ciegas', () => {
        expect(interpretarAlta(null, { tipo: 'TIMEOUT', message: 't' }).estado).toBe(E.INDETERMINADA);
        expect(interpretarAlta(null, { tipo: 'RED', message: 'r' }).estado).toBe(E.INDETERMINADA);
    });
    test('HTTP 4xx sin id → ERROR_VALIDACION; 5xx → INDETERMINADA', () => {
        expect(interpretarAlta(null, { tipo: 'HTTP', status: 406, message: 'x' }).estado).toBe(E.ERROR_VALIDACION);
        expect(interpretarAlta(null, { tipo: 'HTTP', status: 502, message: 'x' }).estado).toBe(E.INDETERMINADA);
    });
    test('999 o 0 sin TransactionId → INDETERMINADA', () => {
        expect(interpretarAlta({ ResponseCode: 999 }, null).estado).toBe(E.INDETERMINADA);
        expect(interpretarAlta({ ResponseCode: 0 }, null).estado).toBe(E.INDETERMINADA);
    });
});

describe('consulta de la venta (processFinancialPurchaseQuery)', () => {
    test('10 → ESPERANDO_POS; 12 → CAPTURADA', () => {
        expect(interpretarConsulta({ ResponseCode: 10, RemainingExpirationTime: 195 }, venta(E.ENVIADA)).estado).toBe(E.ESPERANDO_POS);
        expect(interpretarConsulta({ ResponseCode: 12, RemainingExpirationTime: 60 }, venta()).estado).toBe(E.CAPTURADA);
    });
    test('12 con el reloj de PLS en 0: en el tótem reversa, en la caja decide la cajera', () => {
        const tot = interpretarConsulta({ ResponseCode: 12, RemainingExpirationTime: 0 }, venta(E.CAPTURADA, { esTotem: true }));
        expect(tot).toMatchObject({ estado: E.CAPTURADA, accion: 'REVERSAR' });
        const caja = interpretarConsulta({ ResponseCode: 12, RemainingExpirationTime: 0 }, venta(E.CAPTURADA));
        expect(caja).toMatchObject({ estado: E.INDETERMINADA, accion: null });
    });
    test('0 y 111 son finales: 111 es lo que contesta PLS al reconsultar [SPEC p.7]', () => {
        for (const rc of [0, 111]) {
            const r = interpretarConsulta(aprobada('00', { ResponseCode: rc }), venta(E.CAPTURADA));
            expect(r).toMatchObject({ estado: E.APROBADA, accion: 'REGISTRAR' });
        }
    });
    test('aprobado parcial (10): aprueba, y el monto que vale es TotalAmount', () => {
        const r = interpretarConsulta(aprobada('10', { TotalAmount: '7500' }), venta(E.CAPTURADA));
        expect(r.estado).toBe(E.APROBADA);
        expect(r.datos.montoAutorizadoCentesimos).toBe(7500);
    });
    test('01/02: en la caja pide autorización, en el tótem es rechazo', () => {
        expect(interpretarConsulta(aprobada('01'), venta(E.CAPTURADA)).estado).toBe(E.PEDIR_AUTORIZACION);
        expect(interpretarConsulta(aprobada('02'), venta(E.CAPTURADA, { esTotem: true })).estado).toBe(E.RECHAZADA);
    });
    test('grupo ciego (91, 96, CE, ER, NC, NR) → INDETERMINADA; TP → PENDIENTE_BILLETERA', () => {
        for (const pc of ['91', '96', 'CE', 'ER', 'NC', 'NR']) expect(interpretarConsulta(aprobada(pc), venta(E.CAPTURADA)).estado).toBe(E.INDETERMINADA);
        expect(interpretarConsulta(aprobada('TP'), venta(E.CAPTURADA)).estado).toBe(E.PENDIENTE_BILLETERA);
    });
    test('CT (el POS canceló: visto el 12/10 a los ~60 s sin tarjeta) y TO (venció el ingreso) → CANCELADA', () => {
        expect(interpretarConsulta(aprobada('CT', { TotalAmount: '100', RemainingExpirationTime: 0 }), venta(E.CAPTURADA)).estado).toBe(E.CANCELADA);
        expect(interpretarConsulta(aprobada('TO'), venta(E.CAPTURADA)).estado).toBe(E.CANCELADA);
    });
    test('cualquier otro PosResponseCode, incluido XX y uno fuera de tabla → RECHAZADA', () => {
        for (const pc of ['05', '51', 'XX', 'ZZ']) expect(interpretarConsulta(aprobada(pc), venta(E.CAPTURADA)).estado).toBe(E.RECHAZADA);
    });
    test('el PosResponseCode es texto: "00" aprueba, el número 0 no se confunde', () => {
        expect(interpretarConsulta(aprobada('00'), venta()).estado).toBe(E.APROBADA);
        expect(interpretarConsulta({ ResponseCode: 0, TotalAmount: '1' }, venta()).estado).toBe(E.INDETERMINADA);
    });
    test('999: cancelada solo si hubo una cancelación acusada con 0 (verificado 16/09)', () => {
        expect(interpretarConsulta({ ResponseCode: 999 }, venta(E.ESPERANDO_POS, { cancelOk: true })).estado).toBe(E.CANCELADA);
        expect(interpretarConsulta({ ResponseCode: 999 }, venta(E.ESPERANDO_POS)).estado).toBe(E.INDETERMINADA);
    });
    test('110: sin TransactionId nunca llegó; con TransactionId es duda', () => {
        expect(interpretarConsulta({ ResponseCode: 110 }, venta(E.ENVIADA, { transactionId: null })).estado).toBe(E.CANCELADA);
        expect(interpretarConsulta({ ResponseCode: 110 }, venta(E.ENVIADA)).estado).toBe(E.INDETERMINADA);
    });
    test('11: expirada si no se capturó; duda si ya se capturó', () => {
        expect(interpretarConsulta({ ResponseCode: 11 }, venta(E.ESPERANDO_POS)).estado).toBe(E.CANCELADA);
        expect(interpretarConsulta({ ResponseCode: 11 }, venta(E.CAPTURADA)).estado).toBe(E.INDETERMINADA);
    });
    test('113 y errores de formato en la consulta no cambian el estado', () => {
        expect(interpretarConsulta({ ResponseCode: 113 }, venta(E.CAPTURADA)).estado).toBe(E.CAPTURADA);
        expect(interpretarConsulta({ ResponseCode: -100 }, venta(E.ESPERANDO_POS)).estado).toBe(E.ESPERANDO_POS);
    });
    test('State 5/6 → CANCELADA; State 10 → REVERSADA', () => {
        expect(interpretarConsulta({ ResponseCode: 111, State: 6 }, venta()).estado).toBe(E.CANCELADA);
        expect(interpretarConsulta({ ResponseCode: 111, State: '5' }, venta()).estado).toBe(E.CANCELADA);
        expect(interpretarConsulta({ ResponseCode: 111, State: 10, PosResponseCode: '00' }, venta()).estado).toBe(E.REVERSADA);
    });
    test('una reversa pendiente solo se cierra con State 10: el 0 de la reversa es acuse de encolado', () => {
        expect(interpretarConsulta(aprobada('00'), venta(E.REVERSA_PENDIENTE)).estado).toBe(E.REVERSA_PENDIENTE);
        expect(interpretarConsulta(aprobada('00', { State: 10 }), venta(E.REVERSA_PENDIENTE)).estado).toBe(E.REVERSADA);
    });
});

describe('rebaja de IVA Ley 19.210', () => {
    const base = { tipoCFE: 101, receptor: '', cantidadPagos: 1, monedaDoc: 1, monedaPos: 1, totalDocCentesimos: 12200, montoPosCentesimos: 12200, gravadoCentesimos: 10000 };
    test('e-Ticket a consumidor final pagado entero con la tarjeta → se pide', () => {
        expect(decidirRebaja(base).pedir).toBe(true);
        expect(decidirRebaja({ ...base, receptor: '4.123.456-7' }).pedir).toBe(true); // con cédula sigue siendo consumidor final
    });
    test('no se pide: e-Factura, RUT, pagos mixtos, otra moneda, importe distinto, nada gravado', () => {
        expect(decidirRebaja({ ...base, tipoCFE: 111 }).pedir).toBe(false);
        expect(decidirRebaja({ ...base, receptor: '215939820014' }).pedir).toBe(false);
        expect(decidirRebaja({ ...base, cantidadPagos: 2 }).pedir).toBe(false);
        expect(decidirRebaja({ ...base, monedaPos: 2 }).pedir).toBe(false);
        expect(decidirRebaja({ ...base, montoPosCentesimos: 12000 }).pedir).toBe(false);
        expect(decidirRebaja({ ...base, gravadoCentesimos: 0 }).pedir).toBe(false);
    });
    test('reparto: TotalAmount neto o total, siempre tarjeta + rebaja = pedido', () => {
        expect(repartoConRebaja({ pedidoCentesimos: 12200, autorizadoCentesimos: 12000, rebajaCentesimos: 200 })).toEqual({ ok: true, tarjetaCentesimos: 12000, rebajaCentesimos: 200 });
        expect(repartoConRebaja({ pedidoCentesimos: 12200, autorizadoCentesimos: 12200, rebajaCentesimos: 200 })).toEqual({ ok: true, tarjetaCentesimos: 12000, rebajaCentesimos: 200 });
        expect(repartoConRebaja({ pedidoCentesimos: 12200, autorizadoCentesimos: 12200, rebajaCentesimos: 0 })).toEqual({ ok: true, tarjetaCentesimos: 12200, rebajaCentesimos: 0 });
    });
    test('reparto que no cierra o aprobado parcial → no se registra', () => {
        expect(repartoConRebaja({ pedidoCentesimos: 12200, autorizadoCentesimos: 11000, rebajaCentesimos: 200 }).ok).toBe(false);
        expect(repartoConRebaja({ pedidoCentesimos: 12200, autorizadoCentesimos: 7500, rebajaCentesimos: 0 }).ok).toBe(false);
    });
});

describe('candados', () => {
    test('REVERSA_PENDIENTE no ocupa la terminal (si no, se traba para siempre) pero no libera lo cobrado', () => {
        expect(OCUPA_TERMINAL.has(E.REVERSA_PENDIENTE)).toBe(false);
        expect(LIBERA_REFERENCIAS.has(E.REVERSA_PENDIENTE)).toBe(false);
    });
    test('INDETERMINADA y APROBADA_SIN_REGISTRAR mantienen lo cobrado bloqueado', () => {
        expect(OCUPA_TERMINAL.has(E.INDETERMINADA)).toBe(true);
        expect(LIBERA_REFERENCIAS.has(E.INDETERMINADA)).toBe(false);
        expect(LIBERA_REFERENCIAS.has(E.APROBADA_SIN_REGISTRAR)).toBe(false);
        expect(LIBERA_REFERENCIAS.has(E.APROBADA)).toBe(false);
    });
});

describe('helpers', () => {
    test('fecha de PLS: 17 dígitos en hora de Uruguay', () => {
        expect(fechaPls(new Date(Date.UTC(2026, 9, 12, 15, 4, 5, 7)))).toBe('20261012120405007');
    });
    test('importes: centésimos sin separador, pesos con separador, ceros a la izquierda', () => {
        expect(centesimosDe('120050')).toBe(120050);
        expect(centesimosDe('0000919000')).toBe(919000);
        expect(centesimosDe('0.00')).toBe(0);
        expect(centesimosDe('12.5')).toBe(1250);
        expect(centesimosDe('')).toBeNull();
    });
    test('TransactionId de 19 dígitos no se redondea: va sin comillas al enviar y como texto al leer', () => {
        const id = '1234567890123456789';
        const json = _interno.serializar({ TransactionId: `__POSLINK_RAW_NUM__${id}`, STransactionId: id });
        expect(json).toBe(`{"TransactionId":${id},"STransactionId":"${id}"}`);
        expect(transactionIdDe(_interno.parsear(`{"ResponseCode":0,"TransactionId":${id}}`))).toBe(id);
    });
    test('la respuesta guardada no lleva nombre ni cédula del tarjetahabiente', () => {
        const f = filtrarRespuesta({ CardNumber: '******0119', CardOwnerName: 'X', CI: '1', TotalAmount: '1' });
        expect(f).toEqual({ CardNumber: '******0119', TotalAmount: '1' });
    });
    test('débito real del 12/10 (Visa Débito): CardAccountType "0", Issuer 34, voucher COMPRA DEBITO → débito', () => {
        const voucherXml = '<linea><itemLinea>       COMPRA DEBITO ONLINE       </itemLinea></linea>';
        expect(esDebito({ voucherXml, issuer: 34, cardAccountType: '0', taxAmountCentesimos: 0 })).toBe(true);
        expect(esDebito({ issuer: 34, cardAccountType: '0' })).toBe(true); // sin voucher, por el emisor
    });
    test('el voucher manda sobre el emisor; emisores de crédito; 55 ambiguo no decide', () => {
        expect(esDebito({ voucherXml: 'COMPRA CREDITO ONLINE', issuer: 34 })).toBe(false);
        expect(esDebito({ issuer: 24, cardAccountType: '0' })).toBe(false); // VISA crédito
        expect(esDebito({ issuer: 7 })).toBe(true);                         // 07 CABALDEBIT, sin el 0
        expect(esDebito({ issuer: 55, cardAccountType: '0' })).toBe(false); // CREDITEL: cae al resto
        expect(esDebito({ issuer: 55, cardAccountType: '10' })).toBe(true);
        expect(esDebito({ cardAccountType: '', taxAmountCentesimos: 200 })).toBe(true);
    });
});
