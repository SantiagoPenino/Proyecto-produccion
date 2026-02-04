const { getPool, sql } = require('../config/db');

async function debugBoard() {
    try {
        const pool = await getPool();
        const area = 'DTF';

        console.log(`Querying rolls for area: '${area}'...`);

        const rolls = await pool.request().input('Area', sql.VarChar, area)
            .query(`SELECT RolloID, Nombre, AreaID, Estado, MaquinaID 
                   FROM dbo.Rollos 
                   WHERE AreaID = @Area AND Estado NOT IN ('Cerrado', 'Finalizado')`);

        console.log(`Found ${rolls.recordset.length} active rolls.`);
        console.table(rolls.recordset);

        // Check if there are rolls with spaces
        const spaceCheck = await pool.request().query("SELECT RolloID, AreaID FROM Rollos WHERE AreaID LIKE '%DTF%'");
        console.log("Deep check for '%DTF%':");
        console.table(spaceCheck.recordset);

        process.exit(0);
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}
debugBoard();
