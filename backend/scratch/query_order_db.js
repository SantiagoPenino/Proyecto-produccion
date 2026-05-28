const { getPool } = require('../config/db');

async function run() {
    try {
        const pool = await getPool();
        
        console.log("=== PLANES METROS ===");
        const plans = await pool.request()
            .query("SELECT * FROM PlanesMetros WHERE PlaIdPlan = 3");
        console.log(JSON.stringify(plans.recordset, null, 2));

        console.log("\n=== DETALLES DE ORDEN EN PEDIDOS COBRANZA DETALLE ===");
        const det = await pool.request()
            .query("SELECT * FROM PedidosCobranzaDetalle WHERE ID = 2429");
        console.log(JSON.stringify(det.recordset, null, 2));

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
