// test-db-connection.js

// Importamos la configuración de la conexión
// NOTA IMPORTANTE: Si tu función en db.config.js se llama 'obtenerPool', 
// cámbia 'getPool' por 'obtenerPool' aquí.
const { getPool, sql } = require('./config/db.config'); 
require('dotenv').config(); // Aseguramos que las variables de entorno se carguen

async function testConnection() {
    console.log("-----------------------------------------");
    console.log("🚀 Iniciando prueba de conexión a MSSQL...");
    console.log(`Servidor: ${process.env.DB_SERVER}`);
    console.log(`Usuario: ${process.env.DB_USER}`);
    console.log("-----------------------------------------");

    try {
        // Intentar obtener el pool de conexiones. 
        // Esta línea es la que se bloquea si hay problemas de red/firewall.
        const pool = await getPool(); 
        
        console.log("✅ ¡Conexión exitosa!");

        // Ejecutar una consulta simple para confirmar la lectura de datos
        const resultado = await pool.request().query('SELECT 1 AS ConnectionTest');
        console.log(`Resultado de la consulta:`, resultado.recordset);

    } catch (error) {
        console.error("❌ La conexión FALLÓ en el script de prueba.");
        console.error("Detalles del Error:", error.message);
        console.error("\n*** POSIBLES CAUSAS LOCALES A REVISAR ***");
        console.error("1. ¿Se eliminó 'port: 1433' de db.config.js (si usas instancia con nombre)?");
        console.error("2. ¿El servicio SQL Server Browser está ACTIVO?");
        console.error("3. ¿El Firewall de Windows está bloqueando la conexión al puerto 1433 o al proceso SQL Server?");
    } 
    // Aseguramos que el script termine
    process.exit(0); 
}

testConnection();