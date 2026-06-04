const db = require('./config/db.js');
(async () => {
    try {
        const pool = await db.getPool();

        // Antes del cambio
        const antes = await pool.request().query(`
            SELECT ProIdProducto, IDProdReact, LTRIM(RTRIM(Descripcion)) AS Descripcion, MonIdMoneda
            FROM dbo.Articulos WHERE ProIdProducto IN (32, 9, 420)
        `);
        console.log('=== ANTES ===');
        console.dir(antes.recordset, { depth: null });

        // Aplicar el UPDATE - MonIdMoneda = 2 (USD) para los 3 articulos IMD
        const upd = await pool.request().query(`
            UPDATE dbo.Articulos
            SET MonIdMoneda = 2
            WHERE ProIdProducto IN (32, 9, 420)
              AND (MonIdMoneda IS NULL OR MonIdMoneda != 2)
        `);
        console.log(`Filas actualizadas: ${upd.rowsAffected[0]}`);

        // Verificar despues
        const despues = await pool.request().query(`
            SELECT ProIdProducto, IDProdReact, LTRIM(RTRIM(Descripcion)) AS Descripcion, MonIdMoneda
            FROM dbo.Articulos WHERE ProIdProducto IN (32, 9, 420)
        `);
        console.log('=== DESPUES ===');
        console.dir(despues.recordset, { depth: null });

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
})();
