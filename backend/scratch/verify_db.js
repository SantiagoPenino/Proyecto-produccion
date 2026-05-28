const { getPool } = require('../config/db');

async function run() {
    try {
        const pool = await getPool();
        
        console.log("=== CLIENT BALANCES ===");
        const clientRes = await pool.request()
            .input('Cli', 854)
            .query("SELECT CliIdCliente, Nombre, IDCliente FROM Clientes WHERE CliIdCliente = @Cli");
        console.log(JSON.stringify(clientRes.recordset, null, 2));

        console.log("\n=== CUENTAS CLIENTE ===");
        const accountsRes = await pool.request()
            .input('Cli', 854)
            .query("SELECT cc.CueIdCuenta, cc.CliIdCliente, cc.CueTipo, cc.CueSaldoActual, m.MonSimbolo FROM CuentasCliente cc LEFT JOIN Monedas m ON cc.MonIdMoneda = m.MonIdMoneda WHERE cc.CliIdCliente = @Cli");
        console.log(JSON.stringify(accountsRes.recordset, null, 2));
        
        console.log("\n=== PEDIDOS COBRANZA DETALLE ROWS ===");
        const pcdRes = await pool.request()
            .input('PID', 2060)
            .query("SELECT ID, Cantidad, PrecioUnitario, Subtotal, Moneda, MonedaOriginal, PrecioUnitarioOriginal, SubtotalOriginal FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PID");
        console.log(JSON.stringify(pcdRes.recordset, null, 2));

        console.log("\n=== MOVIMIENTOS CUENTA FOR CUE_ID: 1214 (DINERO_USD) ===");
        const movUSD = await pool.request()
            .input('Cue', 1214)
            .query("SELECT MovIdMovimiento, MovTipo, MovConcepto, MovImporte, MovFecha, MovAnulado, OrdIdOrden FROM MovimientosCuenta WHERE CueIdCuenta = @Cue ORDER BY MovFecha DESC, MovIdMovimiento DESC");
        console.log(JSON.stringify(movUSD.recordset, null, 2));

        console.log("\n=== MOVIMIENTOS CUENTA FOR CUE_ID: 1220 (DINERO_UYU) ===");
        const movUYU = await pool.request()
            .input('Cue', 1220)
            .query("SELECT MovIdMovimiento, MovTipo, MovConcepto, MovImporte, MovFecha, MovAnulado, OrdIdOrden FROM MovimientosCuenta WHERE CueIdCuenta = @Cue ORDER BY MovFecha DESC, MovIdMovimiento DESC");
        console.log(JSON.stringify(movUYU.recordset, null, 2));

        console.log("\n=== DEUDA DOCUMENTO ===");
        const ddRes = await pool.request()
            .input('Cod', 'XSB-62532')
            .query("SELECT * FROM DeudaDocumento WHERE OrdIdOrden IN (SELECT OrdenID FROM Ordenes WHERE CodigoOrden = @Cod)");
        console.log(JSON.stringify(ddRes.recordset, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
