/**
 * poslinkClient.js — cliente REST de POSLink (Resonet). Solo habla HTTP: no toca la base
 * ni decide estados (eso es poslinkEstados.js / poslinkService.js).
 *
 * Verificado contra homologación el 16/09/2026 (docs/poslink-implementacion-plan.md, rev. 2.2):
 *   · Cada método es POST {POSLINK_URL}/{nombreDelMétodo} con cuerpo JSON.
 *   · La clave de la fecha es la de los ejemplos, `TransactionDateTimeyyyyMMddHHmmssSSS`.
 *     Con `TransactionDateTime` (la de la tabla) PLS devuelve -100.
 *   · InvoiceNumber tiene que ser numérico (alfanumérico da -100).
 *
 * Credenciales: solo del .env (POSLINK_URL, POSLINK_SYSTEM_ID). El SystemId nunca va a un log
 * ni sale al navegador: la spec no dice si es secreto [ABIERTO R2] y se trata como tal.
 */
const axios = require('axios');

const TIMEOUT_MS = 10000; // [SUPUESTO] ni la spec ni el código actual fijan uno

class PoslinkError extends Error {
    /**
     * @param {string} tipo 'CONFIG' | 'TIMEOUT' | 'RED' | 'HTTP' | 'RESPUESTA'
     *   TIMEOUT y RED = NO SABEMOS si PLS recibió el pedido. Nunca reintentar a ciegas una venta.
     */
    constructor(tipo, mensaje, extra = {}) {
        super(mensaje);
        this.tipo = tipo;
        Object.assign(this, extra);
    }
}

function config() {
    const url = (process.env.POSLINK_URL || '').replace(/\/+$/, '');
    const systemId = process.env.POSLINK_SYSTEM_ID || '';
    if (!url || !systemId) throw new PoslinkError('CONFIG', 'POSLink no configurado (POSLINK_URL / POSLINK_SYSTEM_ID).');
    return { url, systemId };
}

function estaConfigurado() {
    return !!(process.env.POSLINK_URL && process.env.POSLINK_SYSTEM_ID);
}

