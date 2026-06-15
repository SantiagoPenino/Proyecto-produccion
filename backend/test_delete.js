const { sql, getPool } = require('./config/db');

async function testDelete() {
    try {
        const pool = await getPool();
        const result = await pool.request().query(`
            DELETE FROM dbo.Rollos
            WHERE (SELECT COUNT(*) FROM dbo.Ordenes WHERE RolloID = dbo.Rollos.RolloID) = 0
        `);
        console.log(`✅ Se eliminaron ${result.rowsAffected[0]} lotes vacíos sin problemas.`);
    } catch (err) {
        console.error("❌ Error de SQL Server:", err.message);
    }
    process.exit(0);
}

testDelete();
