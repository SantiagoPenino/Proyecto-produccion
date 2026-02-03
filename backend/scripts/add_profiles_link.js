const { getPool, sql } = require('../config/db');

(async () => {
    try {
        const pool = await getPool();
        const parentRes = await pool.request()
            .input('Titulo', sql.NVarChar, 'Gestión de Precios')
            .query("SELECT IdModulo FROM Modulos WHERE Titulo = @Titulo");

        if (parentRes.recordset.length === 0) {
            console.log("Crear primero el padre con scripts anteriores.");
            process.exit(1);
        }

        const parentId = parentRes.recordset[0].IdModulo;

        await pool.request()
            .input('Padre', sql.Int, parentId)
            .input('Titulo', sql.NVarChar, 'Perfiles de Precios')
            .input('Ruta', sql.VarChar, '/admin/price-profiles')
            .input('Icono', sql.VarChar, 'fa-users-gear')
            .query(`
                IF NOT EXISTS (SELECT 1 FROM Modulos WHERE Ruta = @Ruta)
                BEGIN
                    INSERT INTO Modulos (Titulo, Icono, Ruta, IdPadre, IndiceOrden)
                    VALUES (@Titulo, @Icono, @Ruta, @Padre, 3);
                    PRINT '✅ Submenú Perfiles creado.';
                END
            `);

        process.exit(0);
    } catch (e) {
        console.error("❌ Error:", e);
        process.exit(1);
    }
})();
