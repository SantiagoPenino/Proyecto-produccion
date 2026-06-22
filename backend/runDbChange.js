const { getPool, sql } = require('./config/db');

async function run() {
    try {
        const pool = await getPool();
        await pool.request().query(`
            IF NOT EXISTS(SELECT 1 FROM sys.columns 
                          WHERE Name = N'EstadoPadreID'
                          AND Object_ID = Object_ID(N'dbo.ConfigEstados'))
            BEGIN
                ALTER TABLE dbo.ConfigEstados ADD EstadoPadreID INT NULL;
                ALTER TABLE dbo.ConfigEstados ADD CONSTRAINT FK_ConfigEstados_Padre FOREIGN KEY (EstadoPadreID) REFERENCES dbo.ConfigEstados(EstadoID);
                PRINT 'Column and FK added.';
            END
            ELSE
            BEGIN
                PRINT 'Column already exists.';
            END
        `);
        console.log("Migration successful");
        process.exit(0);
    } catch(e) {
        console.error("Migration failed:", e);
        process.exit(1);
    }
}
run();
