const { getPool } = require('../config/db');

async function run() {
    try {
        const pool = await getPool();
        await pool.request().query(`
            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE Name = N'EsCajaAdmin'
                  AND Object_ID = OBJECT_ID(N'dbo.TransaccionesCaja')
            )
            BEGIN
                ALTER TABLE dbo.TransaccionesCaja
                    ADD EsCajaAdmin BIT NOT NULL DEFAULT 0;
                PRINT 'OK: EsCajaAdmin agregado a TransaccionesCaja';
            END
            ELSE
                PRINT 'INFO: EsCajaAdmin ya existe en TransaccionesCaja';

            IF NOT EXISTS (
                SELECT 1 FROM sys.columns
                WHERE Name = N'EsCajaAdmin'
                  AND Object_ID = OBJECT_ID(N'dbo.EgresosCaja')
            )
            BEGIN
                ALTER TABLE dbo.EgresosCaja
                    ADD EsCajaAdmin BIT NOT NULL DEFAULT 0;
                PRINT 'OK: EsCajaAdmin agregado a EgresosCaja';
            END
            ELSE
                PRINT 'INFO: EsCajaAdmin ya existe en EgresosCaja';
        `);
        console.log('Migración OK');
        process.exit(0);
    } catch (e) {
        console.error('Error en migración:', e.message);
        process.exit(1);
    }
}
run();
