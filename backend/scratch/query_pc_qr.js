const { getPool } = require('../config/db');

async function run() {
    try {
        const pool = await getPool();
        
        console.log("=== PEDIDOS COBRANZA FULL DETAIL ===");
        const pc = await pool.request()
            .input('ID', 2060)
            .query("SELECT ID, QR_Cantidad, QR_Importe, QR_String, DetalleCostos FROM PedidosCobranza WHERE ID = @ID");
        console.log(JSON.stringify(pc.recordset, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
