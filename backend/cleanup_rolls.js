const { sql, getPool } = require('./config/db');

async function cleanupEmptyRolls() {
    try {
        console.log("Conectando a la base de datos...");
        const pool = await getPool();
        
        console.log("Buscando y eliminando lotes vacíos (sin órdenes asociadas)...");
        const result = await pool.request().query(`
            DELETE FROM dbo.Rollos
            WHERE (SELECT COUNT(*) FROM dbo.Ordenes WHERE RolloID = dbo.Rollos.RolloID) = 0
        `);
        
        console.log(`✅ Limpieza completada. Se eliminaron ${result.rowsAffected[0]} lotes vacíos.`);
        process.exit(0);
    } catch (error) {
        console.error("❌ Error durante la limpieza:", error);
        process.exit(1);
    }
}

cleanupEmptyRolls();
