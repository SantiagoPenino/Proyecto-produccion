/**
 * poslinkEstados.js — traduce respuestas de PLS a NUESTROS estados (plan §4.2).
 * Funciones puras: no tocan la base ni la red, así se prueban sin terminal.
 *
 * Regla dura: los códigos de PLS nunca son nuestro estado. Un `12` del Query no significa lo
 * mismo que un `12` del Confirm ni que un PosResponseCode `12`: por eso cada función sabe de
 * qué método viene la respuesta.
 *
 * Premisa de todo el módulo: cobrar dos veces es peor que no cobrar. Ante la duda, INDETERMINADA
 * (que deja los dos candados puestos y llama a un humano), nunca "reintentar".
 */
const { campo, centesimosDe, transactionIdDe, responseCodeDe } = require('./poslinkClient');

const E = Object.freeze({
    CREADA: 'CREADA',
    ENVIADA: 'ENVIADA',
    ERROR_VALIDACION: 'ERROR_VALIDACION',
    ESPERANDO_POS: 'ESPERANDO_POS',
    CAPTURADA: 'CAPTURADA',
    APROBADA: 'APROBADA',
    PEDIR_AUTORIZACION: 'PEDIR_AUTORIZACION',
    RECHAZADA: 'RECHAZADA',
    CANCELADA: 'CANCELADA',
    PENDIENTE_BILLETERA: 'PENDIENTE_BILLETERA',
    REVERSA_PENDIENTE: 'REVERSA_PENDIENTE',
    REVERSADA: 'REVERSADA',
    INDETERMINADA: 'INDETERMINADA',
    REGISTRADA: 'REGISTRADA',
    APROBADA_SIN_REGISTRAR: 'APROBADA_SIN_REGISTRAR',
});

/** Candado A (por terminal): tiene que coincidir con el índice filtrado de PosTransacciones. */
const OCUPA_TERMINAL = new Set([E.CREADA, E.ENVIADA, E.ESPERANDO_POS, E.CAPTURADA, E.INDETERMINADA, E.PENDIENTE_BILLETERA]);

/**
 * Candado B (por lo que se cobra): se libera solo cuando es seguro que no hay plata debitada,
 * o cuando el cobro quedó registrado y los guards de dominio toman la posta.
 * APROBADA, PEDIR_AUTORIZACION, REVERSA_PENDIENTE, INDETERMINADA y APROBADA_SIN_REGISTRAR NO liberan.
 */
const LIBERA_REFERENCIAS = new Set([E.ERROR_VALIDACION, E.RECHAZADA, E.CANCELADA, E.REVERSADA, E.REGISTRADA]);

/** Estados finales: el barrido no los vuelve a mirar. */
const FINALES = new Set([E.ERROR_VALIDACION, E.RECHAZADA, E.CANCELADA, E.REVERSADA, E.REGISTRADA, E.APROBADA_SIN_REGISTRAR]);

/** Estados que el barrido tiene que seguir poleando contra PLS. */
const A_POLEAR = new Set([E.ENVIADA, E.ESPERANDO_POS, E.CAPTURADA, E.PENDIENTE_BILLETERA, E.REVERSA_PENDIENTE]);

// Anexo 1 [SPEC p.50]: errores de validación del pedido. En la VENTA significan que la venta
// nunca existió en PLS (final, alerta técnica). En una CONSULTA son un error nuestro del pedido
// de consulta: la venta puede seguir viva, no cambian nada.
const RC_VALIDACION = new Set([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 112, -100]);

// Anexo 2 [SPEC p.51-53]
const POS_APROBADO = new Set(['00', '08', '10', '11', '85', 'OF']);
const POS_PEDIR_AUTORIZACION = new Set(['01', '02']);
const POS_CIEGO = new Set(['91', '96', 'CE', 'ER', 'NC', 'NR']); // no sabemos si se debitó
// CT = el POS canceló la venta. Visto en homologación el 12/10/2026: sin que nadie tocara nada, el POS
// la tomó y a los ~60 s sin tarjeta devolvió ResponseCode 0 + CT, Ticket 0, sin autorización, voucher
// "TRANSACCION FALLIDA". La tecla roja también cancela [SPEC p.63]. TO = venció el ingreso de la tarjeta.
// Nada cobrado: es cancelación, no rechazo.
const POS_CANCELADO = new Set(['CT', 'TO']);

