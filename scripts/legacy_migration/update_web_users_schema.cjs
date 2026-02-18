const path = require('path');
const dbPath = path.resolve(__dirname, '../User-Macrosoft/backend/config/db.js');
const { sql, getPool } = require(dbPath);

async function updateWebUsersTable() {
    try {
        const pool = await getPool();
        console.log("Adding CodCliente column to WebUsuarios...");

        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'WebUsuarios' AND COLUMN_NAME = 'CodCliente')
            BEGIN
                ALTER TABLE WebUsuarios ADD CodCliente INT NULL;
                PRINT 'Column CodCliente added to WebUsuarios.';
            END
            ELSE
            BEGIN
                PRINT 'Column CodCliente already exists.';
            END
        `);
    } catch (err) {
        console.error("Error updating table:", err);
    }
}

updateWebUsersTable();
