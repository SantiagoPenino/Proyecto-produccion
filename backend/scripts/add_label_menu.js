const { getPool, sql } = require('../config/db');

async function addMenu() {
    try {
        const pool = await getPool();
        const parentId = 3; // Producción
        const route = '/produccion/etiquetas';
        const title = 'Generar Etiquetas';
        const icon = 'fa-qrcode';

        // 1. Check if exists
        const check = await pool.request()
            .input('Ruta', sql.VarChar, route)
            .query("SELECT IdModulo FROM Modulos WHERE Ruta = @Ruta");

        let newId;

        if (check.recordset.length > 0) {
            console.log("Module already exists. ID:", check.recordset[0].IdModulo);
            newId = check.recordset[0].IdModulo;
        } else {
            console.log("Creating new module...");
            // Get max index
            const idxRes = await pool.request().input('P', sql.Int, parentId).query("SELECT MAX(IndiceOrden) as MaxIdx FROM Modulos WHERE IdPadre = @P");
            const nextIdx = (idxRes.recordset[0].MaxIdx || 0) + 10;

            const insert = await pool.request()
                .input('Titulo', sql.VarChar, title)
                .input('Ruta', sql.VarChar, route)
                .input('Icono', sql.VarChar, icon)
                .input('IdPadre', sql.Int, parentId)
                .input('Indice', sql.Int, nextIdx)
                .query(`
                    INSERT INTO Modulos (Titulo, Ruta, Icono, IdPadre, IndiceOrden)
                    OUTPUT INSERTED.IdModulo
                    VALUES (@Titulo, @Ruta, @Icono, @IdPadre, @Indice)
                `);

            newId = insert.recordset[0].IdModulo;
            console.log("Created Module ID:", newId);
        }

        // 2. Assign to Admin and Production ROLES
        // Table: Roles (IdRol, NombreRol), PermisosRoles (IdRol, IdModulo)
        const roles = await pool.request().query("SELECT IdRol, NombreRol FROM Roles");
        console.log("Available Roles:", roles.recordset.map(r => `${r.IdRol}:${r.NombreRol}`).join(', '));

        for (const r of roles.recordset) {
            const name = (r.NombreRol || '').toLowerCase();
            // Assign to admin, produccion, or similar
            if (name.includes('admin') || name.includes('produ') || name.includes('super') || name.includes('dtf') || name.includes('ecouv') || name.includes('sb') || name.includes('logis')) {
                const checkAssign = await pool.request()
                    .input('R', sql.Int, r.IdRol)
                    .input('M', sql.Int, newId)
                    .query("SELECT * FROM PermisosRoles WHERE IdRol = @R AND IdModulo = @M");

                if (checkAssign.recordset.length === 0) {
                    await pool.request()
                        .input('R', sql.Int, r.IdRol)
                        .input('M', sql.Int, newId)
                        .query("INSERT INTO PermisosRoles (IdRol, IdModulo) VALUES (@R, @M)");
                    console.log(`Assigned module ${newId} to Role ${r.NombreRol} (${r.IdRol})`);
                } else {
                    console.log(`Module ${newId} already assigned to ${r.NombreRol}`);
                }
            }
        }

        console.log("Done.");
        process.exit(0);

    } catch (err) {
        console.error("Error:", err);
        process.exit(1);
    }
}

addMenu();
