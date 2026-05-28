const { getPool, sql } = require('../config/db');

async function run() {
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            console.log("Starting DB correction transaction...");

            // 1. Correct PedidosCobranzaDetalle for the Corte Laser line (ID = 2430)
            // It was UYU 40 / UYU 4800, now converted to USD 0.98 / USD 117.97
            console.log("Updating PedidosCobranzaDetalle...");
            await new sql.Request(transaction)
                .query(`
                    UPDATE PedidosCobranzaDetalle
                    SET PrecioUnitario = 0.98,
                        Subtotal = 117.97,
                        Moneda = 'USD'
                    WHERE ID = 2430
                `);

            // 2. Correct MovimientosCuenta
            // MovIdMovimiento 42 (ORDEN): was -4800 USD, should be -117.97 USD
            console.log("Updating MovimientosCuenta ORDEN (42)...");
            await new sql.Request(transaction)
                .query("UPDATE MovimientosCuenta SET MovImporte = -117.97 WHERE MovIdMovimiento = 42");

            // MovIdMovimiento 43 (PAGO_CRUZADO UYU): was -22152.45 UYU, should be -4800.00 UYU
            console.log("Updating MovimientosCuenta PAGO_CRUZADO UYU (43)...");
            await new sql.Request(transaction)
                .query("UPDATE MovimientosCuenta SET MovImporte = -4800.00 WHERE MovIdMovimiento = 43");

            // MovIdMovimiento 44 (PAGO_CRUZADO USD): was 544.42 USD, should be 117.97 USD
            console.log("Updating MovimientosCuenta PAGO_CRUZADO USD (44)...");
            await new sql.Request(transaction)
                .query("UPDATE MovimientosCuenta SET MovImporte = 117.97 WHERE MovIdMovimiento = 44");

            // 3. Correct DeudaDocumento
            // DDeIdDocumento 1: was 4800 USD original, 4255.58 USD pending. Correct to 117.97 USD original, 0 USD pending, PAGADO
            console.log("Updating DeudaDocumento (1)...");
            await new sql.Request(transaction)
                .query(`
                    UPDATE DeudaDocumento
                    SET DDeImporteOriginal = 117.97,
                        DDeImportePendiente = 0.00,
                        DDeEstado = 'PAGADO'
                    WHERE DDeIdDocumento = 1
                `);

            // 4. Correct CuentasCliente balances
            // CueIdCuenta 1214 (USD): should be 0.00
            console.log("Updating CuentasCliente USD (1214) balance...");
            await new sql.Request(transaction)
                .query("UPDATE CuentasCliente SET CueSaldoActual = 0.00 WHERE CueIdCuenta = 1214");

            // CueIdCuenta 1220 (UYU): should be 17352.45
            console.log("Updating CuentasCliente UYU (1220) balance...");
            await new sql.Request(transaction)
                .query("UPDATE CuentasCliente SET CueSaldoActual = 17352.45 WHERE CueIdCuenta = 1220");

            await transaction.commit();
            console.log("✅ DB correction transaction committed successfully!");
            process.exit(0);
        } catch (errTrx) {
            console.error("Error in transaction, rolling back...", errTrx);
            await transaction.rollback();
            process.exit(1);
        }
    } catch (err) {
        console.error("Error establishing DB pool connection:", err);
        process.exit(1);
    }
}

run();
