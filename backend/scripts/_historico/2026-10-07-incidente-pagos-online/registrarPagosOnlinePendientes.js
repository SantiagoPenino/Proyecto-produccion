/**
 * registrarPagosOnlinePendientes.js — Script de UNA SOLA VEZ (incidente 07/10/2026).
 *
 * Entre 12:12 y 12:58 una transacción abierta bloqueó PedidosCobranza y los webhooks
 * de MercadoPago/Handy marcaron los pagos como cobrados (PaidAt) pero procesarTransaccion
 * falló por timeout. Los reintentos del webhook se ignoran como "duplicados", así que
 * estos pagos no se registran solos.
 *
 * Este script registra cada pago con EXACTAMENTE el mismo payload que usa el webhook
 * (webOrdersController: Handy ~L6591, MP ~L7305).
 *
 * Uso (desde la carpeta del backend):
 *   node scripts/registrarPagosOnlinePendientes.js             → SIMULACIÓN (no escribe nada)
 *   node scripts/registrarPagosOnlinePendientes.js --ejecutar  → registra los pagos
 *
 * Controles por cada pago (si alguno falla, ese pago se SALTEA):
 *   - La transacción existe y está aprobada/pagada.
 *   - El retiro existe y NO tiene PagIdPago.
 *   - No hay ninguna TransaccionesCaja con ese TransactionId en las observaciones.
 *   - MP: se consulta el pago real en la API de MercadoPago (monto, moneda, estado, referencia).
 *
 * No genera el comprobante PDF del pago online (eso lo hace el webhook aparte).
 */
const { getPool, sql } = require('../config/db');
const axios = require('axios');

const EJECUTAR = process.argv.includes('--ejecutar');

const PENDIENTES = [
    { gateway: 'MP',    txId: 'a19f2c14-bc1e-4d85-a8e5-f4fd08ee1829' }, // RW-31463
    { gateway: 'MP',    txId: '254aee64-2c0b-4483-9a6a-097f1e103c8a' }, // RW-31465
    { gateway: 'MP',    txId: '2f8a20fb-2356-4c5c-8564-e3da2ba44d43' }, // RW-31468
    { gateway: 'MP',    txId: '3347bd98-fa05-4c85-a706-65153eb41ec0' }, // RW-31477
    { gateway: 'MP',    txId: '8cc7c720-c783-4dc6-815f-a81bc3296ddc' }, // RW-31494
    { gateway: 'HANDY', txId: '541c6d23-1a6a-473e-b96f-99115ff97544' }, // RW-31464
    { gateway: 'HANDY', txId: '00cb63fd-ca39-43dc-a743-364acda97a05' }, // RW-31471
    { gateway: 'HANDY', txId: '8d8816ea-4153-4684-a65f-7162cd289557' }, // RW-31479
    { gateway: 'HANDY', txId: '9e8ae009-7daa-4a51-9585-dae9687e4a91' }, // RW-31481
];

const parseRetiroId = (codigo) => parseInt(String(codigo || '').replace(/^[A-Za-z]+-0*/, ''), 10);

