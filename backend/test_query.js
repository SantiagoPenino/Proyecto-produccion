const { getPool } = require('./config/db');

async function run() {
    try {
        const pool = await getPool();
        console.log("Testeando Query...");

        const query = `
            SELECT
                PE.ClienteID, PE.NombreCliente, PE.PerfilID,
                PP.Nombre as NombrePerfil,
                (SELECT COUNT(*) FROM PreciosEspecialesItems WHERE ClienteID = PE.ClienteID) as CantReglas
            FROM PreciosEspeciales PE
            LEFT JOIN PerfilesPrecios PP ON PE.PerfilID = PP.ID
        `;

        const res = await pool.request().query(query);
        console.log("✅ Query Exitosa. Filas:", res.recordset.length);
        console.log("Muestra:", res.recordset.slice(0, 2));

        process.exit(0);
    } catch (e) {
        console.error("❌ ERROR QUERY:", e);
        process.exit(1);
    }
}

run();
