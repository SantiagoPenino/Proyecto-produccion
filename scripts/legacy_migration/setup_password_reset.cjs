const path = require('path');
const dbConfigPath = path.resolve('C:/Integracion/User-Macrosoft/backend/config/db.js');
const { sql, getPool } = require(dbConfigPath);

async function setupPasswordReset() {
    try {
        const pool = await getPool();

        // 1. Add Column if not exists
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'WebUsuarios' AND COLUMN_NAME = 'ResetPassword')
            BEGIN
                ALTER TABLE WebUsuarios ADD ResetPassword BIT DEFAULT 0;
                PRINT 'Column ResetPassword added.';
            END
        `);

        // 2. Update all existing WebUsuarios to have empty password and ResetPassword = 1
        // This effectively "resets" everyone migrated so far.
        await pool.request().query(`
            UPDATE WebUsuarios 
            SET PasswordHash = '', 
                ResetPassword = 1 
            WHERE CodCliente IS NOT NULL -- Only migrated clients
        `);

        console.log("✅ Configuración de reseteo de contraseña aplicada a todos los usuarios.");

    } catch (err) {
        console.error("Error:", err);
    }
}

setupPasswordReset();
