const { getPool } = require('./config/db');

async function listTables() {
    try {
        const pool = await getPool();
        const result = await pool.request().query("SELECT NAME FROM sys.tables ORDER BY NAME");
        console.log(JSON.stringify(result.recordset, null, 2));
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

listTables();