async function prepararMP(pool, txId) {
    const r = await pool.request().input('tx', sql.VarChar(100), txId)
        .query('SELECT TransactionId, Status, PaymentId, OrdersJson, CodCliente, PaidAt FROM MercadoPagoTransactions WHERE TransactionId = @tx');
    const tx = r.recordset[0];
    if (!tx) throw new Error('No existe en MercadoPagoTransactions');
    if (tx.Status !== 'approved') throw new Error(`Status = ${tx.Status} (no approved)`);
    if (!tx.PaymentId) throw new Error('Sin PaymentId: no se puede verificar en MercadoPago');

    // Monto y moneda REALES del cobro (igual que el webhook: paymentData.transaction_amount)
    const mp = await axios.get(`https://api.mercadopago.com/v1/payments/${tx.PaymentId}`, {
        headers: { Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}` },
    });
    const p = mp.data;
    if (p.status !== 'approved') throw new Error(`MercadoPago dice status = ${p.status}`);
    if (String(p.external_reference) !== txId) throw new Error(`external_reference no coincide (${p.external_reference})`);

    const stored = JSON.parse(tx.OrdersJson || '{}');
    const moneda = p.currency_id === 'USD' ? 'USD' : 'UYU';
    return {
        codCliente: tx.CodCliente,
        retiroId: parseRetiroId(stored.ordenRetiro),
        monto: p.transaction_amount,
        moneda,
        metodoPagoId: 10, // MercadoPago
        observaciones: `Cobro MercadoPago (Tx: ${txId})`,
    };
}

async function prepararHandy(pool, txId) {
    const r = await pool.request().input('tx', sql.VarChar(100), txId)
        .query('SELECT TransactionId, Status, TotalAmount, Currency, OrdersJson, OrdenRetiroCreada, CodCliente, PaidAt FROM HandyTransactions WHERE TransactionId = @tx');
    const tx = r.recordset[0];
    if (!tx) throw new Error('No existe en HandyTransactions');
    if (tx.Status !== 'Pagado') throw new Error(`Status = ${tx.Status} (no Pagado)`);

    const stored = JSON.parse(tx.OrdersJson || '{}');
    const moneda = tx.Currency === 840 ? 'USD' : 'UYU';
    return {
        codCliente: tx.CodCliente,
        retiroId: parseRetiroId(stored.ordenRetiro || tx.OrdenRetiroCreada),
        monto: tx.TotalAmount,
        moneda,
        metodoPagoId: 9, // Handy
        observaciones: `Cobro Handy (Tx: ${txId})`,
    };
}

async function main() {
    const pool = await getPool();
    const { procesarTransaccion } = require('../services/cajaService');

    console.log(EJECUTAR ? '=== MODO EJECUCIÓN: se registran los pagos ===' : '=== SIMULACIÓN: no se escribe nada (usar --ejecutar) ===');

    let ok = 0, salteados = 0;
    for (const { gateway, txId } of PENDIENTES) {
        const tag = `[${gateway} ${txId.slice(0, 8)}]`;
        try {
            const d = gateway === 'MP' ? await prepararMP(pool, txId) : await prepararHandy(pool, txId);
            if (isNaN(d.retiroId)) throw new Error('No se pudo obtener el retiro');

            // Idempotencia: el retiro no debe tener pago
            const ret = await pool.request().input('RID', sql.Int, d.retiroId)
                .query('SELECT OReIdOrdenRetiro, PagIdPago FROM OrdenesRetiro WHERE OReIdOrdenRetiro = @RID');
            if (!ret.recordset[0]) throw new Error(`No existe el retiro RW-${d.retiroId}`);
            if (ret.recordset[0].PagIdPago) throw new Error(`RW-${d.retiroId} YA tiene PagIdPago ${ret.recordset[0].PagIdPago}`);

            // Idempotencia: ninguna transacción de caja con este TransactionId
            const dup = await pool.request().input('Obs', sql.VarChar(200), `%${txId}%`)
                .query('SELECT TOP 1 TcaIdTransaccion FROM TransaccionesCaja WHERE TcaObservaciones LIKE @Obs');
            if (dup.recordset[0]) throw new Error(`Ya existe TransaccionesCaja ${dup.recordset[0].TcaIdTransaccion} con este Tx`);

            const cli = await pool.request().input('Cod', sql.Int, d.codCliente)
                .query('SELECT CliIdCliente FROM Clientes WHERE CodCliente = @Cod');
            const cliIdCliente = cli.recordset[0]?.CliIdCliente;
            if (!cliIdCliente) throw new Error(`No se encontró el cliente CodCliente=${d.codCliente}`);

            const monedaId = d.moneda === 'USD' ? 2 : 1;
            console.log(`${tag} RW-${d.retiroId} · cliente ${d.codCliente} (Cli ${cliIdCliente}) · ${d.moneda} ${d.monto} · método ${d.metodoPagoId}`);

            if (!EJECUTAR) { ok++; continue; }

            const result = await procesarTransaccion({
                usuarioId: 999,
                header: {
                    clienteId: cliIdCliente,
                    esAdministrativa: true,
                    tipoDocumento: '07', // E-Ticket Contado
                    moneda: d.moneda,
                    observaciones: d.observaciones,
                },
                aplicaciones: [{
                    tipo: 'ORDEN_RETIRO',
                    referenciaId: d.retiroId,
                    montoOriginal: d.monto,
                    descripcion: `Retiro diferido RW-${d.retiroId}`,
                }],
                pagos: [{
                    metodoPagoId: d.metodoPagoId,
                    monedaId,
                    moneda: d.moneda,
                    montoOriginal: d.monto,
                    cotizacion: 1,
                }],
            });

            if (gateway === 'MP') {
                await pool.request().input('RID', sql.Int, d.retiroId).input('Ref', sql.VarChar(200), txId)
                    .query('UPDATE OrdenesRetiro SET ReferenciaPagoOnline = @Ref WHERE OReIdOrdenRetiro = @RID');
            }

            console.log(`${tag} ✅ Registrado: PagoId=${result.pagosCreados?.[0]?.pagIdPago} TcaId=${result.tcaIdTransaccion}`);
            ok++;
        } catch (e) {
            salteados++;
            console.error(`${tag} ⛔ SALTEADO: ${e.message}`);
        }
    }

    console.log(`\nResumen: ${ok} ${EJECUTAR ? 'registrados' : 'listos para registrar'}, ${salteados} salteados.`);
    process.exit(0);
}

main().catch(e => { console.error('Error fatal:', e); process.exit(1); });
