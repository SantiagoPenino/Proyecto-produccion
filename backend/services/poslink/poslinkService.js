/**
 * poslinkService.js — cobro con tarjeta integrado a POSLink (Resonet). F1 del plan:
 * docs/poslink-implementacion-plan.md (rev. 2.2). Sin pantallas: las usan después la caja (F2)
 * y los tótems (F3).
 *
 * Los cinco invariantes (§4.1), y dónde se cumplen acá:
 *   1. La fila existe antes que el cobro ........ iniciarVenta: INSERT (CREADA + referencias) y recién
 *                                                 después processFinancialPurchase.
 *   2. Una operación por terminal (candado A) .... índice filtrado UQ_PosTransacciones_TerminalOcupada.
 *   3. Lo cobrado no está en dos cobros (cand. B)  índice filtrado de PosTransaccionReferencias; la marca
 *                                                 se apaga en la misma transacción SQL que el estado.
 *   4. Cobrado y registrado: gana uno solo ....... claims con UPDATE ... OUTPUT DELETED (PtxAprobadaAt,
 *                                                 PtxReversaPedidaAt).
 *   5. La intención se revalida en el claim ...... revalidar() antes de procesarTransaccion.
 *
 * Regla estructural (§4.5 vector 2): ninguna llamada a PLS va dentro de una transacción SQL ni de un
 * bloque que se reintente por deadlock.
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getPool, sql } = require('../../config/db');
const logger = require('../../utils/logger');
const { rollbackSeguro } = require('../../utils/rollbackSeguro');
const { esDeadlock } = require('../../utils/reintentarDeadlock');
const cliente = require('./poslinkClient');
const {
    E, LIBERA_REFERENCIAS, A_POLEAR,
    interpretarAlta, interpretarConsulta, filtrarRespuesta, esDebito, decidirRebaja, repartoConRebaja,
} = require('./poslinkEstados');

const LOG = '[POSLINK]';
const METODO_DEBITO = Number(process.env.POSLINK_METODO_DEBITO_ID) || 3;   // MetodosPagos 'Débito'
const METODO_CREDITO = Number(process.env.POSLINK_METODO_CREDITO_ID) || 4; // MetodosPagos 'Crédito'
const USUARIO_SISTEMA = 999;          // mismo usuario técnico que los webhooks de Handy y MP
const MINUTOS_CLAIM_COLGADO = 10;     // un registro que ganó el claim y no terminó en este tiempo murió
const TIPOS_REFERENCIA = new Set(['ORDEN', 'RETIRO', 'DOCUMENTO']);

// ─────────────────────────────────────────────────────────────────────────────
// Esquema
// ─────────────────────────────────────────────────────────────────────────────
let esquemaListo = false;
async function asegurarEsquema(pool) {
    if (esquemaListo) return;
    const archivo = path.join(__dirname, '..', '..', 'scripts', 'sql', 'poslink_2026-10-12.sql');
    const lotes = fs.readFileSync(archivo, 'utf8')
        .split(/^\s*GO\s*$/m)
        .map(s => s.trim())
        .filter(s => s && !/^(--[^\n]*\n?\s*)+$/.test(s));
    for (const lote of lotes) await pool.request().batch(lote);
    esquemaListo = true;
}

async function pool_() {
    const pool = await getPool();
    await asegurarEsquema(pool);
    return pool;
}

// ─────────────────────────────────────────────────────────────────────────────
// Terminales
// ─────────────────────────────────────────────────────────────────────────────
function terminalPls(t, usuarioId) {
    return {
        posId: t.PtePosID,
        branch: t.PteBranch,
        clientAppId: t.PteClientAppId,
        userId: usuarioId ? String(usuarioId) : t.PteEtiqueta,
    };
}

async function obtenerTerminal(pool, { id, etiqueta }) {
    const r = await pool.request()
        .input('Id', sql.Int, id || null)
        .input('Et', sql.VarChar(50), etiqueta || null)
        .query(`SELECT * FROM dbo.PosTerminales WHERE (@Id IS NOT NULL AND PteIdTerminal = @Id) OR (@Id IS NULL AND PteEtiqueta = @Et)`);
    return r.recordset[0] || null;
}

/**
 * Alta de una terminal. Queda INACTIVA hasta una venta de prueba que aparezca en SU pantalla (§8
 * riesgo 12). Probado en homologación el 12/10: con PosID 99999999 PLS acepta la venta y la deja
 * esperando sin que nadie la tome; con otros inventados (99999998, 12345678) devuelve 999 sin
 * TransactionId. Ninguno de los dos casos dice "PosID inválido": solo la prueba lo confirma.
 */
async function altaTerminal({ etiqueta, posId, tipo, descripcion, clientAppId, branch }) {
    const pool = await pool_();
    if (!etiqueta || !posId) throw new Error('Etiqueta y PosID son obligatorios.');
    if (!['TOTEM', 'CAJA'].includes(tipo)) throw new Error("Tipo de terminal: 'TOTEM' o 'CAJA'.");
    const r = await pool.request()
        .input('Et', sql.VarChar(50), String(etiqueta).toUpperCase())
        .input('App', sql.VarChar(100), String(clientAppId || process.env.POSLINK_CLIENT_APP_ID || ''))
        .input('Pos', sql.VarChar(10), String(posId))
        .input('Br', sql.VarChar(100), String(branch || process.env.POSLINK_BRANCH || ''))
        .input('Desc', sql.NVarChar(200), descripcion || null)
        .input('Tipo', sql.VarChar(20), tipo)
        .query(`
            INSERT INTO dbo.PosTerminales (PteEtiqueta, PteClientAppId, PtePosID, PteBranch, PteDescripcion, PteTipo, PteActivo)
            OUTPUT INSERTED.*
            VALUES (@Et, @App, @Pos, @Br, @Desc, @Tipo, 0)`);
    const t = r.recordset[0];
    if (!t.PteClientAppId || !t.PteBranch) throw new Error('Faltan ClientAppId / Branch (POSLINK_CLIENT_APP_ID / POSLINK_BRANCH en el .env).');
    logger.info(`${LOG} Terminal ${t.PteEtiqueta} dada de alta (PosID ${t.PtePosID}), INACTIVA hasta la venta de prueba.`);
    return t;
}

async function activarTerminal(id, activa = true) {
    const pool = await pool_();
    await pool.request().input('Id', sql.Int, id).input('A', sql.Bit, activa ? 1 : 0)
        .query('UPDATE dbo.PosTerminales SET PteActivo = @A WHERE PteIdTerminal = @Id');
}

// ─────────────────────────────────────────────────────────────────────────────
// Filas y transiciones
// ─────────────────────────────────────────────────────────────────────────────
async function leerFila(pool, { uuid, id }) {
    const r = await pool.request()
        .input('U', sql.VarChar(100), uuid || null)
        .input('Id', sql.BigInt, id || null)
        .query(`
            SELECT p.*,
                   -- La terminal como era al cobrar (si se renombró o cambió de tipo, el cobro no cambia).
                   COALESCE(p.PtxTerminalEtiqueta, t.PteEtiqueta) AS PteEtiqueta,
                   COALESCE(p.PtxTerminalTipo, t.PteTipo) AS PteTipo,
                   t.PteBranch, t.PteClientAppId, t.PtePosID,
                   tc.TcaSerieDoc, tc.TcaNumeroDoc
            FROM dbo.PosTransacciones p
            JOIN dbo.PosTerminales t ON t.PteIdTerminal = p.PtxIdTerminal
            LEFT JOIN dbo.TransaccionesCaja tc ON tc.TcaIdTransaccion = p.PtxTcaIdTransaccion
            WHERE (@U IS NOT NULL AND p.PtxUuid = @U) OR (@U IS NULL AND p.PtxId = @Id)`);
    return r.recordset[0] || null;
}

function filaParaEstados(f) {
    return {
        estado: f.PtxEstado,
        transactionId: f.PtxTransactionId,
        cancelOk: !!f.PtxCancelOkAt,
        esTotem: f.PteTipo === 'TOTEM',
    };
}

/** La terminal de la FILA (su PosID desnormalizado), no la de hoy: la terminal pudo reasignarse. */
function terminalDeFila(f) {
    return { posId: f.PtxPosID, branch: f.PteBranch, clientAppId: f.PteClientAppId, userId: f.PtxUsuarioId ? String(f.PtxUsuarioId) : f.PteEtiqueta };
}

/**
 * Cambia el estado SOLO si la fila sigue en uno de `desde` (concurrencia optimista: el poleo en
 * vivo y el barrido pueden mirar la misma fila). Si el estado nuevo libera el candado B, la marca
 * se apaga en la misma transacción SQL. Devuelve true si cambió.
 */
async function cambiarEstado(pool, ptxId, desde, hacia, campos = {}) {
    const tx = new sql.Transaction(pool);
    try {
        await tx.begin();
        const req = new sql.Request(tx)
            .input('Id', sql.BigInt, ptxId)
            .input('Hacia', sql.VarChar(30), hacia);
        const sets = ['PtxEstado = @Hacia', 'PtxUpdatedAt = GETDATE()'];
        const tipos = {
            PtxTransactionId: sql.VarChar(30), PtxResponseCode: sql.Int, PtxPosResponseCode: sql.VarChar(10),
            PtxState: sql.Int, PtxAuthorizationCode: sql.VarChar(20), PtxTicket: sql.VarChar(50), PtxBatch: sql.VarChar(10),
            PtxAcquirer: sql.VarChar(10), PtxIssuer: sql.VarChar(10), PtxCardNumber: sql.VarChar(50),
            PtxCardAccountType: sql.VarChar(20), PtxAcquirerTerminal: sql.VarChar(10),
            PtxRemainingExpTime: sql.Decimal(10, 2), PtxMontoAutorizadoCentesimos: sql.BigInt,
            PtxTaxAmountCentesimos: sql.BigInt, PtxRespuestaJson: sql.NVarChar(sql.MAX),
            PtxTcaIdTransaccion: sql.Int, PtxPagIdPago: sql.Int, PtxRequiereRevision: sql.Bit,
        };
        for (const [k, v] of Object.entries(campos)) {
            if (v === undefined) continue;
            if (k === 'nota') continue;
            if (!tipos[k]) throw new Error(`Campo no permitido: ${k}`);
            req.input(k, tipos[k], v);
            sets.push(`${k} = @${k}`);
        }
        if (campos.nota) {
            req.input('Nota', sql.NVarChar(1000), campos.nota);
            sets.push(`PtxObservaciones = LEFT(CONCAT(PtxObservaciones, CASE WHEN PtxObservaciones IS NULL THEN '' ELSE ' | ' END, CONVERT(VARCHAR(16), GETDATE(), 120), ' ', @Nota), 1000)`);
        }
        if (hacia === E.REGISTRADA) sets.push('PtxRegistradaAt = GETDATE()');
        const desdeSql = desde.map((d, i) => { req.input(`D${i}`, sql.VarChar(30), d); return `@D${i}`; }).join(',');
        const r = await req.query(`UPDATE dbo.PosTransacciones SET ${sets.join(', ')} WHERE PtxId = @Id AND PtxEstado IN (${desdeSql})`);
        const cambio = (r.rowsAffected?.[0] || 0) === 1;
        if (cambio && LIBERA_REFERENCIAS.has(hacia)) {
            await new sql.Request(tx).input('Id', sql.BigInt, ptxId)
                .query('UPDATE dbo.PosTransaccionReferencias SET PtrActiva = 0 WHERE PtrIdPtx = @Id AND PtrActiva = 1');
        }
        await tx.commit();
        if (cambio && hacia !== desde[0]) logger.info(`${LOG} #${ptxId} ${desde.join('|')} → ${hacia}${campos.nota ? ` (${campos.nota})` : ''}`);
        // No se cobró nada: el número de factura reservado (si lo hay) se anula en SISNET. Sin esperar:
        // es una llamada de red, y si falla la reintenta el barrido.
        if (cambio && NO_COBRO_FINAL.has(hacia)) void anularCaeDeFila(pool, ptxId);
        return cambio;
    } catch (e) {
        await rollbackSeguro(tx, `poslink cambiarEstado #${ptxId} → ${hacia}`);
        throw e;
    }
}

function camposDeConsulta(datos, resp) {
    return {
        PtxResponseCode: datos.responseCode,
        PtxPosResponseCode: datos.posResponseCode,
        PtxState: datos.state,
        PtxAuthorizationCode: datos.authorizationCode,
        PtxTicket: datos.ticket,
        PtxBatch: datos.batch,
        PtxAcquirer: datos.acquirer,
        PtxIssuer: datos.issuer,
        PtxCardNumber: datos.cardNumber,
        PtxCardAccountType: datos.cardAccountType,
        PtxAcquirerTerminal: datos.acquirerTerminal,
        PtxRemainingExpTime: datos.remainingExpirationTime,
        PtxMontoAutorizadoCentesimos: datos.montoAutorizadoCentesimos,
        PtxTaxAmountCentesimos: datos.taxAmountCentesimos,
        PtxRespuestaJson: JSON.stringify(filtrarRespuesta(resp)),
    };
}

/** Ticket a Finanzas (el mismo de los cobros online). Best-effort: nunca corta el flujo. */
async function alertar(pool, fila, asunto, texto) {
    try {
        const { crearTicketFinanzas } = require('../../controllers/webOrdersController');
        const monto = fila ? `${fila.PtxMonedaId === 2 ? 'US$' : '$'} ${(Number(fila.PtxMontoCentesimos) / 100).toFixed(2)}` : '';
        const cab = fila
            ? `Cobro POS ${fila.PtxUuid} — terminal ${fila.PteEtiqueta} (PosID ${fila.PtxPosID}) — ${monto}`
              + `${fila.PtxTransactionId ? ` — TransactionId ${fila.PtxTransactionId}` : ''}\n\n`
            : '';
        await crearTicketFinanzas(pool, fila?.PtxClienteId || null, asunto, cab + texto);
    } catch (e) {
        logger.error(`${LOG} No se pudo crear el ticket de alerta (${asunto}): ${e.message}`);
    }
}

