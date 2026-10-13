/**
 * poslinkTotemService.js — cobro con tarjeta en el tótem de autogestión (F3 de
 * docs/poslink-implementacion-plan.md). Reusa todo lo de la caja (iniciarCobroCaja: ensayo, candados,
 * rebaja de IVA, registro) con lo que cambia en autogestión:
 *
 *   · Cada tótem tiene SU terminal. Se identifica con una clave propia del POS (no el token del tótem,
 *     que comparten los dos equipos): se guarda hasheada en PosTerminales.PteTokenHash y viaja en el
 *     header X-Totem-Pos. Sin clave válida, el tótem no cobra.
 *   · El importe lo calcula el servidor con getClientePickupOrders, la misma función que le muestra los
 *     importes al cliente en pantalla. Nunca se usa un total que mande el tótem.
 *   · El retiro se crea ANTES de cobrar, como el tótem hace hoy. Si la tarjeta no pasa, el cliente
 *     prueba de nuevo (reintentar) o paga en la caja con su ticket: lo mismo que pasa hoy sin POS.
 *   · Sin cajera: caja administrativa (como Handy y MercadoPago), reversa automática si el POS tomó la
 *     tarjeta y venció sin respuesta, y "pedir autorización" se trata como rechazo (poslinkEstados).
 */
const crypto = require('crypto');
const { getPool, sql } = require('../../config/db');
const logger = require('../../utils/logger');
const { rollbackSeguro } = require('../../utils/rollbackSeguro');
const { esDeadlock } = require('../../utils/reintentarDeadlock');
const pos = require('./poslinkService');

const LOG = '[POSLINK TÓTEM]';
const USUARIO_SISTEMA = 999;
const METODO_POS_ID = -1;          // la línea "Tarjeta (POS)" que entiende iniciarCobroCaja
const hashClave = (clave) => crypto.createHash('sha256').update(String(clave || '').trim()).digest();

// ─────────────────────────────────────────────────────────────────────────────
// Clave del POS de cada tótem
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Genera una clave nueva para una terminal de tótem y guarda solo su hash. La clave se muestra UNA vez
 * (scripts/poslinkProbar.js clave <ETIQUETA>) y se activa en el equipo con /totem?pos=CLAVE.
 */
async function generarClave(terminalId) {
    const clave = crypto.randomBytes(24).toString('base64url');
    const pool = await getPool();
    const r = await pool.request().input('Id', sql.Int, terminalId).input('H', sql.VarBinary(64), hashClave(clave))
        .query(`UPDATE dbo.PosTerminales SET PteTokenHash = @H WHERE PteIdTerminal = @Id AND PteTipo = 'TOTEM'`);
    if (!r.rowsAffected?.[0]) throw new Error('Solo una terminal de tipo TOTEM lleva clave.');
    cache = null;
    return clave;
}

