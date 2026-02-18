const path = require('path');
const dbPath = path.resolve(__dirname, '../User-Macrosoft/backend/config/db.js');
const { sql, getPool } = require(dbPath);

async function addMissingCols() {
    try {
        const pool = await getPool();
        console.log("Adding columns to Clientes if missing...");

        const queries = [
            "IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Clientes' AND COLUMN_NAME = 'Localidad') ALTER TABLE Clientes ADD Localidad NVARCHAR(200);",
            "IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Clientes' AND COLUMN_NAME = 'Agencia') ALTER TABLE Clientes ADD Agencia NVARCHAR(200);"
        ];

        for (const q of queries) {
            await pool.request().query(q);
            console.log("Executed schema update.");
        }
    } catch (err) {
        console.error("Error updating table:", err);
    }
}

addMissingCols();