async function marcarRevision(pool, fila, nota) {
    await pool.request().input('Id', sql.BigInt, fila.PtxId).input('Nota', sql.NVarChar(1000), nota)
        .query(`UPDATE dbo.PosTransacciones SET PtxRequiereRevision = 1, PtxUpdatedAt = GETDATE(),
                    PtxObservaciones = LEFT(CONCAT(PtxObservaciones, CASE WHEN PtxObservaciones IS NULL THEN '' ELSE ' | ' END, CONVERT(VARCHAR(16), GETDATE(), 120), ' ', @Nota), 1000)
                WHERE PtxId = @Id`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Número de factura reservado (Ley 19.210): ver sisnetService.reservarNumero
// ─────────────────────────────────────────────────────────────────────────────
/** Estados finales en los que es seguro que no se cobró nada: el número reservado se anula. */
const NO_COBRO_FINAL = new Set([E.RECHAZADA, E.CANCELADA, E.ERROR_VALIDACION, E.REVERSADA]);

/** Empresa emisora: la del cobro, o la por defecto (mismo criterio que la Bandeja CFE). */
async function empresaEmisora(pool, empresaId) {
    if (empresaId) {
        const r = await pool.request().input('E', sql.Int, empresaId).query('SELECT * FROM dbo.Empresas WHERE EmpIdEmpresa = @E');
        if (r.recordset[0]) return r.recordset[0];
    }
    const d = await pool.request().query('SELECT TOP 1 * FROM dbo.Empresas WHERE EmpPorDefecto = 1 ORDER BY EmpIdEmpresa');
    return d.recordset[0] || null;
}

/** Anula en SISNET un número reservado. Nunca lanza: devuelve true/false y deja el motivo en el log. */
async function anularCaeReservado(wsCAE, empresaId, contexto) {
    try {
        const pool = await getPool();
        const sisnet = require('../sisnetService');
        await sisnet.anularNumero(wsCAE, await empresaEmisora(pool, empresaId));
        logger.info(`${LOG} Número ${wsCAE.serie}-${wsCAE.numero} anulado en SISNET (${contexto}).`);
        return true;
    } catch (e) {
        logger.error(`${LOG} No se pudo anular el número ${wsCAE?.serie}-${wsCAE?.numero} en SISNET (${contexto}): ${e.message}`);
        return false;
    }
}

/** Anula el número reservado de un cobro que terminó sin cobrar. Lo llaman cambiarEstado y el barrido. */
async function anularCaeDeFila(pool, ptxId) {
    try {
        const r = await pool.request().input('Id', sql.BigInt, ptxId)
            .query(`SELECT PtxCaeJson, PtxCaeEstado, PtxEstado, PtxIntencionJson FROM dbo.PosTransacciones WHERE PtxId = @Id`);
        const f = r.recordset[0];
        if (!f || !f.PtxCaeJson || !['RESERVADO', 'ERROR_ANULAR'].includes(f.PtxCaeEstado) || !NO_COBRO_FINAL.has(f.PtxEstado)) return;
        let empresaId = null;
        try { empresaId = JSON.parse(f.PtxIntencionJson || '{}').empresaId || null; } catch (e) { empresaId = null; }
        const ok = await anularCaeReservado(JSON.parse(f.PtxCaeJson), empresaId, `cobro #${ptxId} ${f.PtxEstado}`);
        await pool.request().input('Id', sql.BigInt, ptxId).input('Est', sql.VarChar(20), ok ? 'ANULADO' : 'ERROR_ANULAR')
            .query(`UPDATE dbo.PosTransacciones SET PtxCaeEstado = @Est, PtxUpdatedAt = GETDATE() WHERE PtxId = @Id AND PtxCaeEstado IN ('RESERVADO','ERROR_ANULAR')`);
    } catch (e) {
        logger.error(`${LOG} Anulación del número reservado del cobro #${ptxId}: ${e.message}`);
    }
}

/**
 * ¿Este documento salió de un cobro con POS que reservó su número? La Bandeja CFE lo pregunta antes de
 * emitir. No toca el esquema: si POSLink nunca se usó en esta base (producción hoy), no hay nada.
 * @returns {Promise<{ wsCAE, ptxId } | null>}
 */
async function caeReservadoDeDocumento(docId) {
    const pool = await getPool();
    const ex = await pool.request().query(`SELECT COL_LENGTH('dbo.PosTransacciones', 'PtxCaeJson') AS c`);
    if (ex.recordset[0].c == null) return null;
    const r = await pool.request().input('Doc', sql.Int, Number(docId)).query(`
        SELECT TOP 1 p.PtxId, p.PtxCaeJson
        FROM dbo.PosTransacciones p
        JOIN dbo.DocumentosContables d ON d.TcaIdTransaccion = p.PtxTcaIdTransaccion
        WHERE d.DocIdDocumento = @Doc AND p.PtxCaeEstado = 'RESERVADO' AND p.PtxCaeJson IS NOT NULL`);
    const f = r.recordset[0];
    return f ? { ptxId: f.PtxId, wsCAE: JSON.parse(f.PtxCaeJson) } : null;
}

async function marcarCaeUsado(ptxId, docId) {
    const pool = await getPool();
    await pool.request().input('Id', sql.BigInt, ptxId).input('Doc', sql.Int, docId || null)
        .query(`UPDATE dbo.PosTransacciones SET PtxCaeEstado = 'USADO', PtxDocIdDocumento = ISNULL(@Doc, PtxDocIdDocumento), PtxUpdatedAt = GETDATE() WHERE PtxId = @Id`);
}

/**
 * Emite la factura de un cobro registrado con el número que se reservó y viajó al POS. Si falla (SISNET
 * caído, validación), el documento queda en la Bandeja CFE y al mandarlo desde ahí usa el mismo número.
 */
async function emitirFacturaReservada(pool, fila) {
    if (!fila.PtxCaeJson || fila.PtxCaeEstado !== 'RESERVADO' || !fila.PtxTcaIdTransaccion) return;
    try {
        const d = await pool.request().input('T', sql.Int, fila.PtxTcaIdTransaccion)
            .query('SELECT TOP 1 DocIdDocumento FROM dbo.DocumentosContables WHERE TcaIdTransaccion = @T ORDER BY DocIdDocumento');
        const docId = d.recordset[0]?.DocIdDocumento;
        if (!docId) throw new Error('el cobro no generó documento');
        await pool.request().input('Id', sql.BigInt, fila.PtxId).input('Doc', sql.Int, docId)
            .query('UPDATE dbo.PosTransacciones SET PtxDocIdDocumento = @Doc WHERE PtxId = @Id');
        const { emitirDocumento } = require('../../controllers/cfeController');
        const r = await emitirDocumento(docId, { wsCAE: JSON.parse(fila.PtxCaeJson) });
        await marcarCaeUsado(fila.PtxId, docId);
        logger.info(`${LOG} #${fila.PtxId}: factura emitida con el número reservado (${r.numeroOficial}).`);
    } catch (e) {
        const wsCAE = JSON.parse(fila.PtxCaeJson);
        logger.error(`${LOG} #${fila.PtxId}: no se emitió la factura con el número reservado ${wsCAE.serie}-${wsCAE.numero}: ${e.message}`);
        await marcarRevision(pool, fila, `Factura sin emitir (número reservado ${wsCAE.serie}-${wsCAE.numero}): ${e.message}`);
        await alertar(pool, fila, `Cobro con tarjeta: factura sin emitir (${fila.PteEtiqueta})`,
            `El cobro quedó registrado, pero la factura no se pudo emitir: ${e.message}\n\n`
            + `Hay que mandarla desde la Bandeja CFE: sale sola con el número reservado ${wsCAE.serie}-${wsCAE.numero}, `
            + `que es el que el POS le informó a la procesadora. No emitirla con otro número.`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Venta
// ─────────────────────────────────────────────────────────────────────────────
class CobroPosError extends Error {
    constructor(codigo, mensaje) { super(mensaje); this.codigo = codigo; }
}

/**
 * Inicia un cobro en una terminal. Devuelve en cuanto PLS acusa la venta (o la rechaza): el
 * resultado de la tarjeta se sigue con polear(uuid) cada 2-3 s, y el barrido cubre lo que
 * nadie polea.
 *
 * @param {object} p
 * @param {number|string} p.terminal  PteIdTerminal o etiqueta ('CAJA1')
 * @param {number} p.montoCentesimos   lo que se cobra en la tarjeta, calculado en el BACKEND
 * @param {number} p.monedaId          1 pesos | 2 dólares
 * @param {number} p.clienteId         CliIdCliente
 * @param {number} [p.usuarioId]       quien cobra (la cajera); null en el tótem
 * @param {Array}  p.referencias       [{ tipo: 'ORDEN'|'RETIRO'|'DOCUMENTO', id }] — candado B
 * @param {object} p.intencion         { header, aplicaciones } para procesarTransaccion (sin pagos:
 *                                     el pago se arma con lo AUTORIZADO al registrar)
 * @param {object} [p.factura]         { numero, montoCentesimos, gravadoCentesimos, taxRefund } —
 *                                     devolución de IVA (Ley 19.210 = 1). Va en F2, con la factura
 *                                     emitida antes de cobrar (decisión del 12/10/2026).
 * @param {boolean} [p.prueba]         venta de prueba para habilitar una terminal inactiva
 */
async function iniciarVenta(p) {
    const pool = await pool_();
    const terminal = await obtenerTerminal(pool, typeof p.terminal === 'number' ? { id: p.terminal } : { etiqueta: p.terminal });
    if (!terminal) throw new CobroPosError('TERMINAL_INEXISTENTE', `No existe la terminal ${p.terminal}.`);
    if (!terminal.PteActivo && !p.prueba) throw new CobroPosError('TERMINAL_INACTIVA', `La terminal ${terminal.PteEtiqueta} no está habilitada.`);

    const monto = Number(p.montoCentesimos);
    if (!Number.isSafeInteger(monto) || monto <= 0) throw new CobroPosError('MONTO_INVALIDO', `Monto inválido: ${p.montoCentesimos}`);
    if (![1, 2].includes(Number(p.monedaId))) throw new CobroPosError('MONEDA_INVALIDA', `Moneda inválida: ${p.monedaId}`);
    const referencias = p.referencias || [];
    if (!p.prueba && !referencias.length) throw new CobroPosError('SIN_REFERENCIAS', 'Un cobro tiene que decir qué cobra (candado B).');
    for (const r of referencias) {
        if (!TIPOS_REFERENCIA.has(r.tipo) || !Number.isInteger(Number(r.id))) throw new CobroPosError('REFERENCIA_INVALIDA', `Referencia inválida: ${JSON.stringify(r)}`);
    }
    if (!p.prueba && (!p.intencion?.header || !p.intencion?.aplicaciones?.length)) {
        throw new CobroPosError('SIN_INTENCION', 'Falta la intención de cobro (header + aplicaciones).');
    }

    // Recuperación al inicio (§4.4 c): antes de abrir otra venta en esta terminal, resolver lo que
    // haya quedado abierto en ella. Si sigue ocupada, el candado A rechaza el INSERT de abajo.
    await resolverAbiertasDeTerminal(pool, terminal.PteIdTerminal);

    // Si hay una reversa encolada, esta venta es la que la hace viajar (§4.4 b).
    const rev = await pool.request().input('T', sql.Int, terminal.PteIdTerminal)
        .query(`SELECT TOP 1 PtxId FROM dbo.PosTransacciones WHERE PtxIdTerminal = @T AND PtxEstado = 'REVERSA_PENDIENTE' ORDER BY PtxId DESC`);
    const drenaDe = rev.recordset[0]?.PtxId || null;

    const uuid = uuidv4();
    const fecha = cliente.fechaPls();
    const monedaISO = Number(p.monedaId) === 2 ? '840' : '858';
    const factura = p.factura || null;

    // Invariante 1: la fila y el candado B existen ANTES de hablar con PLS, en una sola transacción.
    let ptxId;
    const tx = new sql.Transaction(pool);
    try {
        await tx.begin();
        const ins = await new sql.Request(tx)
            .input('Uuid', sql.VarChar(100), uuid)
            .input('Term', sql.Int, terminal.PteIdTerminal)
            .input('Pos', sql.VarChar(10), terminal.PtePosID)
            .input('Monto', sql.BigInt, monto)
            .input('ISO', sql.VarChar(5), monedaISO)
            .input('Mon', sql.Int, Number(p.monedaId))
            .input('Int', sql.NVarChar(sql.MAX), JSON.stringify({ ...(p.intencion || {}), prueba: !!p.prueba }))
            .input('Cli', sql.Int, p.clienteId || null)
            .input('Usr', sql.Int, p.usuarioId || null)
            .input('Fecha', sql.VarChar(17), fecha)
            .input('Inv', sql.VarChar(7), factura?.numero ? String(factura.numero) : null)
            .input('Tax', sql.Int, factura ? Number(factura.taxRefund) : 0)
            .input('Drena', sql.BigInt, drenaDe)
            .input('Cae', sql.NVarChar(500), p.cae ? JSON.stringify(p.cae) : null)
            .input('CaeEst', sql.VarChar(20), p.cae ? 'RESERVADO' : null)
            .input('TEt', sql.VarChar(50), terminal.PteEtiqueta)
            .input('TTipo', sql.VarChar(20), terminal.PteTipo)
            .query(`
                INSERT INTO dbo.PosTransacciones
                    (PtxUuid, PtxIdTerminal, PtxPosID, PtxTipo, PtxEstado, PtxMontoCentesimos, PtxMonedaISO, PtxMonedaId,
                     PtxIntencionJson, PtxClienteId, PtxUsuarioId, PtxFechaPls, PtxInvoiceNumber, PtxTaxRefund, PtxDrenaReversaDeId,
                     PtxCaeJson, PtxCaeEstado, PtxTerminalEtiqueta, PtxTerminalTipo)
                OUTPUT INSERTED.PtxId
                VALUES (@Uuid, @Term, @Pos, 'VENTA', 'CREADA', @Monto, @ISO, @Mon,
                        @Int, @Cli, @Usr, @Fecha, @Inv, @Tax, @Drena, @Cae, @CaeEst, @TEt, @TTipo)`);
        ptxId = ins.recordset[0].PtxId;
        for (const r of referencias) {
            await new sql.Request(tx)
                .input('Ptx', sql.BigInt, ptxId).input('Tipo', sql.VarChar(20), r.tipo).input('Ref', sql.Int, Number(r.id))
                .query('INSERT INTO dbo.PosTransaccionReferencias (PtrIdPtx, PtrTipo, PtrRefId) VALUES (@Ptx, @Tipo, @Ref)');
        }
        await tx.commit();
    } catch (e) {
        await rollbackSeguro(tx, `poslink iniciarVenta ${uuid}`);
        // La venta no llegó a existir: el número de factura reservado no se va a usar.
        if (p.cae) void anularCaeReservado(p.cae, p.intencion?.empresaId, `venta ${uuid} no creada`);
        const msg = String(e.message || '');
        if (/UQ_PosTransacciones_TerminalOcupada/.test(msg)) throw new CobroPosError('TERMINAL_OCUPADA', `La terminal ${terminal.PteEtiqueta} tiene un cobro en curso o sin resolver.`);
        if (/UQ_PosTransaccionReferencias_Activa/.test(msg)) throw new CobroPosError('YA_EN_COBRO', 'Algo de lo que se quiere cobrar ya está en otro cobro con tarjeta en curso o sin resolver.');
        throw e;
    }

    // Recién ahora, y fuera de toda transacción SQL, la llamada a PLS.
    let resp = null, error = null;
    try {
        resp = await cliente.venta({ terminal: terminalPls(terminal, p.usuarioId), fecha, montoCentesimos: monto, monedaISO, factura });
    } catch (e) {
        error = e;
    }
    const alta = interpretarAlta(resp, error);
    await cambiarEstado(pool, ptxId, [E.CREADA], alta.estado, {
        PtxTransactionId: alta.transactionId || null,
        PtxResponseCode: resp ? cliente.responseCodeDe(resp) : null,
        PtxRespuestaJson: resp ? JSON.stringify(filtrarRespuesta(resp)) : null,
        PtxRequiereRevision: alta.estado === E.INDETERMINADA ? 1 : undefined,
        nota: alta.motivo || undefined,
    });
    const fila = await leerFila(pool, { id: ptxId });
    if (alta.estado === E.ERROR_VALIDACION) {
        logger.error(`${LOG} Venta ${uuid} rechazada por PLS: ${alta.motivo}`);
    } else if (alta.estado === E.INDETERMINADA) {
        await alertar(pool, fila, `ALERTA: cobro con tarjeta en duda (${terminal.PteEtiqueta})`,
            `${alta.motivo}\n\nNo se sabe si la venta llegó a la terminal. NO volver a cobrar estas órdenes hasta mirar el POS:\n`
            + `· si el POS muestra el cobro aprobado, registrarlo a mano;\n· si no, cerrar el caso como cancelado.\n`
            + `La terminal y las órdenes quedan bloqueadas hasta que se resuelva.`);
    }
    return { uuid, ptxId, estado: alta.estado, motivo: alta.motivo };
}

// ─────────────────────────────────────────────────────────────────────────────
// Poleo
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Un paso de poleo: consulta a PLS y aplica la transición. Lo llama el front cada 2-3 s
 * [SPEC p.29] y el barrido para lo que quedó huérfano. Devuelve la fila actualizada.
 */
async function polear({ uuid, id }) {
    const pool = await pool_();
    let fila = await leerFila(pool, { uuid, id });
    if (!fila) return null;

    if (fila.PtxEstado === E.APROBADA && !fila.PtxAprobadaAt) {
        await registrar(pool, fila.PtxId);
        return leerFila(pool, { id: fila.PtxId });
    }
    if (!A_POLEAR.has(fila.PtxEstado) || !fila.PtxTransactionId) return fila;

    let resp;
    try {
        resp = await cliente.consulta({ terminal: terminalDeFila(fila), fecha: fila.PtxFechaPls, transactionId: fila.PtxTransactionId });
    } catch (e) {
        // Una consulta que falla no cambia nada: es solo lectura. Se vuelve a intentar en el próximo paso.
        await pool.request().input('Id', sql.BigInt, fila.PtxId)
            .query('UPDATE dbo.PosTransacciones SET PtxUltimoPollAt = GETDATE(), PtxIntentosPoll = PtxIntentosPoll + 1 WHERE PtxId = @Id');
        logger.warn(`${LOG} Consulta de #${fila.PtxId} falló (${e.tipo || 'ERROR'}): ${e.message}`);
        return fila;
    }

    await pool.request().input('Id', sql.BigInt, fila.PtxId)
        .query('UPDATE dbo.PosTransacciones SET PtxUltimoPollAt = GETDATE(), PtxIntentosPoll = PtxIntentosPoll + 1 WHERE PtxId = @Id');

    const r = interpretarConsulta(resp, filaParaEstados(fila));
    const campos = camposDeConsulta(r.datos, resp);
    const cambio = await cambiarEstado(pool, fila.PtxId, [fila.PtxEstado], r.estado, {
        ...campos,
        PtxRequiereRevision: [E.INDETERMINADA, E.PEDIR_AUTORIZACION, E.PENDIENTE_BILLETERA].includes(r.estado) ? 1 : undefined,
        nota: r.estado !== fila.PtxEstado ? (r.motivo || undefined) : undefined,
    });

    if (cambio && r.estado !== fila.PtxEstado) {
        fila = await leerFila(pool, { id: fila.PtxId });
        await avisarTransicion(pool, fila, r);
    }
    if (r.accion === 'REVERSAR') await reversar(pool, fila.PtxId);
    if (r.accion === 'REGISTRAR') await registrar(pool, fila.PtxId);
    return leerFila(pool, { id: fila.PtxId });
}

async function avisarTransicion(pool, fila, r) {
    if (fila.PtxEstado === E.INDETERMINADA) {
        await alertar(pool, fila, `ALERTA: cobro con tarjeta en duda (${fila.PteEtiqueta})`,
            `${r.motivo}\n\nPuede haber plata debitada. NO volver a cobrar estas órdenes: mirar el POS y el lote.\n`
            + `La terminal y las órdenes quedan bloqueadas hasta que se resuelva.`);
    } else if (fila.PtxEstado === E.PENDIENTE_BILLETERA) {
        await alertar(pool, fila, `Cobro con billetera pendiente (${fila.PteEtiqueta})`,
            `${r.motivo}\n\nHay que verificarlo a mano en el POS [SPEC p.21] antes de liberar la terminal.`);
    } else if (fila.PtxEstado === E.REVERSADA) {
        logger.info(`${LOG} #${fila.PtxId} reversada confirmada por PLS.`);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancelación y reversa
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Cancela una venta que el POS todavía no tomó (§4.4 a). La cancelación nunca se da por hecha al
 * mandarla: la ventana se cierra sola si el POS levanta la venta. El estado real lo dice el Query
 * siguiente (y si la cancelación ganó, ese Query devuelve 999 — verificado 16/09).
 */
async function cancelar({ uuid, id }) {
    const pool = await pool_();
    const fila = await leerFila(pool, { uuid, id });
    if (!fila) return null;
    if (![E.ENVIADA, E.ESPERANDO_POS].includes(fila.PtxEstado) || !fila.PtxTransactionId) {
        return { fila, cancelada: false, motivo: `No se puede cancelar en estado ${fila.PtxEstado}.` };
    }
    try {
        const resp = await cliente.cancelar({ terminal: terminalDeFila(fila), fecha: fila.PtxFechaPls, transactionId: fila.PtxTransactionId });
        if (cliente.responseCodeDe(resp) === 0) {
            await pool.request().input('Id', sql.BigInt, fila.PtxId)
                .query('UPDATE dbo.PosTransacciones SET PtxCancelOkAt = GETDATE(), PtxUpdatedAt = GETDATE() WHERE PtxId = @Id');
        } else {
            logger.warn(`${LOG} Cancelación de #${fila.PtxId}: ResponseCode ${cliente.responseCodeDe(resp)}.`);
        }
    } catch (e) {
        logger.warn(`${LOG} Cancelación de #${fila.PtxId} falló (${e.tipo || 'ERROR'}): ${e.message}`);
    }
    const despues = await polear({ id: fila.PtxId });
    return { fila: despues, cancelada: despues?.PtxEstado === E.CANCELADA };
}

/**
 * Reversa automática (solo autogestión, §4.4 b). Pasa por claim: el poleo en vivo y el barrido
 * pueden ver la misma fila, y dos reversas sobre "la última transacción del POS" podrían deshacer
 * una venta buena posterior.
 */
async function reversar(pool, ptxId) {
    const claim = await pool.request().input('Id', sql.BigInt, ptxId)
        .query(`UPDATE dbo.PosTransacciones SET PtxReversaPedidaAt = GETDATE(), PtxUpdatedAt = GETDATE()
                OUTPUT DELETED.PtxReversaPedidaAt AS Antes
                WHERE PtxId = @Id AND PtxEstado = 'CAPTURADA' AND PtxReversaPedidaAt IS NULL`);
    if (!claim.recordset.length) return false; // otro la pidió, o ya no está capturada
    const fila = await leerFila(pool, { id: ptxId });
    let rc = null, err = null;
    try {
        const resp = await cliente.reversar({ terminal: terminalDeFila(fila), fecha: fila.PtxFechaPls, transactionId: fila.PtxTransactionId });
        rc = cliente.responseCodeDe(resp);
    } catch (e) { err = e; }
    if (rc === 0) {
        // El 0 es acuse de ENCOLADO: la reversa viaja al adquirente con la próxima operación online del POS
        // (puede tardar hasta 24 h, SPEC p.63). Resonet (Federico, 13/10): con 12 y RemainingExpirationTime 0
        // "ya podés liberar la caja" — no hay una consulta que confirme la reversa (en homologación la consulta
        // siguió en 12 / 0 sin State después de que viajó). Por eso pasa directo a REVERSADA: libera las órdenes,
        // anula el número de factura reservado y el tótem ofrece repetir el pago (guía V1.6: reversar, avisar que
        // la operación anterior queda sin efecto y repetir). REVERSA_PENDIENTE queda solo para filas viejas.
        await cambiarEstado(pool, ptxId, [E.CAPTURADA], E.REVERSADA, { nota: 'Reversa enviada a PLS (acuse 0): viaja con la próxima operación del POS.' });
        return true;
    }
    const motivo = err ? `La reversa no tuvo respuesta (${err.tipo}): ${err.message}` : `La reversa devolvió ResponseCode ${rc}`;
    await cambiarEstado(pool, ptxId, [E.CAPTURADA], E.INDETERMINADA, { PtxRequiereRevision: 1, nota: motivo });
    await alertar(pool, fila, `ALERTA: reversa de cobro con tarjeta fallida (${fila.PteEtiqueta})`,
        `${motivo}\n\nEl POS tomó la tarjeta y la venta venció sin respuesta. Puede haber plata debitada.\n`
        + `Revisar el POS: si el cobro está aprobado, registrarlo o anularlo; si no, cerrar como cancelado.`);
    return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro del cobro
// ─────────────────────────────────────────────────────────────────────────────
/**
 * El payload de procesarTransaccion a partir de la intención: los otros pagos de la operación (efectivo,
 * etc.) más el de la tarjeta. La marca `(Tx: uuid)` va al final de las observaciones y nunca se recorta:
 * es lo que prueba que el cobro quedó registrado (buscarRegistro).
 */
function armarPayloadCaja(fila, intencion, pagosPos, marca) {
    const notas = String(intencion.header?.observaciones || '').trim();
    const espacio = 500 - marca.length - 3;
    const observaciones = notas ? `${notas.slice(0, Math.max(0, espacio))} — ${marca}` : marca;
    const plantilla = intencion.posPago || {};
    const payload = {
        usuarioId: fila.PtxUsuarioId || USUARIO_SISTEMA,
        header: {
            ...intencion.header,
            clienteId: intencion.header.clienteId || fila.PtxClienteId,
            // La moneda del documento es la de la operación, que puede no ser la de la tarjeta
            // (factura en dólares pagada en pesos).
            moneda: intencion.header.moneda || pagosPos[0].moneda,
            // En el tótem no hay cajera: caja administrativa, sin sesión de turno (como Handy y MP).
            esAdministrativa: fila.PteTipo === 'TOTEM' ? true : !!(intencion.header.esAdministrativa || intencion.header.admin),
            observaciones,
        },
        aplicaciones: intencion.aplicaciones,
        // La tarjeta y, si el POS aplicó la rebaja de IVA, la rebaja (sin cuenta de billetera: no es del cliente).
        pagos: [
            ...(intencion.pagosExtra || []),
            ...pagosPos.map((p, i) => ({ cotizacion: plantilla.cotizacion ?? null, cueIdCuenta: i === 0 ? (plantilla.cueIdCuenta ?? null) : null, ...p })),
        ],
    };
    if (intencion.empresaId) payload.empresaId = intencion.empresaId;
    return payload;
}
/** Un cobro ya registrado deja su uuid en TcaObservaciones: es la prueba de que procesarTransaccion commiteó. */
async function buscarRegistro(pool, uuid) {
    // Con pagos mixtos la transacción tiene varios: se prefiere el de tarjeta (Débito/Crédito).
    const r = await pool.request().input('Patron', sql.NVarChar(200), `%(Tx: ${uuid})%`)
        .input('Deb', sql.Int, METODO_DEBITO).input('Cre', sql.Int, METODO_CREDITO)
        .query(`SELECT TOP 1 t.TcaIdTransaccion, p.PagIdPago
                FROM dbo.TransaccionesCaja t WITH(NOLOCK)
                LEFT JOIN dbo.Pagos p WITH(NOLOCK) ON p.PagTcaIdTransaccion = t.TcaIdTransaccion
                WHERE t.TcaObservaciones LIKE @Patron
                ORDER BY t.TcaIdTransaccion, CASE WHEN p.MPaIdMetodoPago IN (@Deb, @Cre) THEN 0 ELSE 1 END, p.PagIdPago DESC`);
    return r.recordset[0] || null;
}

/**
 * Invariante 5: entre que se escribió la intención y ahora pudo cambiar el mundo (otra caja cobró
 * en efectivo, se canceló una orden). Si algo no cierra, NO se registra: mejor un humano mirando
 * que una imputación mal hecha. Devuelve null si está todo bien, o el motivo.
 */
async function revalidar(pool, fila, intencion) {
    const pedido = Number(fila.PtxMontoCentesimos);
    const autorizado = fila.PtxMontoAutorizadoCentesimos == null ? null : Number(fila.PtxMontoAutorizadoCentesimos);
    if (autorizado === null) return 'PLS no informó el importe autorizado (TotalAmount).';
    const reparto = repartoConRebaja({ pedidoCentesimos: pedido, autorizadoCentesimos: autorizado, rebajaCentesimos: fila.PtxTaxAmountCentesimos });
    if (!reparto.ok) {
        return `Se autorizó ${(autorizado / 100).toFixed(2)} y se pidió ${(pedido / 100).toFixed(2)}: ${reparto.motivo}.`;
    }
    if (reparto.rebajaCentesimos > 0) {
        if (!Number(fila.PtxTaxRefund)) return `El POS aplicó una rebaja de ${(reparto.rebajaCentesimos / 100).toFixed(2)} que este cobro no pidió.`;
        if (await idMetodoReduccion(pool) == null) return 'El POS aplicó la rebaja de IVA y no existe el medio de pago «Reducción IVA Ley 19.210».';
    }
    if (!intencion?.header || !intencion?.aplicaciones?.length) return 'La intención de cobro está incompleta.';

    const refs = await pool.request().input('Id', sql.BigInt, fila.PtxId)
        .query('SELECT PtrTipo, PtrRefId FROM dbo.PosTransaccionReferencias WHERE PtrIdPtx = @Id');
    for (const ref of refs.recordset) {
        const req = pool.request().input('Ref', sql.Int, ref.PtrRefId);
        let pagado = false;
        if (ref.PtrTipo === 'RETIRO') {
            const r = await req.query('SELECT PagIdPago FROM dbo.OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @Ref');
            if (!r.recordset.length) return `El retiro ${ref.PtrRefId} ya no existe.`;
            pagado = r.recordset[0].PagIdPago != null;
        } else if (ref.PtrTipo === 'ORDEN') {
            // Mismo criterio que el lookup del tótem: PagIdPago, o la cobranza marcada Pagado.
            const r = await req.query(`
                SELECT o.PagIdPago, pc.EstadoCobro
                FROM dbo.OrdenesDeposito o WITH(NOLOCK)
                LEFT JOIN dbo.PedidosCobranza pc WITH(NOLOCK) ON pc.NoDocERP = o.OrdCodigoOrden
                WHERE o.OrdIdOrden = @Ref`);
            if (!r.recordset.length) return `La orden ${ref.PtrRefId} ya no existe.`;
            pagado = r.recordset.some(x => x.PagIdPago != null || x.EstadoCobro === 'Pagado');
        } else if (ref.PtrTipo === 'DOCUMENTO') {
            const r = await req.query('SELECT DocPagado FROM dbo.DocumentosContables WITH(NOLOCK) WHERE DocIdDocumento = @Ref');
            if (!r.recordset.length) return `El documento ${ref.PtrRefId} ya no existe.`;
            pagado = !!r.recordset[0].DocPagado;
        }
        if (pagado) return `${ref.PtrTipo} ${ref.PtrRefId} ya figura pago por otra vía.`;
    }
    return null;
}

/**
 * Registra el cobro aprobado. Solo uno gana el claim (invariante 4); el ganador revalida y llama a
 * procesarTransaccion con el monto AUTORIZADO. Si algo falla: APROBADA_SIN_REGISTRAR + ticket. Nunca
 * se reversa un cobro con resultado conocido [SPEC p.63].
 */
async function registrar(pool, ptxId) {
    const claim = await pool.request().input('Id', sql.BigInt, ptxId)
        .query(`UPDATE dbo.PosTransacciones SET PtxAprobadaAt = GETDATE(), PtxUpdatedAt = GETDATE()
                OUTPUT DELETED.PtxAprobadaAt AS Antes
                WHERE PtxId = @Id AND PtxEstado = 'APROBADA' AND PtxAprobadaAt IS NULL`);
    if (!claim.recordset.length) return false;
    const fila = await leerFila(pool, { id: ptxId });
    // Una anulación o devolución aprobada no se "registra" como cobro: se revierte la venta original.
    if (fila.PtxTipo === 'ANULACION' || fila.PtxTipo === 'DEVOLUCION') return registrarReversion(pool, fila);

    const sinRegistrar = async (motivo, detalle) => {
        await cambiarEstado(pool, ptxId, [E.APROBADA], E.APROBADA_SIN_REGISTRAR, { PtxRequiereRevision: 1, nota: motivo });
        await alertar(pool, fila, `ALERTA: cobro con tarjeta aprobado SIN registrar (${fila.PteEtiqueta})`,
            `${motivo}\n\nEl cliente YA pagó con tarjeta. NO volver a cobrarle: registrar el pago a mano o anularlo en el POS.\n`
            + `Las órdenes quedan bloqueadas para otro cobro con tarjeta hasta que se cierre el caso.${detalle ? `\n\n${detalle}` : ''}`);
        return false;
    };

    let intencion;
    try { intencion = JSON.parse(fila.PtxIntencionJson || '{}'); } catch (e) { intencion = {}; }
    if (intencion.prueba) {
        return sinRegistrar('Venta de PRUEBA aprobada: no se registra en caja.',
            'Si fue con una tarjeta real, anularla en el POS.');
    }

    // ¿Ya se registró? (un proceso anterior pudo morir después del commit y antes de marcar la fila)
    const previo = await buscarRegistro(pool, fila.PtxUuid);
    if (previo) {
        await cambiarEstado(pool, ptxId, [E.APROBADA], E.REGISTRADA, { PtxTcaIdTransaccion: previo.TcaIdTransaccion, PtxPagIdPago: previo.PagIdPago, nota: 'Ya estaba registrado.' });
        await emitirFacturaReservada(pool, await leerFila(pool, { id: ptxId }));
        return true;
    }

    const motivo = await revalidar(pool, fila, intencion);
    if (motivo) return sinRegistrar(`No se registró: ${motivo}`);

    let voucherXml = null;
    try { voucherXml = cliente.campo(JSON.parse(fila.PtxRespuestaJson || '{}'), 'VoucherPrintInfoXML'); } catch (e) { voucherXml = null; }
    const debito = esDebito({ voucherXml, issuer: fila.PtxIssuer, cardAccountType: fila.PtxCardAccountType, taxAmountCentesimos: fila.PtxTaxAmountCentesimos });
    const moneda = fila.PtxMonedaId === 2 ? 'USD' : 'UYU';
    // Con rebaja de IVA: la tarjeta pagó el neto y el resto es crédito fiscal (revalidar ya comprobó que cierra).
    const reparto = repartoConRebaja({
        pedidoCentesimos: Number(fila.PtxMontoCentesimos),
        autorizadoCentesimos: Number(fila.PtxMontoAutorizadoCentesimos),
        rebajaCentesimos: fila.PtxTaxAmountCentesimos,
    });
    const pagosPos = [{ metodoPagoId: debito ? METODO_DEBITO : METODO_CREDITO, monedaId: fila.PtxMonedaId, moneda, montoOriginal: reparto.tarjetaCentesimos / 100 }];
    if (reparto.rebajaCentesimos > 0) {
        pagosPos.push({ metodoPagoId: await idMetodoReduccion(pool), monedaId: fila.PtxMonedaId, moneda, montoOriginal: reparto.rebajaCentesimos / 100 });
    }
    const payload = armarPayloadCaja(fila, intencion, pagosPos,
        `Cobro POS ${fila.PteEtiqueta} ${debito ? 'débito' : 'crédito'}${reparto.rebajaCentesimos > 0 ? ' con rebaja IVA Ley 19.210' : ''} (Tx: ${fila.PtxUuid})`);

    // procesarTransaccion abre y cierra su propia transacción. El 1205 la revierte entera, así que
    // reintentarlo es seguro; la llamada al POS ya terminó y queda fuera de este alcance (§4.5 vector 2).
    const { procesarTransaccion } = require('../cajaService');
    let resultado = null, error = null;
    for (let intento = 1; intento <= 3; intento++) {
        try { resultado = await procesarTransaccion(payload); error = null; break; }
        catch (e) {
            error = e;
            if (!esDeadlock(e) || intento === 3) break;
            logger.warn(`${LOG} Deadlock registrando #${ptxId}, intento ${intento}/3.`);
            await new Promise(r => setTimeout(r, intento * 2000));
        }
    }
    if (error) return sinRegistrar(`procesarTransaccion falló: ${error.message}`);

    // El pago de la TARJETA, no el primero: con pagos mixtos (efectivo + tarjeta) la tarjeta va última y
    // pagosCreados sigue el orden de los pagos (visto el 12/10 con RT-19359: apuntaba al efectivo).
    const pagoPos = pagosPos[0];
    const creados = resultado.pagosCreados || [];
    const pagoTarjeta = creados.filter(pc => Number(pc.metodoPagoId) === Number(pagoPos.metodoPagoId)
        && Math.abs(Number(pc.monto) - Number(pagoPos.montoOriginal)) < 0.005).pop() || creados[creados.length - pagosPos.length];
    await cambiarEstado(pool, ptxId, [E.APROBADA], E.REGISTRADA, {
        PtxTcaIdTransaccion: resultado.tcaIdTransaccion,
        PtxPagIdPago: pagoTarjeta?.pagIdPago || null,
    });
    logger.info(`${LOG} #${ptxId} registrado: Tca ${resultado.tcaIdTransaccion}, pago con tarjeta ${pagoTarjeta?.pagIdPago}.`);
    // Factura con el número que viajó al POS (si se reservó). Después del registro: si falla, el cobro
    // igual queda asentado y la factura sale desde la Bandeja con ese mismo número.
    await emitirFacturaReservada(pool, await leerFila(pool, { id: ptxId }));
    return true;
}

/** Id del método «Reducción IVA Ley 19.210» (lo crea el script de POSLink), o null si no existe. */
async function idMetodoReduccion(pool) {
    const r = await pool.request().query(`SELECT TOP 1 MPaIdMetodoPago FROM dbo.MetodosPagos WHERE MPaDescripcionMetodo = 'Reducción IVA Ley 19.210'`);
    return r.recordset[0]?.MPaIdMetodoPago ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Caja (F2): el cobro de la cajera con una línea "Tarjeta (POS)"
// ─────────────────────────────────────────────────────────────────────────────
/** Lo que se bloquea mientras dura el cobro (candado B), según lo que la caja aplica. */
function referenciasDeAplicaciones(aplicaciones) {
    const refs = [];
    for (const a of aplicaciones || []) {
        const id = parseInt(String(a.referenciaId ?? '').replace(/\D/g, ''), 10);
        if (!Number.isInteger(id)) continue;
        if (a.tipo === 'ORDEN_RETIRO') refs.push({ tipo: 'RETIRO', id });
        else if (a.tipo === 'ORDEN_DEPOSITO') refs.push({ tipo: 'ORDEN', id });
    }
    return refs;
}

/**
 * Arranca el cobro con tarjeta de una operación de caja. Recibe lo mismo que POST /caja/transaccion,
 * más cuál de los pagos va por el POS. Antes de tocar la tarjeta ENSAYA el registro (procesarTransaccion
 * con `simular`): si la caja lo va a rechazar, se sabe acá y no se le cobra al cliente.
 */
async function iniciarCobroCaja({ terminal, header, aplicaciones, pagos, posIndex, usuarioId, empresaId }) {
    if (!header || !aplicaciones?.length) throw new CobroPosError('DATOS', 'Faltan header o aplicaciones.');
    const lineas = Array.isArray(pagos) ? pagos : [];
    const pos = lineas[posIndex];
    if (!pos) throw new CobroPosError('DATOS', 'Falta la línea de pago con tarjeta.');
    const montoCentesimos = Math.round(Number(pos.montoOriginal) * 100);
    if (!Number.isSafeInteger(montoCentesimos) || montoCentesimos <= 0) throw new CobroPosError('MONTO_INVALIDO', 'El importe de la tarjeta tiene que ser mayor a cero.');
    const monedaId = pos.moneda === 'USD' || Number(pos.monedaId) === 2 ? 2 : 1;
    const otros = lineas.filter((_, i) => i !== posIndex);
    const referencias = referenciasDeAplicaciones(aplicaciones);
    if (!referencias.length) throw new CobroPosError('SIN_REFERENCIAS', 'El cobro con POS por ahora es solo para retiros y órdenes.');
    if (header.esCredito) throw new CobroPosError('DATOS', 'Un cobro a crédito no lleva pago con tarjeta.');

    // Ensayo: el mismo payload que se va a registrar, con la tarjeta como débito por el importe pedido.
    const { procesarTransaccion } = require('../cajaService');
    const ensayo = {
        header: JSON.parse(JSON.stringify(header)),
        aplicaciones: JSON.parse(JSON.stringify(aplicaciones)),
        pagos: [...JSON.parse(JSON.stringify(otros)), { ...pos, metodoPagoId: METODO_DEBITO, monedaId, moneda: monedaId === 2 ? 'USD' : 'UYU' }],
        usuarioId, empresaId, simular: true,
    };
    let simulado = null;
    for (let intento = 1; intento <= 3; intento++) {
        try { simulado = await procesarTransaccion(JSON.parse(JSON.stringify(ensayo))); break; }
        catch (e) {
            if (esDeadlock(e) && intento < 3) { await new Promise(r => setTimeout(r, intento * 300)); continue; }
            throw new CobroPosError('CAJA_RECHAZA', `La caja no aceptaría este cobro, así que no se mandó a la tarjeta: ${e.message}`);
        }
    }

    // Rebaja de IVA (Ley 19.210): la terminal necesita el número de la factura ANTES de cobrar. Se
    // reserva en SISNET; si después no se cobra, se anula (cambiarEstado → anularCaeDeFila).
    const { factura, cae } = await prepararRebaja({ documento: simulado?.documento, cantidadPagos: lineas.length, monedaId, montoCentesimos, empresaId });

    return iniciarVenta({
        terminal,
        montoCentesimos,
        monedaId,
        clienteId: header.clienteId || null,
        usuarioId,
        referencias,
        factura,
        cae,
        intencion: {
            origen: 'CAJA',
            header,
            aplicaciones,
            pagosExtra: otros,
            posPago: { cotizacion: pos.cotizacion ?? null, cueIdCuenta: pos.cueIdCuenta ?? null },
            empresaId: empresaId || null,
        },
    });
}

/**
 * Si corresponde pedir la rebaja (decidirRebaja) reserva el número de factura en SISNET y arma los datos
 * para el POS. Apagado salvo POSLINK_LEY_19210=true y el medio «Reducción IVA Ley 19.210» creado. Si la
 * reserva falla se cobra sin rebaja, como hasta ahora: frenar la caja por SISNET sería peor.
 * @returns {Promise<{ factura: object|null, cae: object|null }>}
 */
async function prepararRebaja({ documento, cantidadPagos, monedaId, montoCentesimos, empresaId }) {
    const nada = { factura: null, cae: null };
    if (process.env.POSLINK_LEY_19210 !== 'true' || !documento) return nada;
    const pool = await getPool();
    if (await idMetodoReduccion(pool) == null) {
        logger.warn(`${LOG} POSLINK_LEY_19210 está prendido pero falta el medio «Reducción IVA Ley 19.210»: se cobra sin rebaja.`);
        return nada;
    }
    const sisnet = require('../sisnetService');
    const receptor = String(documento.DocCliDocumento || '').trim();
    const { tipoCFE } = sisnet.resolverTipoCFE(documento.DocTipo, receptor);
    const totalDocCentesimos = Math.round(Number(documento.DocTotal) * 100);
    const gravadoCentesimos = Math.round(Number(documento.Gravado || 0) * 100);
    const d = decidirRebaja({
        tipoCFE, receptor, cantidadPagos, monedaDoc: documento.MonIdMoneda, monedaPos: monedaId,
        totalDocCentesimos, montoPosCentesimos: montoCentesimos, gravadoCentesimos,
    });
    if (!d.pedir) { logger.info(`${LOG} Sin rebaja de IVA: ${d.motivo}`); return nada; }
    try {
        const cae = await sisnet.reservarNumero(tipoCFE, await empresaEmisora(pool, empresaId));
        if (!/^\d{1,7}$/.test(String(cae.numero))) {
            await anularCaeReservado(cae, empresaId, 'número de más de 7 dígitos');
            logger.warn(`${LOG} El número reservado ${cae.serie}-${cae.numero} no entra en InvoiceNumber (7 dígitos): se cobra sin rebaja.`);
            return nada;
        }
        return {
            cae,
            factura: { numero: String(cae.numero), montoCentesimos: totalDocCentesimos, gravadoCentesimos, taxRefund: 1 },
        };
    } catch (e) {
        logger.error(`${LOG} No se pudo reservar el número de factura en SISNET: ${e.message}. Se cobra sin rebaja de IVA.`);
        return nada;
    }
}

const MENSAJES = {
    [E.CREADA]: 'Mandando el importe al POS…',
    [E.ENVIADA]: 'Esperando que el POS tome la venta…',
    [E.ESPERANDO_POS]: 'Esperando que el POS tome la venta…',
    [E.CAPTURADA]: 'El importe está en el POS: el cliente puede pasar la tarjeta.',
    [E.APROBADA]: 'Aprobada. Registrando el cobro…',
    [E.REGISTRADA]: 'Cobro con tarjeta registrado.',
    [E.RECHAZADA]: 'La tarjeta fue rechazada. No se cobró nada.',
    [E.CANCELADA]: 'Cancelado. No se cobró nada.',
    [E.ERROR_VALIDACION]: 'Resonet no aceptó el pedido. No se cobró nada.',
    [E.PEDIR_AUTORIZACION]: 'El emisor pide autorización telefónica. Todavía no se cobró nada.',
    [E.PENDIENTE_BILLETERA]: 'Pago con billetera pendiente: hay que verificarlo en el POS.',
    [E.INDETERMINADA]: 'No se sabe si se cobró. NO cobres de nuevo: revisá el POS. Finanzas ya tiene un aviso.',
    [E.APROBADA_SIN_REGISTRAR]: 'Se cobró con tarjeta pero no se pudo registrar. NO cobres de nuevo. Finanzas ya tiene un aviso.',
    [E.REVERSA_PENDIENTE]: 'Se pidió anular el cobro en la tarjeta (puede tardar).',
    [E.REVERSADA]: 'El POS no respondió a tiempo y el cobro se anuló: si se llegó a debitar, se devuelve solo.',
};
// Anulación / devolución: la plata va del comercio al cliente; los mensajes cambian.
const mensajeReversion = (estado, tipo) => {
    const n = tipo === 'ANULACION' ? 'anulación' : 'devolución';
    return {
        [E.CREADA]: 'Mandando al POS…',
        [E.ENVIADA]: 'Esperando que el POS tome la operación…',
        [E.ESPERANDO_POS]: 'Esperando que el POS tome la operación…',
        [E.CAPTURADA]: `El POS tiene la ${n}: el cliente tiene que pasar la misma tarjeta.`,
        [E.APROBADA]: `${n[0].toUpperCase() + n.slice(1)} aprobada. Revirtiendo la venta en el sistema…`,
        [E.REGISTRADA]: `${n[0].toUpperCase() + n.slice(1)} hecha: la plata volvió a la tarjeta y la venta quedó revertida.`,
        [E.RECHAZADA]: `La ${n} fue rechazada. No se devolvió nada.`,
        [E.CANCELADA]: `${n[0].toUpperCase() + n.slice(1)} cancelada. No se devolvió nada.`,
        [E.ERROR_VALIDACION]: `Resonet no aceptó la ${n}. No se devolvió nada.`,
        [E.INDETERMINADA]: `No se sabe si la ${n} se hizo. Revisá el POS antes de reintentar. Finanzas ya tiene un aviso.`,
        [E.APROBADA_SIN_REGISTRAR]: `La ${n} se aprobó pero no se pudo revertir en el sistema. Finanzas ya tiene un aviso.`,
        [E.REVERSA_PENDIENTE]: `Se pidió deshacer la ${n} en el POS (puede tardar).`,
        [E.REVERSADA]: `La ${n} se deshizo en el POS.`,
    }[estado];
};

const FINAL_PARA_PANTALLA = new Set([E.REGISTRADA, E.RECHAZADA, E.CANCELADA, E.ERROR_VALIDACION, E.INDETERMINADA, E.APROBADA_SIN_REGISTRAR, E.PEDIR_AUTORIZACION, E.PENDIENTE_BILLETERA, E.REVERSADA]);

/** Lo que ve la pantalla. Sin datos de la tarjeta más allá de los 4 últimos dígitos. */
function estadoPublico(f) {
    if (!f) return null;
    const ultimaNota = String(f.PtxObservaciones || '').split(' | ').pop().replace(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} /, '');
    let debito = null;
    if (f.PtxEstado === E.REGISTRADA || f.PtxEstado === E.APROBADA || f.PtxEstado === E.APROBADA_SIN_REGISTRAR) {
        let voucherXml = null;
        try { voucherXml = cliente.campo(JSON.parse(f.PtxRespuestaJson || '{}'), 'VoucherPrintInfoXML'); } catch (e) { voucherXml = null; }
        debito = esDebito({ voucherXml, issuer: f.PtxIssuer, cardAccountType: f.PtxCardAccountType, taxAmountCentesimos: f.PtxTaxAmountCentesimos });
    }
    return {
        uuid: f.PtxUuid,
        estado: f.PtxEstado,
        final: FINAL_PARA_PANTALLA.has(f.PtxEstado),
        cobrado: [E.REGISTRADA, E.APROBADA, E.APROBADA_SIN_REGISTRAR].includes(f.PtxEstado),
        tipo: f.PtxTipo || 'VENTA',
        mensaje: (f.PtxTipo && f.PtxTipo !== 'VENTA' ? mensajeReversion(f.PtxEstado, f.PtxTipo) : MENSAJES[f.PtxEstado]) || f.PtxEstado,
        detalle: [E.RECHAZADA, E.CANCELADA, E.ERROR_VALIDACION, E.INDETERMINADA, E.APROBADA_SIN_REGISTRAR].includes(f.PtxEstado) ? ultimaNota || null : null,
        posResponseCode: f.PtxPosResponseCode || null,
        segundosRestantes: f.PtxRemainingExpTime != null ? Math.round(Number(f.PtxRemainingExpTime)) : null,
        terminal: f.PteEtiqueta,
        moneda: f.PtxMonedaId === 2 ? 'USD' : 'UYU',
        monto: Number(f.PtxMontoCentesimos) / 100,
        montoAutorizado: f.PtxMontoAutorizadoCentesimos != null ? Number(f.PtxMontoAutorizadoCentesimos) / 100 : null,
        tarjeta: f.PtxCardNumber ? String(f.PtxCardNumber).slice(-4) : null,
        debito,
        autorizacion: f.PtxAuthorizationCode || null,
        tcaIdTransaccion: f.PtxTcaIdTransaccion || null,
        serieDoc: f.TcaSerieDoc || null,     // comprobante que generó la caja al registrar
        numeroDoc: f.TcaNumeroDoc || null,
        // Rebaja de IVA (Ley 19.210): se pidió con este número de factura; si el POS la aplicó, cuánto.
        conRebaja: !!Number(f.PtxTaxRefund),
        facturaReservada: (() => { try { const c = JSON.parse(f.PtxCaeJson || 'null'); return c ? `${c.serie}-${c.numero}` : null; } catch (e) { return null; } })(),
        rebajaIva: Number(f.PtxTaxAmountCentesimos || 0) > 0 ? Number(f.PtxTaxAmountCentesimos) / 100 : null,
    };
}

async function terminalesCaja() {
    const pool = await pool_();
    const r = await pool.request().query(`SELECT PteIdTerminal, PteEtiqueta, PteDescripcion FROM dbo.PosTerminales WHERE PteActivo = 1 AND PteTipo = 'CAJA' ORDER BY PteEtiqueta`);
    return r.recordset;
}

/**
 * ¿Algo de esto está en un cobro con tarjeta vivo? Lo usa la caja para no cobrar por otra vía lo que
 * la tarjeta puede estar cobrando. Si las tablas no existen (POSLink nunca se usó), no hay nada en cobro.
 */
let tablasExisten = null;
async function referenciasEnCobro(pool, aplicaciones) {
    const refs = referenciasDeAplicaciones(aplicaciones);
    if (!refs.length) return [];
    if (tablasExisten !== true) {
        const r = await pool.request().query(`SELECT OBJECT_ID('dbo.PosTransaccionReferencias', 'U') AS Id`);
        tablasExisten = r.recordset[0].Id != null;
        if (!tablasExisten) { tablasExisten = null; return []; } // se vuelve a mirar: pueden crearse después
    }
    const req = pool.request();
    const cond = refs.map((x, i) => {
        req.input(`T${i}`, sql.VarChar(20), x.tipo).input(`R${i}`, sql.Int, x.id);
        return `(r.PtrTipo = @T${i} AND r.PtrRefId = @R${i})`;
    }).join(' OR ');
    const r = await req.query(`
        SELECT r.PtrTipo, r.PtrRefId, p.PtxEstado, COALESCE(p.PtxTerminalEtiqueta, t.PteEtiqueta) AS PteEtiqueta
        FROM dbo.PosTransaccionReferencias r
        JOIN dbo.PosTransacciones p ON p.PtxId = r.PtrIdPtx
        JOIN dbo.PosTerminales t ON t.PteIdTerminal = p.PtxIdTerminal
        WHERE r.PtrActiva = 1 AND (${cond})`);
    return r.recordset;
}

/**
 * La cajera cierra un caso que quedó esperando a una persona, solo cuando NO se cobró nada:
 * PEDIR_AUTORIZACION (no llamó al emisor, o el emisor no autorizó) o PENDIENTE_BILLETERA verificada
 * como no pagada. Lo que pudo haber cobrado (INDETERMINADA, APROBADA_SIN_REGISTRAR) lo resuelve Finanzas.
 */
async function cerrarSinCobro({ uuid, usuarioId }) {
    const pool = await pool_();
    const fila = await leerFila(pool, { uuid });
    if (!fila) throw new CobroPosError('INEXISTENTE', 'Cobro inexistente.');
    if (![E.PEDIR_AUTORIZACION, E.PENDIENTE_BILLETERA].includes(fila.PtxEstado)) {
        throw new CobroPosError('ESTADO', `Este cobro está en ${fila.PtxEstado}: no lo cierra la caja.`);
    }
    await cambiarEstado(pool, fila.PtxId, [fila.PtxEstado], E.CANCELADA, {
        PtxRequiereRevision: 0, nota: `Cerrado sin cobro por la cajera (usuario ${usuarioId}).`,
    });
    return leerFila(pool, { id: fila.PtxId });
}

// ─────────────────────────────────────────────────────────────────────────────
// Anulación y devolución (F4): deshacer un cobro con tarjeta ya registrado
// ─────────────────────────────────────────────────────────────────────────────
/** Llama un handler de Express de la caja/CFE desde acá (mismo patrón que crearFacturaManual en webOrders). */
function llamarHandler(fn, req) {
    return new Promise((resolve, reject) => {
        const res = {
            code: 200,
            status(c) { this.code = c; return this; },
            json(o) { resolve({ status: this.code, body: o }); return this; },
            send(o) { resolve({ status: this.code, body: o }); return this; },
        };
        Promise.resolve(fn(req, res)).catch(reject);
    });
}

const EN_CURSO = ['CREADA', 'ENVIADA', 'ESPERANDO_POS', 'CAPTURADA', 'INDETERMINADA', 'PENDIENTE_BILLETERA', 'PEDIR_AUTORIZACION', 'APROBADA', 'REVERSA_PENDIENTE'];

/** Ventas con tarjeta registradas en los últimos días, con lo que ya se devolvió de cada una. */
async function ventasAnulables({ dias = 7 } = {}) {
    const pool = await pool_();
    const r = await pool.request().input('D', sql.Int, dias).query(`
        SELECT v.PtxUuid, v.PtxId, v.PtxMontoAutorizadoCentesimos, v.PtxMonedaId, v.PtxCardNumber, v.PtxTicket,
               CONVERT(VARCHAR(16), v.PtxCreatedAt, 120) AS Fecha,
               COALESCE(v.PtxTerminalEtiqueta, t.PteEtiqueta) AS Terminal,
               LTRIM(RTRIM(c.Nombre)) AS Cliente, tc.TcaSerieDoc, tc.TcaNumeroDoc,
               JSON_VALUE(v.PtxIntencionJson, '$.aplicaciones[0].codigoRef') AS Referencia,
               (SELECT ISNULL(SUM(x.PtxMontoCentesimos), 0) FROM dbo.PosTransacciones x
                 WHERE x.PtxVentaOrigenId = v.PtxId AND x.PtxEstado IN ('REGISTRADA','APROBADA_SIN_REGISTRAR')) AS DevueltoCentesimos,
               (SELECT COUNT(*) FROM dbo.PosTransacciones x
                 WHERE x.PtxVentaOrigenId = v.PtxId AND x.PtxEstado IN (${EN_CURSO.map(e => `'${e}'`).join(',')})) AS EnCurso
        FROM dbo.PosTransacciones v
        JOIN dbo.PosTerminales t ON t.PteIdTerminal = v.PtxIdTerminal
        LEFT JOIN dbo.Clientes c ON c.CliIdCliente = v.PtxClienteId
        LEFT JOIN dbo.TransaccionesCaja tc ON tc.TcaIdTransaccion = v.PtxTcaIdTransaccion
        WHERE v.PtxTipo = 'VENTA' AND v.PtxEstado = 'REGISTRADA' AND v.PtxCreatedAt >= DATEADD(DAY, -@D, GETDATE())
        ORDER BY v.PtxId DESC`);
    return r.recordset.map(x => ({
        uuid: x.PtxUuid,
        fecha: x.Fecha,
        terminal: x.Terminal,
        cliente: x.Cliente,
        referencia: x.Referencia,
        comprobante: x.TcaNumeroDoc ? `${x.TcaSerieDoc || ''}-${x.TcaNumeroDoc}` : null,
        moneda: x.PtxMonedaId === 2 ? 'USD' : 'UYU',
        monto: Number(x.PtxMontoAutorizadoCentesimos) / 100,
        devuelto: Number(x.DevueltoCentesimos) / 100,
        disponible: (Number(x.PtxMontoAutorizadoCentesimos) - Number(x.DevueltoCentesimos)) / 100,
        enCurso: x.EnCurso > 0,
        tarjeta: x.PtxCardNumber ? String(x.PtxCardNumber).slice(-4) : null,
    }));
}

/**
 * Deshace una venta con tarjeta. Si la venta sigue en el lote abierto del POS → ANULACIÓN, por el total.
 * Si el lote ya se cerró → DEVOLUCIÓN, total o parcial (guía V1.6: "Elegir la operación correcta"). Va al
 * POS donde se hizo la venta (el lote es de ese POS) y el cliente tiene que pasar la tarjeta.
 * Del lado del sistema, al aprobarse (registrarReversion): factura sin enviar a la DGI → se anula el
 * documento; factura aceptada → nota de crédito con la plata devuelta por la misma tarjeta.
 */
async function iniciarReversion({ uuidVenta, montoCentesimos, usuarioId, motivo }) {
    const pool = await pool_();
    const v = await leerFila(pool, { uuid: uuidVenta });
    if (!v || v.PtxTipo !== 'VENTA') throw new CobroPosError('INEXISTENTE', 'Venta con tarjeta inexistente.');
    // Una venta cobrada que el sistema NO registró (APROBADA_SIN_REGISTRAR) también se deshace desde acá: el
    // POS integrado no tiene menú de anulación (visto el 13/10). Es solo del lado del POS: en caja no hay nada
    // que revertir. Anulación por el total; devolución total o parcial. Sin rebaja de IVA (esa la resuelve
    // una persona con Resonet).
    const soloPos = v.PtxEstado === E.APROBADA_SIN_REGISTRAR;
    if (v.PtxEstado !== E.REGISTRADA && !soloPos) throw new CobroPosError('ESTADO', `La venta está en ${v.PtxEstado}: solo se anula una venta registrada o cobrada sin registrar.`);
    if (soloPos && Number(v.PtxTaxAmountCentesimos || 0) > 0) throw new CobroPosError('ESTADO', 'Esa venta tuvo rebaja de IVA y no se registró: la devolución hay que coordinarla con Resonet.');
    if (!v.PtxTicket || v.PtxAcquirer == null || !v.PtxTransactionId) throw new CobroPosError('DATOS', 'A la venta le faltan el ticket o el adquirente: no se puede anular desde el sistema.');
    const terminal = await obtenerTerminal(pool, { id: v.PtxIdTerminal });
    if (!terminal?.PteActivo) throw new CobroPosError('TERMINAL_INACTIVA', 'La terminal de esa venta no está habilitada.');

    const prev = (await pool.request().input('V', sql.BigInt, v.PtxId)
        .query('SELECT PtxEstado, PtxMontoCentesimos FROM dbo.PosTransacciones WHERE PtxVentaOrigenId = @V')).recordset;
    if (prev.some(x => EN_CURSO.includes(x.PtxEstado))) throw new CobroPosError('YA_EN_COBRO', 'Esa venta ya tiene una anulación o devolución en curso o sin resolver.');
    const total = Number(v.PtxMontoAutorizadoCentesimos ?? v.PtxMontoCentesimos);
    const devuelto = prev.filter(x => ['REGISTRADA', 'APROBADA_SIN_REGISTRAR'].includes(x.PtxEstado)).reduce((s, x) => s + Number(x.PtxMontoCentesimos), 0);
    const disponible = total - devuelto;
    if (disponible <= 0) throw new CobroPosError('ESTADO', 'Esa venta ya está devuelta entera.');

    const doc = soloPos ? null : (await pool.request().input('T', sql.Int, v.PtxTcaIdTransaccion || 0).query(`
        SELECT TOP 1 DocIdDocumento, DocEstado, CfeEstado, DocTotal, MonIdMoneda, CliIdCliente, CueIdCuenta
        FROM dbo.DocumentosContables WHERE TcaIdTransaccion = @T ORDER BY DocIdDocumento`)).recordset[0] || null;
    if (!soloPos && !doc) throw new CobroPosError('DATOS', 'No se encontró el documento de esa venta.');
    if (doc?.DocEstado === 'ANULADO') throw new CobroPosError('ESTADO', 'El documento de esa venta ya está anulado.');
    const aceptada = doc?.CfeEstado === 'ACEPTADO_DGI';

    // ¿Anulación o devolución? La decide el lote abierto de ESE POS.
    let enLote = false;
    try {
        const lote = await cliente.loteActual({ terminal: terminalPls(terminal, usuarioId) });
        if (lote.responseCode !== 0) throw new Error(`ResponseCode ${lote.responseCode}`);
        enLote = lote.transacciones.some(t => cliente.transactionIdDe(t) === String(v.PtxTransactionId));
    } catch (e) {
        throw new CobroPosError('LOTE', `No se pudo consultar el lote del POS para saber si corresponde anular o devolver: ${e.message}`);
    }
    const tipo = enLote ? 'ANULACION' : 'DEVOLUCION';
    let monto = tipo === 'ANULACION' ? disponible : (Number(montoCentesimos) || disponible);
    if (tipo === 'ANULACION' && devuelto > 0) throw new CobroPosError('ESTADO', 'La venta ya tuvo una devolución parcial: no se puede anular entera.');
    if (!Number.isSafeInteger(monto) || monto <= 0 || monto > disponible) throw new CobroPosError('MONTO_INVALIDO', `Se puede devolver hasta ${(disponible / 100).toFixed(2)}.`);
    if (!soloPos && tipo === 'DEVOLUCION' && monto < total && !aceptada) {
        throw new CobroPosError('ESTADO', 'Una devolución parcial va con nota de crédito, y la factura todavía no está aceptada por la DGI. Mandala desde la Bandeja CFE o devolvé el total.');
    }
    let intVenta = {};
    try { intVenta = JSON.parse(v.PtxIntencionJson || '{}'); } catch (e) { intVenta = {}; }
    // Cobro mixto (tarjeta + efectivo, etc.): anular el documento se llevaría también lo demás. La parte de
    // la tarjeta se devuelve con nota de crédito, que necesita la factura aceptada por la DGI.
    const mixto = Array.isArray(intVenta.pagosExtra) && intVenta.pagosExtra.length > 0;
    if (!soloPos && mixto && !aceptada) {
        throw new CobroPosError('ESTADO', 'Ese cobro fue con tarjeta y otro medio, y la factura todavía no está en la DGI. Mandala desde la Bandeja CFE y después devolvé la parte de la tarjeta (sale con nota de crédito).');
    }
    const accion = soloPos ? 'SOLO_POS' : (tipo === 'ANULACION' || monto === total) && !aceptada ? 'ANULAR_DOC' : 'NOTA_CREDITO';
    const metodoTarjeta = (await pool.request().input('P', sql.Int, v.PtxPagIdPago || 0)
        .query('SELECT MPaIdMetodoPago FROM dbo.Pagos WHERE PagIdPago = @P')).recordset[0]?.MPaIdMetodoPago || METODO_DEBITO;

    // Devolución de una venta que tuvo rebaja de IVA: la procesadora necesita el comprobante de la
    // devolución, que es la nota de crédito; su número se reserva antes, como en la venta.
    let factura = null, cae = null;
    if (!soloPos && tipo === 'DEVOLUCION' && Number(v.PtxTaxAmountCentesimos || 0) > 0) {
        try {
            const sisnet = require('../sisnetService');
            cae = await sisnet.reservarNumero(102, await empresaEmisora(pool, intVenta.empresaId));
            const grav = (await pool.request().input('D', sql.Int, doc.DocIdDocumento).query(`
                SELECT ISNULL(SUM(DcdSubtotal), 0) AS G FROM dbo.DocumentosContablesDetalle WHERE DocIdDocumento = @D AND ISNULL(DcdImpuestos, 0) > 0`)).recordset[0].G;
            factura = { numero: String(cae.numero), montoCentesimos: monto, gravadoCentesimos: Math.round(Number(grav) * 100 * monto / Math.round(Number(doc.DocTotal) * 100)), taxRefund: 1 };
        } catch (e) {
            if (cae) void anularCaeReservado(cae, intVenta.empresaId, 'devolución sin armar');
            throw new CobroPosError('SISNET', `No se pudo reservar el número de la nota de crédito: ${e.message}`);
        }
    }

    const uuid = uuidv4();
    const fecha = cliente.fechaPls();
    let ptxId;
    try {
        const ins = await pool.request()
            .input('Uuid', sql.VarChar(100), uuid)
            .input('Term', sql.Int, terminal.PteIdTerminal)
            .input('Pos', sql.VarChar(10), terminal.PtePosID)
            .input('Tipo', sql.VarChar(20), tipo)
            .input('Monto', sql.BigInt, monto)
            .input('ISO', sql.VarChar(5), v.PtxMonedaISO)
            .input('Mon', sql.Int, v.PtxMonedaId)
            .input('Int', sql.NVarChar(sql.MAX), JSON.stringify({
                accion, docId: doc?.DocIdDocumento || null, motivo: motivo || null, metodoTarjeta,
                admin: v.PteTipo === 'TOTEM' || !!(intVenta.header?.esAdministrativa || intVenta.header?.admin),
                empresaId: intVenta.empresaId || null, ventaUuid: v.PtxUuid,
            }))
            .input('Cli', sql.Int, v.PtxClienteId || null)
            .input('Usr', sql.Int, usuarioId || null)
            .input('Fecha', sql.VarChar(17), fecha)
            .input('Inv', sql.VarChar(7), factura?.numero || null)
            .input('Tax', sql.Int, factura ? 1 : 0)
            .input('Cae', sql.NVarChar(500), cae ? JSON.stringify(cae) : null)
            .input('CaeEst', sql.VarChar(20), cae ? 'RESERVADO' : null)
            .input('TEt', sql.VarChar(50), terminal.PteEtiqueta)
            .input('TTipo', sql.VarChar(20), terminal.PteTipo)
            .input('Venta', sql.BigInt, v.PtxId)
            .query(`
                INSERT INTO dbo.PosTransacciones
                    (PtxUuid, PtxIdTerminal, PtxPosID, PtxTipo, PtxEstado, PtxMontoCentesimos, PtxMonedaISO, PtxMonedaId,
                     PtxIntencionJson, PtxClienteId, PtxUsuarioId, PtxFechaPls, PtxInvoiceNumber, PtxTaxRefund,
                     PtxCaeJson, PtxCaeEstado, PtxTerminalEtiqueta, PtxTerminalTipo, PtxVentaOrigenId)
                OUTPUT INSERTED.PtxId
                VALUES (@Uuid, @Term, @Pos, @Tipo, 'CREADA', @Monto, @ISO, @Mon,
                        @Int, @Cli, @Usr, @Fecha, @Inv, @Tax, @Cae, @CaeEst, @TEt, @TTipo, @Venta)`);
        ptxId = ins.recordset[0].PtxId;
    } catch (e) {
        if (cae) void anularCaeReservado(cae, intVenta.empresaId, `${tipo.toLowerCase()} ${uuid} no creada`);
        if (/UQ_PosTransacciones_TerminalOcupada/.test(String(e.message))) throw new CobroPosError('TERMINAL_OCUPADA', `La terminal ${terminal.PteEtiqueta} tiene un cobro en curso o sin resolver.`);
        throw e;
    }

    let resp = null, error = null;
    try {
        const tPls = terminalPls(terminal, usuarioId);
        resp = tipo === 'ANULACION'
            ? await cliente.anulacion({ terminal: tPls, fecha, ticket: v.PtxTicket, acquirer: v.PtxAcquirer })
            : await cliente.devolucion({ terminal: tPls, fecha, montoCentesimos: monto, monedaISO: v.PtxMonedaISO, ticket: v.PtxTicket, fechaOriginal: String(v.PtxFechaPls || '').slice(2, 8), factura });
    } catch (e) { error = e; }
    const alta = interpretarAlta(resp, error);
    await cambiarEstado(pool, ptxId, [E.CREADA], alta.estado, {
        PtxTransactionId: alta.transactionId || null,
        PtxResponseCode: resp ? cliente.responseCodeDe(resp) : null,
        PtxRespuestaJson: resp ? JSON.stringify(filtrarRespuesta(resp)) : null,
        PtxRequiereRevision: alta.estado === E.INDETERMINADA ? 1 : undefined,
        nota: alta.motivo || `${tipo === 'ANULACION' ? 'Anulación' : 'Devolución'} de la venta #${v.PtxId}${motivo ? `: ${motivo}` : ''}`,
    });
    const fila = await leerFila(pool, { id: ptxId });
    if (alta.estado === E.INDETERMINADA) {
        await alertar(pool, fila, `ALERTA: ${tipo === 'ANULACION' ? 'anulación' : 'devolución'} con tarjeta en duda (${terminal.PteEtiqueta})`,
            `${alta.motivo}\n\nNo se sabe si la operación llegó al POS. Mirar el POS antes de volver a intentar: si se aprobó, el cliente ya recibió la plata.`);
    }
    logger.info(`${LOG} ${tipo} de la venta #${v.PtxId} (${(monto / 100).toFixed(2)}) → ${alta.estado}.`);
    return { uuid, ptxId, estado: alta.estado, tipo };
}

/**
 * La anulación/devolución se aprobó en el POS (la plata ya volvió a la tarjeta): ahora el sistema. Lo
 * llama registrar() después de ganar el claim. Si algo no cierra, a un humano con ticket: nunca se vuelve
 * a mandar al POS.
 */
async function registrarReversion(pool, fila) {
    const ptxId = fila.PtxId;
    const nombre = fila.PtxTipo === 'ANULACION' ? 'anulación' : 'devolución';
    let int = {};
    try { int = JSON.parse(fila.PtxIntencionJson || '{}'); } catch (e) { int = {}; }
    const v = await leerFila(pool, { id: fila.PtxVentaOrigenId });
    const sinRegistrar = async (motivo) => {
        await cambiarEstado(pool, ptxId, [E.APROBADA], E.APROBADA_SIN_REGISTRAR, { PtxRequiereRevision: 1, nota: motivo });
        await alertar(pool, fila, `ALERTA: ${nombre} con tarjeta aprobada SIN revertir en el sistema (${fila.PteEtiqueta})`,
            `${motivo}\n\nEl POS aprobó la ${nombre}: el cliente YA tiene la plata de vuelta en la tarjeta.\n`
            + `Falta revertir la venta en el sistema (documento #${int.docId}, venta con tarjeta #${fila.PtxVentaOrigenId}): `
            + `${int.accion === 'ANULAR_DOC' ? 'anular la factura desde la Bandeja CFE' : 'emitir la nota de crédito con devolución por tarjeta'}`
            + `${fila.PtxCaeJson ? ` con el número reservado ${(() => { try { const c = JSON.parse(fila.PtxCaeJson); return `${c.serie}-${c.numero}`; } catch (e) { return '?'; } })()}` : ''}.`);
        return false;
    };

    const pedido = Number(fila.PtxMontoCentesimos);
    const autorizado = fila.PtxMontoAutorizadoCentesimos == null ? null : Number(fila.PtxMontoAutorizadoCentesimos);
    if (autorizado !== pedido) return sinRegistrar(`El POS ${nombre === 'anulación' ? 'anuló' : 'devolvió'} ${autorizado == null ? '?' : (autorizado / 100).toFixed(2)} y se pidió ${(pedido / 100).toFixed(2)}.`);
    if (int.accion === 'SOLO_POS') {
        // La venta nunca se registró en caja: no hay documento ni pago que revertir. Devuelta entera (esta más
        // las devoluciones anteriores) → queda como no cobrada (CANCELADA libera sus órdenes y anula el número
        // de factura que tuviera reservado). Parcial → sigue cobrada sin registrar por lo que falta.
        await cambiarEstado(pool, ptxId, [E.APROBADA], E.REGISTRADA, { nota: 'Solo en el POS: la venta nunca se registró en caja.' });
        const antes = Number((await pool.request().input('V', sql.BigInt, v.PtxId).input('Id', sql.BigInt, ptxId)
            .query(`SELECT ISNULL(SUM(PtxMontoCentesimos), 0) AS M FROM dbo.PosTransacciones
                    WHERE PtxVentaOrigenId = @V AND PtxId <> @Id AND PtxEstado = 'REGISTRADA'`)).recordset[0].M);
        const totalVenta = Number(v.PtxMontoAutorizadoCentesimos ?? v.PtxMontoCentesimos);
        if (antes + pedido >= totalVenta) {
            const ok = await cambiarEstado(pool, v.PtxId, [E.APROBADA_SIN_REGISTRAR], E.CANCELADA, {
                PtxRequiereRevision: 0, nota: `${nombre === 'anulación' ? 'Anulada' : 'Devuelta'} en el POS por el cobro #${ptxId}: no quedó cobrada.`,
            });
            if (!ok) logger.warn(`${LOG} ${nombre} #${ptxId}: la venta #${v.PtxId} ya no estaba en APROBADA_SIN_REGISTRAR; se dejó como estaba.`);
        } else {
            await pool.request().input('Id', sql.BigInt, v.PtxId)
                .input('Nota', sql.NVarChar(1000), `Devolución parcial de ${(pedido / 100).toFixed(2)} por el cobro #${ptxId}; quedan ${((totalVenta - antes - pedido) / 100).toFixed(2)} cobrados sin registrar.`)
                .query(`UPDATE dbo.PosTransacciones SET PtxUpdatedAt = GETDATE(),
                            PtxObservaciones = LEFT(CONCAT(PtxObservaciones, CASE WHEN PtxObservaciones IS NULL THEN '' ELSE ' | ' END, CONVERT(VARCHAR(16), GETDATE(), 120), ' ', @Nota), 1000)
                        WHERE PtxId = @Id`);
        }
        logger.info(`${LOG} ${nombre} #${ptxId} registrada (SOLO_POS).`);
        return true;
    }
    if (Number(v?.PtxTaxAmountCentesimos || 0) > 0 || Number(fila.PtxTaxAmountCentesimos || 0) > 0) {
        return sinRegistrar('La venta tuvo rebaja de IVA (Ley 19.210): la reversión contable de la rebaja se hace a mano mientras no veamos en producción cómo la informa el POS.');
    }

    let docResultado = int.docId;
    try {
        if (int.accion === 'ANULAR_DOC') {
            const { anularFactura } = require('../../controllers/cfeController');
            const r = await llamarHandler(anularFactura, { params: { id: String(int.docId) }, user: { id: fila.PtxUsuarioId || USUARIO_SISTEMA }, body: { motivo: int.motivo } });
            if (r.status >= 300) throw new Error(r.body?.error || `anular factura: HTTP ${r.status}`);
        } else {
            const doc = (await pool.request().input('D', sql.Int, int.docId)
                .query(`SELECT CliIdCliente, CueIdCuenta, MonIdMoneda, DocTotal, DocSubtotal, DocImpuestos, DocSerie, DocNumero
                        FROM dbo.DocumentosContables WHERE DocIdDocumento = @D`)).recordset[0];
            if (!doc) throw new Error(`no existe el documento #${int.docId}`);
            const { generarNotaCredito } = require('../../controllers/cajaController');
            // NC por MENOS que el documento (devolución parcial, o la parte de la tarjeta de un cobro
            // mixto): generarNotaCredito usa `monto` para la cuenta, el egreso y el asiento, pero el
            // documento lo arma con Lineas/Totales y, si no vienen, copia los del original. Visto el
            // 13/10: devolución de $ 100 sobre ET-11304 de $ 198 → NC-000048 por $ 198.
            // Una línea por lo devuelto, con el IVA en la misma proporción que el original.
            const monto = pedido / 100;
            let parcial = {};
            if (monto < Number(doc.DocTotal) - 0.005) {
                const sub = Number(doc.DocSubtotal) || 0;
                const tasa = sub > 0 ? Math.round(Number(doc.DocImpuestos || 0) / sub * 10000) / 100 : 0;
                const subtotal = Math.round(monto / (1 + tasa / 100) * 100) / 100;
                parcial = {
                    Lineas: [{
                        concepto: `${nombre === 'anulación' ? 'Anulación' : 'Devolución'} parcial con tarjeta`,
                        DcdDscItem: `${String(doc.DocSerie || '').trim()}-${String(doc.DocNumero || '').trim()}`,
                        cantidad: 1, precioUnitario: monto, iva: tasa,
                    }],
                    Totales: { subtotal, iva: Math.round((monto - subtotal) * 100) / 100, total: monto },
                };
            }
            const req = {
                user: { id: fila.PtxUsuarioId || USUARIO_SISTEMA },
                body: {
                    docIdOrigen: int.docId, monto, ...parcial,
                    motivo: `${nombre === 'anulación' ? 'Anulación' : 'Devolución'} con tarjeta en el POS${int.motivo ? `: ${int.motivo}` : ''} (Tx: ${fila.PtxUuid})`.slice(0, 200),
                    clienteId: doc.CliIdCliente, cuentaId: doc.CueIdCuenta, monedaId: doc.MonIdMoneda,
                    destinoPlata: 'DEVOLVER', metodoPagoDevolucion: int.metodoTarjeta || METODO_DEBITO, admin: !!int.admin,
                },
            };
            let r = null;
            for (let intento = 1; intento <= 3; intento++) {
                try { r = await llamarHandler(generarNotaCredito, req); break; }
                catch (e) { if (!esDeadlock(e) || intento === 3) throw e; await new Promise(x => setTimeout(x, intento * 1000)); }
            }
            if (r.status >= 300 || !r.body?.ncId) throw new Error(r.body?.error || `nota de crédito: HTTP ${r.status}`);
            docResultado = r.body.ncId;
            if (fila.PtxCaeJson && fila.PtxCaeEstado === 'RESERVADO') {
                await pool.request().input('Id', sql.BigInt, ptxId).input('Doc', sql.Int, docResultado)
                    .query('UPDATE dbo.PosTransacciones SET PtxDocIdDocumento = @Doc WHERE PtxId = @Id');
                await emitirFacturaReservada(pool, await leerFila(pool, { id: ptxId }));
            }
        }
    } catch (e) {
        return sinRegistrar(`No se pudo revertir en el sistema: ${e.message}`);
    }

    // Reversión TOTAL con nota de crédito: la NC no toca el retiro (igual que la NC manual de la caja),
    // así que si todavía no se entregó sigue figurando como pagado. No se libera acá: con el pago vivo,
    // reponer la deuda de la orden la contaría dos veces. Aviso para que no se entregue sin cobrar.
    let avisoRetiro = '';
    if (int.accion !== 'ANULAR_DOC' && v?.PtxTcaIdTransaccion) {
        try {
            // Total = esta más las anteriores ya registradas (dos devoluciones parciales también lo son).
            const antes = Number((await pool.request().input('V', sql.BigInt, v.PtxId).input('Id', sql.BigInt, ptxId)
                .query(`SELECT ISNULL(SUM(PtxMontoCentesimos), 0) AS M FROM dbo.PosTransacciones
                        WHERE PtxVentaOrigenId = @V AND PtxId <> @Id AND PtxEstado = 'REGISTRADA'`)).recordset[0].M);
            const rts = antes + pedido < Number(v.PtxMontoAutorizadoCentesimos) ? [] : (await pool.request().input('T', sql.Int, v.PtxTcaIdTransaccion)
                .query(`SELECT OReIdOrdenRetiro FROM dbo.OrdenesRetiro
                        WHERE OReEstadoActual IN (3, 4, 8)
                          AND PagIdPago IN (SELECT PagIdPago FROM dbo.Pagos WHERE PagTcaIdTransaccion = @T)`)).recordset;
            if (rts.length) {
                const lista = rts.map(r => `RT-${r.OReIdOrdenRetiro}`).join(', ');
                avisoRetiro = ` ${lista} sigue como pagado y no se entregó.`;
                await alertar(pool, fila, `${nombre === 'anulación' ? 'Anulación' : 'Devolución'} con tarjeta: ${lista} sigue como pagado`,
                    `Se devolvió el total de la venta con tarjeta #${v.PtxId} con la nota de crédito #${docResultado}, `
                    + `pero ${lista} sigue figurando como pagado y todavía no se entregó.\n`
                    + `Si el cliente no paga de otra forma, que no se entregue la mercadería.`);
            }
        } catch (e) {
            logger.error(`${LOG} ${nombre} #${ptxId}: no se pudo revisar el retiro de la venta #${v.PtxId}: ${e.message}`);
        }
    }

    await cambiarEstado(pool, ptxId, [E.APROBADA], E.REGISTRADA, { nota: `${int.accion === 'ANULAR_DOC' ? `Documento #${int.docId} anulado` : `Nota de crédito #${docResultado}`}.${avisoRetiro}` });
    await pool.request().input('Id', sql.BigInt, ptxId).input('Doc', sql.Int, docResultado)
        .query('UPDATE dbo.PosTransacciones SET PtxDocIdDocumento = @Doc WHERE PtxId = @Id AND PtxDocIdDocumento IS NULL');
    // Nota en la venta original (sin marcarla para revisión: está todo cerrado).
    await pool.request().input('Id', sql.BigInt, v.PtxId)
        .input('Nota', sql.NVarChar(1000), `${nombre === 'anulación' ? 'Anulada' : `Devolución de ${(pedido / 100).toFixed(2)}`} por el cobro #${ptxId}.`)
        .query(`UPDATE dbo.PosTransacciones SET PtxUpdatedAt = GETDATE(),
                    PtxObservaciones = LEFT(CONCAT(PtxObservaciones, CASE WHEN PtxObservaciones IS NULL THEN '' ELSE ' | ' END, CONVERT(VARCHAR(16), GETDATE(), 120), ' ', @Nota), 1000)
                WHERE PtxId = @Id`);
    logger.info(`${LOG} ${nombre} #${ptxId} registrada (${int.accion}).`);
    return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Recuperación y barrido
// ─────────────────────────────────────────────────────────────────────────────
async function resolverAbiertasDeTerminal(pool, terminalId) {
    const r = await pool.request().input('T', sql.Int, terminalId)
        .query(`SELECT PtxId FROM dbo.PosTransacciones
                WHERE PtxIdTerminal = @T AND PtxEstado IN ('ENVIADA','ESPERANDO_POS','CAPTURADA','PENDIENTE_BILLETERA','APROBADA')
                ORDER BY PtxId`);
    for (const { PtxId } of r.recordset) {
        try { await polear({ id: PtxId }); }
        catch (e) { logger.error(`${LOG} Recuperación de #${PtxId}: ${e.message}`); }
    }
}

/**
 * Un registro que ganó el claim y no terminó: el proceso murió en el medio. Si el cobro quedó
 * asentado, se enlaza; si no, va a un humano (podría seguir en curso en otro proceso, y registrar
 * dos veces es peor que no registrar).
 */
async function cerrarClaimsColgados(pool) {
    const r = await pool.request().input('Min', sql.Int, MINUTOS_CLAIM_COLGADO)
        .query(`SELECT PtxId FROM dbo.PosTransacciones
                WHERE PtxEstado = 'APROBADA' AND PtxAprobadaAt IS NOT NULL AND PtxAprobadaAt < DATEADD(MINUTE, -@Min, GETDATE())`);
    for (const { PtxId } of r.recordset) {
        const fila = await leerFila(pool, { id: PtxId });
        const previo = await buscarRegistro(pool, fila.PtxUuid);
        if (previo) {
            await cambiarEstado(pool, PtxId, [E.APROBADA], E.REGISTRADA, { PtxTcaIdTransaccion: previo.TcaIdTransaccion, PtxPagIdPago: previo.PagIdPago, nota: 'Registro encontrado por el barrido.' });
            await emitirFacturaReservada(pool, await leerFila(pool, { id: PtxId }));
        } else {
            const motivo = `El registro empezó hace más de ${MINUTOS_CLAIM_COLGADO} min y no terminó (¿se reinició el servidor?).`;
            await cambiarEstado(pool, PtxId, [E.APROBADA], E.APROBADA_SIN_REGISTRAR, { PtxRequiereRevision: 1, nota: motivo });
            await alertar(pool, fila, `ALERTA: cobro con tarjeta aprobado SIN registrar (${fila.PteEtiqueta})`,
                `${motivo}\n\nEl cliente YA pagó con tarjeta. NO volver a cobrarle: registrar el pago a mano.`);
        }
    }
}

/**
 * Conciliación contra el lote abierto (§4.5 vector 5): lo único que ve un cobro que el POS aprobó
 * y nosotros nunca nos enteramos, porque todo lo demás mira nuestra propia tabla.
 */
async function conciliarLote(pool, terminal) {
    let lote;
    try { lote = await cliente.loteActual({ terminal: terminalPls(terminal) }); }
    catch (e) { logger.warn(`${LOG} Lote de ${terminal.PteEtiqueta}: ${e.message}`); return { revisadas: 0, alertas: 0 }; }
    if (lote.responseCode !== 0) {
        logger.warn(`${LOG} Lote de ${terminal.PteEtiqueta}: ResponseCode ${lote.responseCode}.`);
        return { revisadas: 0, alertas: 0 };
    }
    let alertas = 0;
    for (const t of lote.transacciones) {
        const txId = cliente.transactionIdDe(t);
        const pc = String(cliente.campo(t, 'PosResponseCode') || '').trim().toUpperCase();
        if (!txId || !['00', '08', '10', '11', '85', 'OF'].includes(pc)) continue;
        const nuestra = await pool.request().input('Tx', sql.VarChar(30), txId)
            .query('SELECT PtxId, PtxEstado FROM dbo.PosTransacciones WHERE PtxTransactionId = @Tx');
        const fila = nuestra.recordset[0];
        if (fila && [E.REGISTRADA, E.APROBADA, E.APROBADA_SIN_REGISTRAR, E.REVERSA_PENDIENTE, E.REVERSADA].includes(fila.PtxEstado)) continue;
        const monto = cliente.centesimosDe(cliente.campo(t, 'TotalAmount'));
        const motivo = fila
            ? `El lote del POS tiene aprobada la transacción ${txId} y el sistema la tiene en ${fila.PtxEstado} (cobro #${fila.PtxId}).`
            : `El lote del POS tiene aprobada la transacción ${txId} y el sistema no la conoce.`;
        try {
            await pool.request()
                .input('Tx', sql.VarChar(30), txId)
                .input('Pos', sql.VarChar(10), terminal.PtePosID)
                .input('Mot', sql.NVarChar(400), motivo)
                .input('Json', sql.NVarChar(sql.MAX), JSON.stringify(filtrarRespuesta(t)))
                .query('INSERT INTO dbo.PosConciliacionAlertas (PcaTransactionId, PcaPosID, PcaMotivo, PcaJson) VALUES (@Tx, @Pos, @Mot, @Json)');
        } catch (e) {
            if (/PK_PosConciliacionAlertas|duplicate|PRIMARY KEY/i.test(e.message)) continue; // ya avisada
            throw e;
        }
        alertas++;
        const filaCompleta = fila ? await leerFila(pool, { id: fila.PtxId }) : null;
        await alertar(pool, filaCompleta, `ALERTA: cobro con tarjeta en el POS que el sistema no registró (${terminal.PteEtiqueta})`,
            `${motivo}\nImporte: ${monto != null ? (monto / 100).toFixed(2) : '?'} — Ticket ${cliente.campo(t, 'Ticket') || '?'}, lote ${cliente.campo(t, 'Batch') || '?'}.\n\n`
            + `Si es un cobro hecho a mano en el POS, registrarlo en caja como siempre. Si no, puede ser plata cobrada sin asentar.`);
    }
    return { revisadas: lote.transacciones.length, alertas };
}

let ultimaConciliacion = 0;
const MINUTOS_CONCILIACION = 10;

/** Lo que corre el job: polea huérfanas, cierra claims colgados y, cada 10 min, concilia los lotes. */
async function barrido() {
    if (!cliente.estaConfigurado()) return 'POSLink no configurado';
    const pool = await pool_();
    const abiertas = await pool.request()
        .query(`SELECT PtxId FROM dbo.PosTransacciones
                WHERE PtxEstado IN ('ENVIADA','ESPERANDO_POS','CAPTURADA','PENDIENTE_BILLETERA','REVERSA_PENDIENTE')
                   OR (PtxEstado = 'APROBADA' AND PtxAprobadaAt IS NULL)
                ORDER BY PtxId`);
    for (const { PtxId } of abiertas.recordset) {
        try { await polear({ id: PtxId }); }
        catch (e) { logger.error(`${LOG} Barrido #${PtxId}: ${e.message}`); }
    }
    await cerrarClaimsColgados(pool);

    // Números de factura reservados de cobros que terminaron sin cobrar y no se pudieron anular todavía.
    const sinAnular = await pool.request().query(`
        SELECT PtxId FROM dbo.PosTransacciones
        WHERE PtxCaeEstado IN ('RESERVADO','ERROR_ANULAR')
          AND PtxEstado IN ('RECHAZADA','CANCELADA','ERROR_VALIDACION','REVERSADA')`);
    for (const { PtxId } of sinAnular.recordset) await anularCaeDeFila(pool, PtxId);

    let conc = '';
    if (Date.now() - ultimaConciliacion >= MINUTOS_CONCILIACION * 60 * 1000) {
        ultimaConciliacion = Date.now();
        const ts = await pool.request().query('SELECT * FROM dbo.PosTerminales WHERE PteActivo = 1');
        let alertas = 0;
        for (const t of ts.recordset) {
            try { alertas += (await conciliarLote(pool, t)).alertas; }
            catch (e) { logger.error(`${LOG} Conciliación de ${t.PteEtiqueta}: ${e.message}`); }
        }
        conc = `, lotes de ${ts.recordset.length} terminal(es) conciliados (${alertas} alerta(s))`;
    }
    return `${abiertas.recordset.length} cobro(s) abiertos revisados${conc}`;
}

/**
 * Cierre manual de un caso que necesitaba un humano (INDETERMINADA, PEDIR_AUTORIZACION,
 * PENDIENTE_BILLETERA, APROBADA_SIN_REGISTRAR, REVERSA_PENDIENTE). Hasta que haya pantalla, se usa
 * desde scripts/poslinkProbar.js. `estadoFinal`: CANCELADA (no se cobró nada), REGISTRADA (se
 * registró a mano en caja), APROBADA (se confirmó aprobado en el POS: lo registra el sistema) o,
 * solo desde REVERSA_PENDIENTE, REVERSADA.
 * REVERSA_PENDIENTE entra porque puede no cerrarse nunca sola: en homologación (13/10), con la red
 * del POS cortada antes de pasar la tarjeta, la consulta siguió en 12 / 0 s sin State después de la
 * reversa acusada, una venta cancelada en el POS y un cierre de lote. Sin esto el retiro quedaba
 * bloqueado para siempre (el candado B no se libera en REVERSA_PENDIENTE).
 */
async function resolverManual({ uuid, id, estadoFinal, usuarioId, nota }) {
    const pool = await pool_();
    const fila = await leerFila(pool, { uuid, id });
    if (!fila) throw new Error('Cobro inexistente.');
    const desde = [E.INDETERMINADA, E.PEDIR_AUTORIZACION, E.PENDIENTE_BILLETERA, E.APROBADA_SIN_REGISTRAR, E.REVERSA_PENDIENTE];
    if (!desde.includes(fila.PtxEstado)) throw new Error(`El cobro está en ${fila.PtxEstado}: no se resuelve a mano.`);
    if (fila.PtxEstado === E.REVERSA_PENDIENTE) {
        // Lo único que se puede afirmar a mano es que no quedó nada debitado (reversada o nunca cobrada).
        if (![E.REVERSADA, E.CANCELADA].includes(estadoFinal)) throw new Error('Una reversa pendiente se cierra como REVERSADA o CANCELADA.');
    } else if (![E.CANCELADA, E.REGISTRADA, E.APROBADA].includes(estadoFinal)) throw new Error('Estado final: CANCELADA, REGISTRADA o APROBADA.');
    if (estadoFinal === E.APROBADA && fila.PtxEstado === E.APROBADA_SIN_REGISTRAR) throw new Error('Ya se intentó registrar: cerrarlo como REGISTRADA después de hacerlo a mano.');
    // "Se cobró" desde un caso en duda: quien resuelve confirma el importe COMPLETO (así lo dice la
    // pantalla). Sin esto, registrar() lo rechaza por no tener monto autorizado. Otro importe → a mano.
    const autorizado = estadoFinal === E.APROBADA && fila.PtxMontoAutorizadoCentesimos == null ? Number(fila.PtxMontoCentesimos) : undefined;
    const ok = await cambiarEstado(pool, fila.PtxId, [fila.PtxEstado], estadoFinal, {
        PtxRequiereRevision: 0,
        PtxMontoAutorizadoCentesimos: autorizado,
        nota: `Resuelto a mano por usuario ${usuarioId || '?'}: ${nota || estadoFinal}`,
    });
    if (ok && estadoFinal === E.APROBADA) await registrar(pool, fila.PtxId);
    return leerFila(pool, { id: fila.PtxId });
}

/**
 * Casos que el sistema no puede cerrar solo y esperan a una persona (pantalla "Para revisar" de
 * Cobros con tarjeta). Cada uno trae las opciones que acepta resolverManual desde su estado.
 */
const OPCIONES_REVISION = {
    [E.INDETERMINADA]: [E.CANCELADA, E.APROBADA, E.REGISTRADA],
    [E.PEDIR_AUTORIZACION]: [E.CANCELADA, E.REGISTRADA],
    [E.PENDIENTE_BILLETERA]: [E.CANCELADA, E.APROBADA, E.REGISTRADA],
    [E.APROBADA_SIN_REGISTRAR]: [E.REGISTRADA, E.CANCELADA],
    [E.REVERSA_PENDIENTE]: [E.REVERSADA, E.CANCELADA],
};

async function casosParaRevisar() {
    const pool = await pool_();
    const estados = Object.keys(OPCIONES_REVISION);
    const req = pool.request();
    estados.forEach((e, i) => req.input(`E${i}`, sql.VarChar(30), e));
    const r = await req.query(`
        SELECT p.PtxUuid, p.PtxId, p.PtxTipo, p.PtxEstado, p.PtxMontoCentesimos, p.PtxMontoAutorizadoCentesimos, p.PtxMonedaId,
               p.PtxCardNumber, p.PtxTicket, p.PtxAuthorizationCode, p.PtxTransactionId, p.PtxPosResponseCode, p.PtxVentaOrigenId,
               p.PtxObservaciones, CONVERT(VARCHAR(16), p.PtxCreatedAt, 120) AS Fecha,
               DATEDIFF(MINUTE, p.PtxUpdatedAt, GETDATE()) AS MinutosQuieto,
               COALESCE(p.PtxTerminalEtiqueta, t.PteEtiqueta) AS Terminal, COALESCE(p.PtxTerminalTipo, t.PteTipo) AS TerminalTipo,
               LTRIM(RTRIM(c.Nombre)) AS Cliente,
               COALESCE(JSON_VALUE(p.PtxIntencionJson, '$.aplicaciones[0].codigoRef'), JSON_VALUE(v.PtxIntencionJson, '$.aplicaciones[0].codigoRef')) AS Referencia,
               JSON_VALUE(p.PtxIntencionJson, '$.prueba') AS Prueba
        FROM dbo.PosTransacciones p
        JOIN dbo.PosTerminales t ON t.PteIdTerminal = p.PtxIdTerminal
        LEFT JOIN dbo.PosTransacciones v ON v.PtxId = p.PtxVentaOrigenId
        LEFT JOIN dbo.Clientes c ON c.CliIdCliente = p.PtxClienteId
        WHERE p.PtxEstado IN (${estados.map((_, i) => `@E${i}`).join(',')})
        ORDER BY p.PtxId DESC`);
    return r.recordset.map(x => ({
        uuid: x.PtxUuid,
        id: Number(x.PtxId),
        tipo: x.PtxTipo,
        estado: x.PtxEstado,
        opciones: [
            ...(x.PtxEstado === E.APROBADA_SIN_REGISTRAR && x.PtxTipo === 'VENTA' && x.PtxTicket && x.PtxTicket !== '0' ? ['ANULAR_POS'] : []),
            ...(OPCIONES_REVISION[x.PtxEstado] || []),
        ],
        fecha: x.Fecha,
        minutosQuieto: x.MinutosQuieto,
        terminal: x.Terminal,
        enTotem: x.TerminalTipo === 'TOTEM',
        cliente: x.Cliente,
        referencia: x.Referencia,
        prueba: x.Prueba === 'true',
        moneda: x.PtxMonedaId === 2 ? 'USD' : 'UYU',
        monto: Number(x.PtxMontoCentesimos) / 100,
        autorizado: x.PtxMontoAutorizadoCentesimos == null ? null : Number(x.PtxMontoAutorizadoCentesimos) / 100,
        tarjeta: x.PtxCardNumber ? String(x.PtxCardNumber).slice(-4) : null,
        ticket: x.PtxTicket || null,
        autorizacion: x.PtxAuthorizationCode || null,
        transactionId: x.PtxTransactionId || null,
        posResponseCode: x.PtxPosResponseCode || null,
        observaciones: x.PtxObservaciones || null,
    }));
}

async function obtenerCobro({ uuid, id }) {
    return leerFila(await pool_(), { uuid, id });
}

module.exports = {
    CobroPosError,
    altaTerminal,
    activarTerminal,
    iniciarVenta,
    iniciarCobroCaja,
    polear,
    cancelar,
    cerrarSinCobro,
    resolverManual,
    obtenerCobro,
    estadoPublico,
    ventasAnulables,
    casosParaRevisar,
    iniciarReversion,
    terminalesCaja,
    referenciasEnCobro,
    caeReservadoDeDocumento,
    marcarCaeUsado,
    barrido,
    estaConfigurado: cliente.estaConfigurado,
    _interno: { asegurarEsquema, revalidar },
};
