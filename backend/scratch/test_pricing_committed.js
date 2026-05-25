const { getPool } = require('../config/db');
const PricingService = require('../services/pricingService');

async function run() {
    try {
        const pool = await getPool();
        const cliId = 2394; // Rodrigo Falero
        const proId = 255;  // DTF para rígidos UV
        
        console.log("=== INICIANDO PRUEBA DE PRECIOS CON METROS COMPROMETIDOS ===");
        
        // 1. Calcular precio de 3m para el cliente (debería aplicar plan prepago si hay saldo)
        console.log("\n--- Prueba 1: Calcular 3m para Rodrigo Falero ---");
        const res1 = await PricingService.calculatePrice(
            { proIdProducto: proId, codArticulo: '255' },
            3.0,
            { cliIdCliente: cliId },
            [],
            { skipPrepago: false }
        );
        console.log("Precio Unitario:", res1.precioUnitario);
        console.log("Precio Total:", res1.precioTotal);
        console.log("Perfiles Aplicados:", res1.perfilesAplicados);
        console.log("Texto Detalle:\n", res1.txt);

        // 2. Calcular precio excluyendo la orden 10375
        console.log("\n--- Prueba 2: Calcular 3m para Rodrigo Falero excluyendo Orden 10375 ---");
        const res2 = await PricingService.calculatePrice(
            { proIdProducto: proId, codArticulo: '255' },
            3.0,
            { cliIdCliente: cliId },
            [],
            { skipPrepago: false, ordenId: 10375 }
        );
        console.log("Precio Unitario:", res2.precioUnitario);
        console.log("Precio Total:", res2.precioTotal);
        console.log("Perfiles Aplicados:", res2.perfilesAplicados);
        console.log("Texto Detalle:\n", res2.txt);

        // 3. Calcular precio con skipPrepago: true
        console.log("\n--- Prueba 3: Calcular 3m con skipPrepago: true ---");
        const res3 = await PricingService.calculatePrice(
            { proIdProducto: proId, codArticulo: '255' },
            3.0,
            { cliIdCliente: cliId },
            [],
            { skipPrepago: true }
        );
        console.log("Precio Unitario:", res3.precioUnitario);
        console.log("Precio Total:", res3.precioTotal);
        console.log("Perfiles Aplicados:", res3.perfilesAplicados);

    } catch (e) {
        console.error("Error en la prueba:", e);
    } finally {
        process.exit(0);
    }
}

run();
