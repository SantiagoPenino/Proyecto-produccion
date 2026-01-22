const { getPool } = require('../config/db');

async function checkTables() {
    try {
        const pool = await getPool();

        console.log("--- ARCHIVOS REFERENCIA ---");
        try {
            const r1 = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ArchivosReferencia'");
            console.log(r1.recordset.map(x => x.COLUMN_NAME).join(', '));
        } catch (e) { console.log("No existe ArchivosReferencia"); }

        console.log("--- SERVICIOS EXTRA ORDEN ---");
        try {
            const r2 = await pool.request().query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'ServiciosExtraOrden'");
            console.log(r2.recordset.map(x => x.COLUMN_NAME).join(', '));
        } catch (e) { console.log("No existe ServiciosExtraOrden"); }

        process.exit(0);
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}

checkTables();
