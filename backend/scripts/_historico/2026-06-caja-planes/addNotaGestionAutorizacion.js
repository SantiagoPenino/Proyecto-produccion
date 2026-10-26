const { getPool } = require('../config/db');

async function run() {
    try {
        const pool = await getPool();
        await pool.request().query(`
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE Name = N'AuzNotaGestion'
                AND Object_ID = Object_ID(N'dbo.AutorizacionesSinPago')
            )
            BEGIN
                ALTER TABLE dbo.AutorizacionesSinPago
                ADD AuzNotaGestion NVARCHAR(500) NULL;
                PRINT 'Columna AuzNotaGestion agregada.';
            END
            ELSE
                PRINT 'Columna ya existe.';
        `);
        console.log('Migración OK');
        process.exit(0);
    } catch (e) {
        console.error('Error en migración:', e);
        process.exit(1);
    }
}
run();
