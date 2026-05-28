const { getPool, sql } = require('../config/db');

async function run() {
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            console.log("Starting DB correction transaction for sublimation order...");

            // 1. Update PedidosCobranzaDetalle (ID = 2429)
            // Change quantity from 17.32 to 16.12
            console.log("Updating PedidosCobranzaDetalle...");
            await new sql.Request(transaction)
                .query(`
                    UPDATE PedidosCobranzaDetalle
                    SET Cantidad = 16.12
                    WHERE ID = 2429
                `);

            // 2. Update PlanesMetros (PlaIdPlan = 3)
            // Change PlaCantidadUsada from 17.32 to 16.12
            console.log("Updating PlanesMetros...");
            await new sql.Request(transaction)
                .query(`
                    UPDATE PlanesMetros
                    SET PlaCantidadUsada = 16.12
                    WHERE PlaIdPlan = 3
                `);

            // 3. Update MovimientosCuenta (MovIdMovimiento = 41)
            // Change MovImporte from -17.32 to -16.12, and MovSaldoPosterior from 72.09 to 73.29
            console.log("Updating MovimientosCuenta...");
            await new sql.Request(transaction)
                .query(`
                    UPDATE MovimientosCuenta
                    SET MovImporte = -16.12,
                        MovSaldoPosterior = 73.29
                    WHERE MovIdMovimiento = 41
                `);

            // 4. Update CuentasCliente (CueIdCuenta = 1215)
            // Change CueSaldoActual from 72.09 to 73.29
            console.log("Updating CuentasCliente (1215)...");
            await new sql.Request(transaction)
                .query(`
                    UPDATE CuentasCliente
                    SET CueSaldoActual = 73.29
                    WHERE CueIdCuenta = 1215
                `);

            // 5. Update PedidosCobranza (ID = 2060)
            // Change QR_Cantidad, QR_String, and DetalleCostos
            console.log("Updating PedidosCobranza...");
            const newDetalleCostos = "- 11                  : 16.12 x 0 = 0 (Cubierto 100% por Plan #3 (89.41m disponibles))\n- 1375                : 0 x 0 = 0 (Base: USD 0.00\nTotal Unit. Calculado: USD 0.00)";
            await new sql.Request(transaction)
                .input('QR_String', sql.NVarChar(sql.MAX), 'XSB-62532$*984$*Camisetas CD el Tronco$*1$*55$*136.12$*117.97')
                .input('DetalleCostos', sql.NVarChar(sql.MAX), newDetalleCostos)
                .query(`
                    UPDATE PedidosCobranza
                    SET QR_Cantidad = '136.12',
                        QR_String = @QR_String,
                        DetalleCostos = @DetalleCostos
                    WHERE ID = 2060
                `);

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