// Las claves se leen de la base cada 60 s, no en cada pedido del tótem (polea cada 2,5 s mientras cobra).
let cache = null, cacheAt = 0;
async function terminalPorClave(clave) {
    if (!clave) return null;
    if (!cache || Date.now() - cacheAt > 60000) {
        const pool = await getPool();
        const ex = await pool.request().query(`SELECT OBJECT_ID('dbo.PosTerminales', 'U') AS Id`);
        if (ex.recordset[0].Id == null) { cache = []; cacheAt = Date.now(); return null; }
        const r = await pool.request().query(`
            SELECT PteIdTerminal, PteEtiqueta, PteTokenHash FROM dbo.PosTerminales
            WHERE PteTipo = 'TOTEM' AND PteActivo = 1 AND PteTokenHash IS NOT NULL`);
        cache = r.recordset;
        cacheAt = Date.now();
    }
    const h = hashClave(clave);
    const t = cache.find(x => Buffer.isBuffer(x.PteTokenHash) && x.PteTokenHash.length === h.length && crypto.timingSafeEqual(x.PteTokenHash, h));
    return t ? { PteIdTerminal: t.PteIdTerminal, PteEtiqueta: t.PteEtiqueta } : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cobro
// ─────────────────────────────────────────────────────────────────────────────
const monedaDe = (c) => (/US|U\$|USD/i.test(String(c || '')) ? 'USD' : 'UYU');
const r2 = (n) => Math.round(Number(n) * 100) / 100;

/**
 * Crea el retiro con las órdenes elegidas y manda al POS del tótem lo que falta pagar.
 * @param {object} p { terminal: {PteIdTerminal, PteEtiqueta}, clientId: IDCliente, orders: [códigos] }
 * @returns {{ cobro, retiro: { id, codigo } }}
 */
async function iniciarCobroTotem({ terminal, clientId, orders }) {
    const r = await prepararRetiroTotem({ clientId, orders, origen: `tótem ${terminal.PteEtiqueta}` });
    try {
        const cobro = await cobrarRetiro({ terminal, cliente: r.cliente, retiroId: r.retiroId, codigo: r.codigo, moneda: r.moneda, total: r.total, aPagar: r.aPagar });
        return { cobro, retiro: { id: r.retiroId, codigo: r.codigo } };
    } catch (e) {
        // El retiro ya existe: el tótem imprime el ticket y el cliente paga en la caja, como hoy.
        e.retiro = { id: r.retiroId, codigo: r.codigo };
        throw e;
    }
}

/**
 * Lo común a pagar en el tótem (tarjeta o MercadoPago): valida las órdenes elegidas, calcula lo que falta
 * pagar con la misma función que le muestra los importes al cliente, y crea el retiro RT como hoy.
 * @returns {{ cliente, elegidas, aPagar, moneda, total, retiroId, codigo }}
 */
async function prepararRetiroTotem({ clientId, orders, origen }) {
    const ids = Array.isArray(orders) ? orders.map(String) : [];
    if (!clientId || !ids.length) throw new pos.CobroPosError('DATOS', 'Faltan el cliente o las órdenes.');
    const pool = await getPool();

    const cli = (await pool.request().input('Id', sql.VarChar(50), String(clientId))
        .query(`SELECT CliIdCliente, CodCliente, FormaEnvioID, ESTADO FROM dbo.Clientes WHERE IDCliente = @Id`)).recordset[0];
    if (!cli) throw new pos.CobroPosError('DATOS', 'Cliente no encontrado.');
    if (cli.ESTADO === 'BLOQUEADO') throw new pos.CobroPosError('BLOQUEADO', 'Cuenta bloqueada. Contactá con USER.');

    // El importe sale de la misma función que le muestra los importes al cliente.
    const { getClientePickupOrders } = require('../../controllers/webOrdersController');
    const disponibles = await getClientePickupOrders(pool, cli.CliIdCliente);
    const elegidas = disponibles.filter(o => ids.includes(String(o.id)));
    if (elegidas.length !== new Set(ids).size) {
        throw new pos.CobroPosError('NO_DISPONIBLES', 'Alguna de las órdenes ya no está disponible. Volvé a buscarlas.');
    }
    const aPagar = elegidas.filter(o => !o.isPaid && Number(o.amount) > 0);
    if (!aPagar.length) throw new pos.CobroPosError('NADA_QUE_PAGAR', 'Estas órdenes ya están pagas.');
    const monedas = [...new Set(aPagar.map(o => monedaDe(o.currency)))];
    if (monedas.length > 1) throw new pos.CobroPosError('MONEDAS_MEZCLADAS', 'Hay órdenes en pesos y en dólares: pagalas en la caja.');
    const moneda = monedas[0];
    const total = r2(aPagar.reduce((s, o) => s + Number(o.amount), 0));

    // El retiro, como lo crea hoy el tótem (totemCreatePickup), con el total calculado acá.
    const { crearRetiro } = require('../retiroService');
    let retiroId = null;
    for (let intento = 1; intento <= 3 && !retiroId; intento++) {
        const tx = new sql.Transaction(pool);
        try {
            await tx.begin();
            retiroId = await crearRetiro(tx, {
                ordIds: elegidas.map(o => o.rawId),
                totalCost: total,
                lugarRetiro: 5,
                usuarioAlta: 70,
                formaRetiro: 'RT',
                codCliente: parseInt(cli.CodCliente, 10) || null,
                moneda,
            });
            await tx.commit();
        } catch (e) {
            await rollbackSeguro(tx, `tótem crearRetiro (${clientId})`);
            retiroId = null;
            if (!esDeadlock(e) || intento === 3) throw e;
            await new Promise(r => setTimeout(r, intento * 300));
        }
    }
    const codigo = `RT-${retiroId}`;
    logger.info(`${LOG} ${origen}: retiro ${codigo} creado para cobrar ${moneda} ${total}.`);
    return { cliente: cli, elegidas, aPagar, moneda, total, retiroId, codigo };
}

/** Manda al POS el cobro de un retiro ya creado (primera vez o reintento). */
async function cobrarRetiro({ terminal, cliente, retiroId, codigo, moneda, total, aPagar }) {
    const pool = await getPool();
    let cotizacion = null;
    if (moneda === 'USD') {
        const c = await pool.request().query('SELECT TOP 1 CotDolar FROM dbo.Cotizaciones ORDER BY CotFecha DESC');
        cotizacion = c.recordset[0]?.CotDolar || null;
    }
    const deudaPuraUSD = moneda === 'USD' ? total : 0;
    const deudaPuraUYU = moneda === 'UYU' ? total : 0;
    const r = await pos.iniciarCobroCaja({
        terminal: terminal.PteIdTerminal,
        header: {
            clienteId: cliente.CliIdCliente,
            tipoDocumento: '07',            // e-Ticket contado, como los webhooks de Handy y MercadoPago
            moneda, cotizacion,
            deudaPuraUSD, deudaPuraUYU,
            esAdministrativa: true,
            observaciones: `Tótem ${terminal.PteEtiqueta} · ${codigo}${aPagar ? ` · ${aPagar.map(o => o.id).join(', ')}` : ''}`.slice(0, 300),
        },
        aplicaciones: [{ tipo: 'ORDEN_RETIRO', referenciaId: retiroId, codigoRef: codigo, descripcion: `Retiro ${codigo} (tótem)`, montoOriginal: total }],
        pagos: [{ metodoPagoId: METODO_POS_ID, moneda, monedaId: moneda === 'USD' ? 2 : 1, montoOriginal: total, cotizacion }],
        posIndex: 0,
        usuarioId: USUARIO_SISTEMA,
    });
    return pos.estadoPublico(await pos.obtenerCobro({ uuid: r.uuid }));
}

/**
 * Otra vez el mismo retiro, después de un cobro que terminó SIN cobrar (rechazo, cancelación, venció).
 * El importe sale del cobro anterior; el ensayo y la revalidación vuelven a comprobar que el retiro
 * siga sin pago.
 */
async function reintentar({ terminal, uuid }) {
    const f = await deEsteTotem(terminal, uuid);
    if (!['RECHAZADA', 'CANCELADA', 'ERROR_VALIDACION', 'REVERSADA'].includes(f.PtxEstado)) {
        throw new pos.CobroPosError('ESTADO', 'Ese cobro no terminó sin cobrar: no se puede reintentar.');
    }
    const intencion = JSON.parse(f.PtxIntencionJson || '{}');
    const ap = intencion.aplicaciones?.[0];
    if (!ap || ap.tipo !== 'ORDEN_RETIRO') throw new pos.CobroPosError('DATOS', 'El cobro anterior no era de un retiro.');
    const cli = { CliIdCliente: intencion.header.clienteId };
    const moneda = f.PtxMonedaId === 2 ? 'USD' : 'UYU';
    return cobrarRetiro({
        terminal, cliente: cli, retiroId: ap.referenciaId, codigo: ap.codigoRef || `RT-${ap.referenciaId}`,
        moneda, total: Number(f.PtxMontoCentesimos) / 100, aPagar: null,
    });
}

/** El cobro tiene que ser de la terminal de ESTE tótem: un tótem no consulta ni cancela cobros de otro. */
async function deEsteTotem(terminal, uuid) {
    const f = await pos.obtenerCobro({ uuid });
    if (!f || f.PtxIdTerminal !== terminal.PteIdTerminal) throw new pos.CobroPosError('INEXISTENTE', 'Cobro inexistente.');
    return f;
}

async function consultar({ terminal, uuid }) {
    await deEsteTotem(terminal, uuid);
    return pos.estadoPublico(await pos.polear({ uuid }));
}

async function cancelar({ terminal, uuid }) {
    await deEsteTotem(terminal, uuid);
    const r = await pos.cancelar({ uuid });
    return { cancelada: !!r?.cancelada, motivo: r?.motivo || null, cobro: pos.estadoPublico(r?.fila) };
}

module.exports = { generarClave, terminalPorClave, iniciarCobroTotem, prepararRetiroTotem, reintentar, consultar, cancelar };
