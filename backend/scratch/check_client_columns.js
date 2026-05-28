const { getPool } = require('../config/db');

async function run() {
    try {
        const pool = await getPool();
        
        console.log("=== CLIENTES TABLE COLUMNS ===");
        const cols = await pool.request().query("SELECT TOP 1 * FROM Clientes");
        console.log(Object.keys(cols.recordset[0]));

        console.log("\n=== TIPO CLIENTE ID VALUES IN CLIENTES ===");
        const types = await pool.request().query("SELECT DISTINCT TClIdTipoCliente FROM Clientes");
        console.log(types.recordset);

        console.log("\n=== TIPOS CLIENTES TABLE (if exists) ===");
        try {
            const tcTable = await pool.request().query("SELECT * FROM TiposClientes");
            console.log(tcTable.recordset);
        } catch (e) {
            console.log("TiposClientes table does not exist or error:", e.message);
        }

        console.log("\n=== DETAILED CLIENT RECORD FOR CliIdCliente = 854 ===");
        const client = await pool.request()
            .input('Cli', 854)
            .query("SELECT CliIdCliente, Nombre, TClIdTipoCliente, CodCliente, IDCliente FROM Clientes WHERE CliIdCliente = @Cli");
        console.log(client.recordset[0]);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

run();
