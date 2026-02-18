const path = require('path');
const dbConfigPath = path.resolve('C:/Integracion/User-Macrosoft/backend/config/db.js');
const { sql, getPool } = require(dbConfigPath);

async function unifyClientsAuth() {
    try {
        const pool = await getPool();

        console.log("🚀 Unificando Autenticación en tabla Clientes...");

        // 1. Add Auth Columns to Clientes
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Clientes' AND COLUMN_NAME = 'WebPasswordHash')
            BEGIN
                ALTER TABLE Clientes ADD WebPasswordHash NVARCHAR(255);
                ALTER TABLE Clientes ADD WebActive BIT DEFAULT 1;
                ALTER TABLE Clientes ADD WebResetPassword BIT DEFAULT 0;
                ALTER TABLE Clientes ADD WebLastLogin DATETIME;
                PRINT '✅ Columnas de Auth agregadas a Clientes.';
            END
        `);

        // 2. Migrate existing credentials from WebUsuarios to Clientes
        // JOIN and update
        await pool.request().query(`
            UPDATE c
            SET c.WebPasswordHash = w.PasswordHash,
                c.WebActive = 1,
                c.WebResetPassword = w.ResetPassword,
                c.WebLastLogin = w.UltimoLogin
            FROM Clientes c
            INNER JOIN WebUsuarios w ON c.CodCliente = w.CodCliente
        `);
        console.log("✅ Credenciales migradas de WebUsuarios a Clientes.");

        // 3. Ensure all Clients with IDPlanilla also have a default setup (if they weren't in WebUsuarios)
        // Reset Password = 1, Password = ID/RUC logic can be applied on login or here?
        // Let's safe-guard: If WebPasswordHash is NULL but IDClientePlanilla exists, allow login logic to handle "first time" 
        // by checking NULL password too.

    } catch (err) {
        console.error("❌ Error:", err);
    }
}

unifyClientsAuth();
