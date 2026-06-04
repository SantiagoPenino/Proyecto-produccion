/**
 * fix_saldo_banderas.js
 * Anula el movimiento VTA_CAJA duplicado de BANDERAS PERSONALIZADAS
 * y recalcula el CueSaldoActual correctamente.
 *
 * Movimientos afectados (CueId=1649, CliId=2201):
 *   MovId=5  ORDEN      -103.6  → legítimo (orden preexistente)
 *   MovId=8  VTA_CAJA   -103.6  → DUPLICADO — este anulamos
 *   MovId=9  PAGO       +103.6  → legítimo
 *
 * Saldo correcto después: -103.6 + 103.6 = 0
 */
const { getPool, sql } = require('./config/db');

(async () => {
    const pool = await getPool();

    // 1. Verificar estado actual
    const antes = await pool.request().query(`
        SELECT mc.MovIdMovimiento, mc.MovTipo, mc.MovImporte, mc.MovAnulado, cc.CueSaldoActual
        FROM dbo.MovimientosCuenta mc
        JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = mc.CueIdCuenta
        WHERE mc.CueIdCuenta = 1649
        ORDER BY mc.MovIdMovimiento
    `);
    console.log('=== ANTES ===');
    antes.recordset.forEach(r => console.log(`  MovId=${r.MovIdMovimiento} ${r.MovTipo} ${r.MovImporte} anulado=${r.MovAnulado} | CueSaldo=${r.CueSaldoActual}`));

    // 2. Anular el VTA_CAJA duplicado (MovId=8) y revertir su efecto en CueSaldoActual
    //    El VTA_CAJA tenía MovImporte=-103.6, lo anulamos sumando +103.6 al saldo
    const transaction = pool.transaction();
    await transaction.begin();
    try {
        // Marcar como anulado
        await new sql.Request(transaction).query(`
            UPDATE dbo.MovimientosCuenta
            SET MovAnulado = 1, MovObservaciones = 'Anulado: VTA_CAJA duplicado (ya existia ORDEN previo)'
            WHERE MovIdMovimiento = 8
        `);

        // Revertir el efecto en CueSaldoActual: el VTA_CAJA era -103.6, lo deshacemos sumando +103.6
        await new sql.Request(transaction).query(`
            UPDATE dbo.CuentasCliente
            SET CueSaldoActual = CueSaldoActual + 103.6
            WHERE CueIdCuenta = 1649
        `);

        await transaction.commit();
        console.log('\n✅ VTA_CAJA duplicado (MovId=8) anulado y saldo corregido.');
    } catch (e) {
        await transaction.rollback();
        console.error('❌ Error, rollback:', e.message);
        process.exit(1);
    }

    // 3. Verificar estado final
    const despues = await pool.request().query(`
        SELECT mc.MovIdMovimiento, mc.MovTipo, mc.MovImporte, mc.MovAnulado, cc.CueSaldoActual
        FROM dbo.MovimientosCuenta mc
        JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = mc.CueIdCuenta
        WHERE mc.CueIdCuenta = 1649
        ORDER BY mc.MovIdMovimiento
    `);
    console.log('\n=== DESPUES ===');
    despues.recordset.forEach(r => console.log(`  MovId=${r.MovIdMovimiento} ${r.MovTipo} ${r.MovImporte} anulado=${r.MovAnulado} | CueSaldo=${r.CueSaldoActual}`));

    process.exit(0);
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
