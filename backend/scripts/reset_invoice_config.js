const { getPool, sql } = require('../config/db');

async function resetAndCheck() {
    try {
        const pool = await getPool();

        // 1. Check current value
        const resBefore = await pool.request().query("SELECT Valor FROM ConfiguracionGlobal WHERE Clave = 'ULTIMAFACTURA'");
        const valBefore = resBefore.recordset[0]?.Valor;
        console.log(`🧐 Valor ACTUAL de ULTIMAFACTURA: ${valBefore}`);

        // 2. Reset (Update to 0 or a low number to force re-read)
        // Adjust this if you want to go back to a specific invoice, e.g. 47
        await pool.request().query("UPDATE ConfiguracionGlobal SET Valor = '47' WHERE Clave = 'ULTIMAFACTURA'");
        console.log("✅ ULTIMAFACTURA reseteado a '0'.");

        // 3. Verify
        const resAfter = await pool.request().query("SELECT Valor FROM ConfiguracionGlobal WHERE Clave = 'ULTIMAFACTURA'");
        console.log(`🧐 Valor NUEVO de ULTIMAFACTURA: ${resAfter.recordset[0]?.Valor}`);

        process.exit(0);
    } catch (error) {
        console.error("❌ Error:", error);
        process.exit(1);
    }
}

resetAndCheck();
