const { sql, getPool } = require('./config/db');

async function checkSchema() {
    try {
        const pool = await getPool();

        console.log("--- TABLE: Usuarios ---");
        const resUsers = await pool.request().query("SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Usuarios'");
        resUsers.recordset.forEach(c => console.log(`${c.COLUMN_NAME} (${c.DATA_TYPE})`));

        console.log("\n--- TABLE: Roles ---");
        try {
            const resRoles = await pool.request().query("SELECT * FROM Roles"); // Assuming table name
            resRoles.recordset.forEach(r => console.log(JSON.stringify(r)));
        } catch (e) {
            console.log("Roles table error (might be differnet name):", e.message);
        }

        console.log("\n--- TABLE: Clientes? ---");
        try {
            const resClients = await pool.request().query("SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME LIKE '%Client%'");
            resClients.recordset.forEach(t => console.log(t.TABLE_NAME));
        } catch (e) { console.log(e.message); }

    } catch (err) {
        console.error("Error:", err);
    }
}

checkSchema();
