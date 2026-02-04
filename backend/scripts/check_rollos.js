const { getPool, sql } = require('../config/db');

async function checkRollos() {
    try {
        const pool = await getPool();
        console.log("Checking Rollos for DTF...");
        const res = await pool.request().query("SELECT RolloID, AreaID, Estado, Ubicacion, TipoRollo, FechaCreacion FROM Rollos WHERE AreaID = 'DTF' OR AreaID = 'IMPRESION' ORDER BY RolloID DESC");
        console.table(res.recordset);
        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
checkRollos();
