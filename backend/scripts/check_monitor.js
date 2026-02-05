require('dotenv').config();
const { sql, getPool } = require('../config/db');
const axios = require('axios');

async function checkMonitor() {
    try {
        console.log("--- DIAGNÓSTICO DEL MONITOR DE ÓRDENES ---");
        const ERP_API_BASE = process.env.ERP_API_URL || 'http://localhost:6061';

        // 1. Check DB
        const pool = await getPool();
        console.log("✅ Conexión a Base de Datos: EXITOSA");

        // 2. Check Config
        const res = await pool.request().query("SELECT * FROM ConfiguracionGlobal WHERE Clave IN ('TIEMPOTRAEORDEN', 'ULTIMAFACTURA')");
        console.log("📊 Configuración Actual:");
        console.table(res.recordset);

        if (!res.recordset.some(r => r.Clave === 'TIEMPOTRAEORDEN')) {
            console.log("⚠️ No se encontró la clave TIEMPOTRAEORDEN. Se usará valor por defecto (30s).");
        }
        if (!res.recordset.some(r => r.Clave === 'ULTIMAFACTURA')) {
            console.log("⚠️ No se encontró la clave ULTIMAFACTURA. Se buscará desde la factura 0.");
        }

        // 3. Check ERP Bridge
        console.log("--- Probando conexión con Nuevo API (localhost:6061) ---");
        try {
            // Probamos el endpoint de pedidos (aunque no devuelva nada, debe responder 200 OK)
            await axios.get('http://localhost:6061/api/pedidos/todos?NroFact=999999');
            console.log("✅ API 6061 responde correctamente.");
        } catch (e) {
            if (e.code === 'ECONNREFUSED') {
                console.error("❌ EL SERVIDOR 6061 PARECE ESTAR APAGADO. El monitor no funcionará sin él.");
            } else {
                console.log(`⚠️ API 6061 respondió con error (puede ser normal si no hay datos): ${e.message}`);
            }
        }

    } catch (err) {
        console.error("❌ Error General:", err);
    } finally {
        process.exit();
    }
}

checkMonitor();
