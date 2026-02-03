const { getPool } = require('../config/db');

(async () => {
    try {
        console.log("Conectando...");
        const pool = await getPool();
        console.log("Conectado.");

        // 1. Ver Columnas de Articulos
        const resArt = await pool.request().query("SELECT TOP 1 * FROM Articulos");
        if (resArt.recordset.length > 0) {
            console.log("COLUMNAS DE ARTICULOS:");
            console.log(Object.keys(resArt.recordset[0]));
        } else {
            console.log("Tabla Articulos vacía o inexistente.");
        }

        // 2. Ver Tablas de Precios Creadas
        const resEsp = await pool.request().query("SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME LIKE 'PreciosEspeciales%'");
        console.log("\nESTRUCTURA DE PRECIOS CREADA:");
        resEsp.recordset.forEach(col => {
            console.log(`${col.TABLE_NAME}.${col.COLUMN_NAME} (${col.DATA_TYPE})`);
        });

        process.exit(0);
    } catch (e) {
        console.error("ERROR:", e);
        process.exit(1);
    }
})();