// Anexo 8 [SPEC p.57]
const STATE_EXPIRADA = 5, STATE_CANCELADA = 6, STATE_REVERSADA = 10;

function posCode(resp) {
    const v = campo(resp, 'PosResponseCode');
    return v === undefined || v === null ? '' : String(v).trim().toUpperCase();
}

function stateDe(resp) {
    const v = campo(resp, 'State');
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

/** Datos del Query que se guardan en la fila. Sin nombre, CI ni datos de uso interno. */
function datosConsulta(resp) {
    const str = (k, max) => {
        const v = campo(resp, k);
        if (v === undefined || v === null || v === '') return null;
        return String(v).slice(0, max);
    };
    const rem = Number(campo(resp, 'RemainingExpirationTime'));
    return {
        responseCode: responseCodeDe(resp),
        posResponseCode: posCode(resp) || null,
        state: stateDe(resp),
        montoAutorizadoCentesimos: centesimosDe(campo(resp, 'TotalAmount')),
        taxAmountCentesimos: centesimosDe(campo(resp, 'TaxAmount')),
        authorizationCode: str('AuthorizationCode', 20),
        ticket: str('Ticket', 50),
        batch: str('Batch', 10),
        acquirer: str('Acquirer', 10),
        issuer: str('Issuer', 10),
        cardNumber: str('CardNumber', 50),
        cardAccountType: str('CardAccountType', 20),
        acquirerTerminal: str('AcquirerTerminal', 10),
        remainingExpirationTime: Number.isFinite(rem) ? rem : null,
    };
}

/** Copia de la respuesta para auditoría, sin datos del tarjetahabiente (plan, riesgo 12). */
const CAMPOS_PRIVADOS = ['CardOwnerName', 'CI', 'ExpirationDate', 'PrivateUse1', 'SpecialData', 'AdditionalData'];
function filtrarRespuesta(resp) {
    if (!resp || typeof resp !== 'object') return null;
    const out = {};
    for (const [k, v] of Object.entries(resp)) {
        if (CAMPOS_PRIVADOS.some(p => p.toLowerCase() === k.toLowerCase())) continue;
        out[k] = v;
    }
    return out;
}

/**
 * Respuesta de processFinancialPurchase (el alta de la venta).
 * @param {object|null} resp   respuesta parseada, o null si no hubo respuesta
 * @param {object|null} error  PoslinkError si la llamada falló
 * @returns {{ estado, transactionId, motivo }}
 */
function interpretarAlta(resp, error) {
    if (error) {
        // Timeout o corte de red: no sabemos si PLS registró la venta. Nunca se reintenta a
        // ciegas [ABIERTO R4]; los dos candados quedan puestos (plan §4.5 vector 1).
        if (error.tipo === 'TIMEOUT' || error.tipo === 'RED' || error.tipo === 'RESPUESTA') {
            return { estado: E.INDETERMINADA, transactionId: null, motivo: `Sin respuesta de PLS al registrar la venta (${error.tipo}): ${error.message}` };
        }
        // HTTP 4xx: PLS rechazó el pedido antes de procesarlo, la venta no existe.
        // HTTP 5xx: el servidor falló en algún punto: no sabemos si llegó a crearla.
        if (error.tipo === 'HTTP' && error.status >= 400 && error.status < 500) {
            const txId = error.data ? transactionIdDe(error.data) : null;
            if (!txId) return { estado: E.ERROR_VALIDACION, transactionId: null, motivo: `PLS rechazó el pedido: HTTP ${error.status}` };
        }
        if (error.tipo === 'CONFIG') return { estado: E.ERROR_VALIDACION, transactionId: null, motivo: error.message };
        return { estado: E.INDETERMINADA, transactionId: null, motivo: `Error de PLS al registrar la venta: ${error.message}` };
    }
    const rc = responseCodeDe(resp);
    const txId = transactionIdDe(resp);
    if (rc === 0 && txId) return { estado: E.ENVIADA, transactionId: txId, motivo: null };
    if (RC_VALIDACION.has(rc) && !txId) {
        return { estado: E.ERROR_VALIDACION, transactionId: null, motivo: `PLS rechazó la venta: ResponseCode ${rc}` };
    }
    // 0 sin TransactionId, 999, o cualquier cosa fuera de la tabla: no sabemos.
    return { estado: E.INDETERMINADA, transactionId: txId, motivo: `Respuesta inesperada al registrar la venta: ResponseCode ${rc}${txId ? '' : ', sin TransactionId'}` };
}

/**
 * Respuesta de processFinancialPurchaseQuery para una VENTA.
 * @param {object} resp
 * @param {object} fila  { estado, transactionId, cancelOk (bool), esTotem (bool) }
 * @returns {{ estado, accion, motivo, datos }}
 *   estado: el estado al que pasa la fila (puede ser el mismo).
 *   accion: null | 'REVERSAR' (solo tótem: 12 + RemainingExpirationTime 0) | 'REGISTRAR'.
 */
function interpretarConsulta(resp, fila) {
    const datos = datosConsulta(resp);
    const rc = datos.responseCode;
    const pc = datos.posResponseCode || '';
    const r = (estado, motivo = null, accion = null) => ({ estado, accion, motivo, datos });

    // Una reversa pendiente solo se da por hecha con State 10 [SPEC p.57]. Mientras tanto,
    // cualquier otra respuesta la deja como está: el 0 de la reversa fue acuse de encolado.
    if (fila.estado === E.REVERSA_PENDIENTE) {
        if (datos.state === STATE_REVERSADA) return r(E.REVERSADA, 'PLS informa la transacción reversada (State 10).');
        return r(E.REVERSA_PENDIENTE);
    }

    switch (rc) {
        case 10: return r(E.ESPERANDO_POS);
        case 113: return r(fila.estado, 'PLS pide volver a consultar (113).'); // [ABIERTO R14] seguir poleando
        case 12: {
            // Zona roja: el POS tomó la venta. Reversa solo con el reloj de ELLOS en 0 [SPEC p.18].
            if (datos.remainingExpirationTime === 0) {
                if (fila.esTotem) return r(E.CAPTURADA, 'Capturada y vencida: corresponde reversa (autogestión).', 'REVERSAR');
                // En la caja la spec permite no reversar: hay una cajera que puede liberar al cliente [SPEC p.17].
                return r(E.INDETERMINADA, 'Capturada y vencida en la caja: lo decide la cajera (no se reversa automático).');
            }
            return r(E.CAPTURADA);
        }
        case 0:
        case 111: { // 111 = "finalizada" al reconsultar [SPEC p.7]: para el poller, final = {0, 111}
            if (datos.state === STATE_REVERSADA) return r(E.REVERSADA, 'PLS informa la transacción reversada (State 10).');
            if (datos.state === STATE_EXPIRADA || datos.state === STATE_CANCELADA) {
                return r(E.CANCELADA, `PLS informa la venta ${datos.state === STATE_EXPIRADA ? 'expirada' : 'cancelada'} (State ${datos.state}).`);
            }
            if (!pc) return r(E.INDETERMINADA, `ResponseCode ${rc} sin PosResponseCode.`);
            if (POS_APROBADO.has(pc)) return r(E.APROBADA, null, 'REGISTRAR');
            if (POS_PEDIR_AUTORIZACION.has(pc)) {
                // En el tótem no hay quién llame al emisor: es un rechazo.
                return fila.esTotem
                    ? r(E.RECHAZADA, `PosResponseCode ${pc} (pedir autorización) en autogestión: se trata como rechazo.`)
                    : r(E.PEDIR_AUTORIZACION, `PosResponseCode ${pc}: la cajera tiene que pedir autorización al emisor.`);
            }
            if (pc === 'TP') return r(E.PENDIENTE_BILLETERA, 'Billetera: transacción pendiente, verificación manual en el POS [SPEC p.21].');
            if (POS_CIEGO.has(pc)) return r(E.INDETERMINADA, `PosResponseCode ${pc}: no se sabe si se debitó.`);
            if (POS_CANCELADO.has(pc)) {
                return r(E.CANCELADA, pc === 'CT' ? 'El POS canceló la venta sin cobrar (CT).' : 'Venció el tiempo para pasar la tarjeta (TO).');
            }
            return r(E.RECHAZADA, `Rechazada por el sello: PosResponseCode ${pc}.`);
        }
        case 110:
            // Sin TransactionId nunca llegó a PLS. Con TransactionId existió y ya no está [ABIERTO R10].
            return fila.transactionId
                ? r(E.INDETERMINADA, 'PLS dice que no existe una transacción que sí registró (110).')
                : r(E.CANCELADA, 'La venta nunca llegó a PLS (110).');
        case 999:
            // Verificado 16/09 (2 de 2): consultar una venta cancelada con éxito devuelve 999 [ABIERTO R18].
            return fila.cancelOk
                ? r(E.CANCELADA, 'Cancelada (999 después de una cancelación acusada con 0).')
                : r(E.INDETERMINADA, 'Error no determinado de PLS (999).');
        case 11:
            // "Envíe datos nuevamente" NO se obedece solo: reenviar es abrir otra venta, y lo decide el cliente.
            if (fila.estado === E.ENVIADA || fila.estado === E.ESPERANDO_POS) return r(E.CANCELADA, 'Tiempo de transacción excedido sin captura (11).');
            return r(E.INDETERMINADA, 'Tiempo excedido (11) con la venta ya capturada.');
        default:
            if (RC_VALIDACION.has(rc)) return r(fila.estado, `La consulta fue rechazada por formato (ResponseCode ${rc}): la venta puede seguir viva.`);
            return r(E.INDETERMINADA, `ResponseCode fuera de tabla en la consulta: ${rc}.`);
    }
}

// Anexo 4 [SPEC p.54]. El 55 se deja afuera a propósito: es CREDITEL (crédito) y también
// CREDITEL PREPAGA / BPS (débito). 97 y 99 son billeteras ("no aplica").
const ISSUER_DEBITO = new Set(['07', '10', '11', '14', '15', '16', '19', '34', '35', '44', '54', '86']);
const ISSUER_CREDITO = new Set(['02', '04', '05', '08', '13', '21', '24', '52', '59', '74', '75']);

/**
 * Débito o crédito, para registrar el pago con el método que ya usa la caja.
 * Visto en homologación el 12/10/2026 con una Visa Débito real: CardAccountType vino "0" (igual que
 * en crédito), así que ese campo NO sirve para distinguir. Lo que sí vino: Issuer 34 (VISA DEBITO en
 * el Anexo 4) y el voucher del POS con "COMPRA DEBITO ONLINE". Orden de confianza:
 *   1. el voucher que arma el propio POS;  2. el emisor del Anexo 4;  3. tipo de cuenta o devolución
 *   de IVA (la Ley 19.210 no alcanza al crédito);  4. si nada lo dice, crédito.
 * @param {object} d { voucherXml, issuer, cardAccountType, taxAmountCentesimos }
 */
function esDebito(d) {
    const voucher = String(d.voucherXml || '');
    if (/COMPRA\s+D[EÉ]BITO/i.test(voucher)) return true;
    if (/COMPRA\s+CR[EÉ]DITO/i.test(voucher)) return false;
    const iss = String(d.issuer ?? '').trim();
    const issuer = /^\d$/.test(iss) ? `0${iss}` : iss; // los de un dígito van con 0 adelante [SPEC p.55]
    if (ISSUER_DEBITO.has(issuer)) return true;
    if (ISSUER_CREDITO.has(issuer)) return false;
    const cat = String(d.cardAccountType || '').trim();
    if (['10', '20', '80', '90'].includes(cat)) return true;
    return (d.taxAmountCentesimos || 0) > 0;
}

/**
 * ¿Este cobro pide la rebaja de IVA de la Ley 19.210 (TaxRefund 1)? Decisión del 12/10/2026:
 *   · solo e-Ticket (CFE 101) a consumidor final: con RUT va 0 (guía REST V1.6, preguntas frecuentes);
 *   · solo si la tarjeta paga la factura ENTERA, en su misma moneda: con pagos mixtos o con conversión
 *     no está claro sobre qué parte aplica la procesadora, y se cobra sin rebaja como hasta ahora;
 *   · con algo gravado (la rebaja es sobre el IVA).
 * La procesadora aplica la rebaja solo si la tarjeta es de débito; con crédito el pedido no cambia nada.
 * @returns {{ pedir: boolean, motivo: string }}
 */
function decidirRebaja({ tipoCFE, receptor, cantidadPagos, monedaDoc, monedaPos, totalDocCentesimos, montoPosCentesimos, gravadoCentesimos }) {
    const no = (motivo) => ({ pedir: false, motivo });
    if (Number(tipoCFE) !== 101) return no('No es un e-Ticket.');
    if (String(receptor || '').replace(/\D/g, '').length === 12) return no('El e-Ticket lleva RUT.');
    if (cantidadPagos !== 1) return no('La tarjeta no paga la factura entera (hay otros pagos).');
    if (Number(monedaDoc) !== Number(monedaPos)) return no('La tarjeta paga en otra moneda que la factura.');
    if (Math.abs(Number(totalDocCentesimos) - Number(montoPosCentesimos)) > 0) return no('El importe de la tarjeta no es el total de la factura.');
    if (!(Number(gravadoCentesimos) > 0)) return no('La factura no tiene nada gravado.');
    return { pedir: true, motivo: 'e-Ticket a consumidor final pagado entero con la tarjeta.' };
}

/**
 * Cómo se reparte un cobro aprobado con rebaja. TotalAmount puede venir como lo cobrado (neto) o como el
 * total: Resonet no lo aclara y en homologación la rebaja no se aplica (respuesta del 12/10/2026). Se
 * acepta cualquiera de las dos lecturas, pero siempre tiene que cerrar: tarjeta + rebaja = pedido.
 * @returns {{ ok: boolean, tarjetaCentesimos?: number, rebajaCentesimos?: number, motivo?: string }}
 */
function repartoConRebaja({ pedidoCentesimos, autorizadoCentesimos, rebajaCentesimos }) {
    const pedido = Number(pedidoCentesimos), aut = Number(autorizadoCentesimos), reb = Number(rebajaCentesimos || 0);
    if (!(reb > 0)) return aut === pedido ? { ok: true, tarjetaCentesimos: aut, rebajaCentesimos: 0 } : { ok: false, motivo: 'aprobado parcial' };
    if (aut + reb === pedido) return { ok: true, tarjetaCentesimos: aut, rebajaCentesimos: reb };   // TotalAmount = neto
    if (aut === pedido) return { ok: true, tarjetaCentesimos: pedido - reb, rebajaCentesimos: reb }; // TotalAmount = total
    return { ok: false, motivo: `la tarjeta (${aut / 100}) y la rebaja (${reb / 100}) no suman lo pedido (${pedido / 100})` };
}

module.exports = {
    decidirRebaja,
    repartoConRebaja,
    E,
    OCUPA_TERMINAL,
    LIBERA_REFERENCIAS,
    FINALES,
    A_POLEAR,
    interpretarAlta,
    interpretarConsulta,
    datosConsulta,
    filtrarRespuesta,
    esDebito,
};