/** yyyyMMddHHmmssSSS en hora de Uruguay (UTC-3, sin horario de verano), sin importar el TZ del servidor. */
function fechaPls(d = new Date()) {
    const uy = new Date(d.getTime() - 3 * 60 * 60 * 1000);
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${uy.getUTCFullYear()}${p(uy.getUTCMonth() + 1)}${p(uy.getUTCDate())}`
        + `${p(uy.getUTCHours())}${p(uy.getUTCMinutes())}${p(uy.getUTCSeconds())}${p(uy.getUTCMilliseconds(), 3)}`;
}

/** Monto con dos decimales sin puntos ni comas [SPEC p.23]: 1200.50 → "120050". Recibe centésimos enteros. */
function montoPls(centesimos) {
    const n = Number(centesimos);
    if (!Number.isSafeInteger(n) || n < 0) throw new PoslinkError('CONFIG', `Monto inválido: ${centesimos}`);
    return String(n);
}

/**
 * PLS devuelve importes en formatos distintos según el método: "10000", "0000919000" (lote),
 * "0.00" (TaxAmount del ejemplo de la spec). Sin separador = centésimos; con separador = pesos.
 */
function centesimosDe(valor) {
    if (valor === null || valor === undefined) return null;
    const s = String(valor).trim();
    if (!s) return null;
    if (/[.,]/.test(s)) {
        const n = parseFloat(s.replace(',', '.'));
        return Number.isFinite(n) ? Math.round(n * 100) : null;
    }
    return /^\d+$/.test(s) ? parseInt(s, 10) : null;
}

// TransactionId puede tener 19 dígitos [SPEC p.24]: JSON.parse lo redondearía en silencio.
// Al serializar va SIN comillas (es `long` en la spec) armado desde el string; al leer, se
// le ponen comillas antes del parse. Igual siempre se usa STransactionId cuando viene.
const RAW = '__POSLINK_RAW_NUM__';
function serializar(body) {
    return JSON.stringify(body).replace(new RegExp(`"${RAW}(\\d+)"`, 'g'), '$1');
}
function parsear(texto) {
    if (texto && typeof texto === 'object') return texto;
    const seguro = String(texto || '').replace(/("TransactionId"\s*:\s*)(-?\d{15,})/g, '$1"$2"');
    return JSON.parse(seguro);
}

/** Lee un campo sin importar mayúsculas (la spec alterna StransactionId / STransactionId). */
function campo(obj, nombre) {
    if (!obj || typeof obj !== 'object') return undefined;
    if (nombre in obj) return obj[nombre];
    const k = Object.keys(obj).find(x => x.toLowerCase() === nombre.toLowerCase());
    return k === undefined ? undefined : obj[k];
}

function transactionIdDe(resp) {
    const s = campo(resp, 'STransactionId');
    if (s !== undefined && s !== null && String(s).trim()) return String(s).trim();
    const n = campo(resp, 'TransactionId');
    return (n !== undefined && n !== null && String(n).trim()) ? String(n).trim() : null;
}

function responseCodeDe(resp) {
    const rc = campo(resp, 'ResponseCode');
    if (rc === undefined || rc === null || rc === '') return null;
    const n = Number(rc);
    return Number.isFinite(n) ? n : null;
}

async function llamar(metodo, body) {
    const { url } = config();
    let res;
    try {
        res = await axios.post(`${url}/${metodo}`, serializar(body), {
            timeout: TIMEOUT_MS,
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            transformResponse: [d => d],     // texto crudo: el parse lo hace parsear() (TransactionId)
            validateStatus: () => true,
        });
    } catch (e) {
        const timeout = e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT' || /timeout/i.test(e.message || '');
        throw new PoslinkError(timeout ? 'TIMEOUT' : 'RED', `POSLink ${metodo}: ${e.message}`, { metodo });
    }
    let data = null;
    try { data = parsear(res.data); } catch (e) { data = null; }
    if (res.status < 200 || res.status >= 300) {
        throw new PoslinkError('HTTP', `POSLink ${metodo}: HTTP ${res.status}`, { metodo, status: res.status, data });
    }
    if (!data || typeof data !== 'object') {
        throw new PoslinkError('RESPUESTA', `POSLink ${metodo}: respuesta no es JSON`, { metodo, status: res.status });
    }
    return data;
}

/** Datos comunes de todo pedido atado a una terminal. */
function base(terminal, fecha) {
    const { systemId } = config();
    return {
        PosID: String(terminal.posId),
        SystemId: systemId,
        Branch: String(terminal.branch),
        ClientAppId: String(terminal.clientAppId),
        UserId: String(terminal.userId || 'SISTEMA').slice(0, 100),
        TransactionDateTimeyyyyMMddHHmmssSSS: fecha,
    };
}

function conTransactionId(body, transactionId) {
    const tx = String(transactionId || '');
    if (!/^\d+$/.test(tx)) throw new PoslinkError('CONFIG', `TransactionId inválido: ${transactionId}`);
    return { ...body, TransactionId: `${RAW}${tx}`, STransactionId: tx };
}

/**
 * processFinancialPurchase [SPEC p.23-25]. Venta simple: NeedToReadCard false, Quotas 0
 * (con tarjeta de crédito el POS le pide las cuotas al cliente en su pantalla; la guía lo marca
 * "NO RECOMENDADO" sin decir por qué; pedido por Santiago el 14/10), Plan 0, sin propina.
 * @param {object} factura  null → TaxRefund 0, sin InvoiceNumber (verificado: PLS lo acepta).
 *                          { numero, montoCentesimos, gravadoCentesimos, taxRefund } → devolución.
 */
async function venta({ terminal, fecha, montoCentesimos, monedaISO, factura }) {
    const body = {
        ...base(terminal, fecha),
        Amount: montoPls(montoCentesimos),
        Quotas: 0,
        Plan: 0,
        Currency: String(monedaISO),
        TaxRefund: factura ? Number(factura.taxRefund) : 0,
        // [SUPUESTO] sin devolución, gravado = total: con TaxRefund 0 el campo es informativo.
        TaxableAmount: montoPls(factura ? factura.gravadoCentesimos : montoCentesimos),
        InvoiceAmount: montoPls(factura ? factura.montoCentesimos : montoCentesimos),
        NeedToReadCard: false,
    };
    if (factura && factura.numero) {
        const nro = String(factura.numero);
        if (!/^\d{1,7}$/.test(nro)) throw new PoslinkError('CONFIG', `InvoiceNumber debe ser numérico de hasta 7 dígitos: ${nro}`);
        body.InvoiceNumber = nro;
    }
    return llamar('processFinancialPurchase', body);
}

/**
 * processFinancialPurchaseQuery [SPEC p.29-32]. Entre consultas: 2 a 3 segundos.
 * [SUPUESTO] la fecha que se manda es la de la venta original (la spec dice "Fecha de la
 * transacción"); se confirma en homologación con la terminal.
 */
async function consulta({ terminal, fecha, transactionId }) {
    return llamar('processFinancialPurchaseQuery', conTransactionId(base(terminal, fecha), transactionId));
}

/** cancelFinancialPurchase [SPEC p.33]. Solo vale mientras el POS no tomó la venta [SPEC p.12]. */
async function cancelar({ terminal, fecha, transactionId }) {
    return llamar('cancelFinancialPurchase', conTransactionId(base(terminal, fecha), transactionId));
}

/**
 * processFinancialReverse [SPEC p.39]. Reversa la ÚLTIMA operación del POS. El 0 es acuse de
 * encolado, no de reversión: viaja con la próxima operación online de esa terminal [SPEC p.17].
 */
async function reversar({ terminal, fecha, transactionId }) {
    return llamar('processFinancialReverse', conTransactionId(base(terminal, fecha), transactionId));
}

/**
 * processFinancialPurchaseVoidByTicket [guía V1.6 p.31]: anula una venta del lote ABIERTO, por el total.
 * Se identifica con el ticket y el adquirente de la venta original. El POS pide la tarjeta.
 */
async function anulacion({ terminal, fecha, ticket, acquirer }) {
    if (!ticket || acquirer == null || acquirer === '') throw new PoslinkError('CONFIG', 'Falta el ticket o el adquirente de la venta original.');
    return llamar('processFinancialPurchaseVoidByTicket', {
        ...base(terminal, fecha),
        TicketNumber: String(ticket),
        Acquirer: String(acquirer),
    });
}

/**
 * processFinancialPurchaseRefund [guía V1.6 p.33-34]: devuelve, total o parcial, una venta de un lote
 * CERRADO. Va con la fecha (yyMMdd) y el ticket de la venta original. El POS pide la tarjeta.
 * @param {object} factura  null → TaxRefund 0. Con rebaja de IVA: { numero (la nota de crédito, reservada
 *                          antes como en la venta), montoCentesimos, gravadoCentesimos, taxRefund }.
 */
async function devolucion({ terminal, fecha, montoCentesimos, monedaISO, ticket, fechaOriginal, factura }) {
    if (!ticket || !/^\d{6}$/.test(String(fechaOriginal || ''))) throw new PoslinkError('CONFIG', 'Falta el ticket o la fecha (yyMMdd) de la venta original.');
    const body = {
        ...base(terminal, fecha),
        OriginalTransactionDateyyMMdd: String(fechaOriginal),
        TicketNumber: String(ticket),
        Amount: montoPls(montoCentesimos),
        Currency: String(monedaISO),
        Quotas: 1,
        Plan: 0,
        TaxRefund: factura ? Number(factura.taxRefund) : 0,
        TaxableAmount: montoPls(factura ? factura.gravadoCentesimos : montoCentesimos),
        InvoiceAmount: montoPls(factura ? factura.montoCentesimos : montoCentesimos),
        NeedToReadCard: false,
    };
    if (factura && factura.numero) {
        const nro = String(factura.numero);
        if (!/^\d{1,7}$/.test(nro)) throw new PoslinkError('CONFIG', `InvoiceNumber debe ser numérico de hasta 7 dígitos: ${nro}`);
        body.InvoiceNumber = nro;
    }
    return llamar('processFinancialPurchaseRefund', body);
}

/**
 * processCurrentTransactionsBatchQuery [SPEC p.45-46]: todas las transacciones del lote abierto.
 * La tabla dice que la lista viene en `Transactions` y el ejemplo la trae en `QueryTransaction`, pero
 * homologación la devuelve en `QueryTransactionsCurrentBatchTransaction` (visto el 12/10/2026 con la
 * terminal 22224675). Se toma la primera lista que venga, se llame como se llame. Ojo: ahí `State` vino
 * "X" (no un número del Anexo 8) y los ítems no traen STransactionId.
 */
async function loteActual({ terminal }) {
    const data = await llamar('processCurrentTransactionsBatchQuery', base(terminal, fechaPls()));
    const lista = campo(data, 'QueryTransactionsCurrentBatchTransaction') || campo(data, 'Transactions') || campo(data, 'QueryTransaction')
        || Object.values(data || {}).find(v => Array.isArray(v)) || [];
    // Con el lote recién cerrado (sin transacciones) PLS contesta {"ResponseCode":110} ("no existe
    // transacción", SPEC p.50), no 0 con lista vacía. Visto en homologación el 13/10 tras cerrar el lote.
    const rc = responseCodeDe(data);
    if (rc === 110) return { responseCode: 0, transacciones: [], vacio: true, crudo: data };
    return { responseCode: rc, transacciones: Array.isArray(lista) ? lista : [], crudo: data };
}

module.exports = {
    PoslinkError,
    estaConfigurado,
    fechaPls,
    centesimosDe,
    campo,
    transactionIdDe,
    responseCodeDe,
    venta,
    consulta,
    cancelar,
    reversar,
    anulacion,
    devolucion,
    loteActual,
    _interno: { serializar, parsear, montoPls },
};
